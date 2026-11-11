"""Pytest + Playwright fixtures for the delivery-note Electron desktop app.

Strategy
--------
Python Playwright cannot launch Electron directly (``p.electron`` is Node-only),
but Electron exposes a Chrome DevTools Protocol endpoint.  We therefore:

1. spawn the real ``electron.exe`` with ``--remote-debugging-port=<free port>``
   and a set of DNS_TEST_* environment variables that isolate every side
   effect (userData / saved files / product-image dir),
2. attach Playwright over CDP (``chromium.connect_over_cdp``), and
3. drive the real renderer, so main.js, preload.js, the IPC bridge and the disk
   side effects are all exercised for real — no mocks of the shell.

Nothing outside the pytest ``tmp_path`` is touched.
"""
from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import time
import urllib.request
import pathlib

import pytest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]        # .../electron
EXE = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"

# 1x1 transparent PNG — used for the "copy a product image" flow.
_PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_cdp(port: int, proc: subprocess.Popen, timeout: float = 40.0) -> str:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"electron exited early (rc={proc.returncode})")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as r:
                data = json.load(r)
            ws = data.get("webSocketDebuggerUrl")
            if ws:
                return ws
        except Exception as exc:  # noqa: BLE001 - endpoint not up yet
            last = exc
        time.sleep(0.2)
    raise RuntimeError(f"CDP endpoint never became ready: {last}")


class ElectronApp:
    """One isolated app instance (own profile + own disk sandbox)."""

    def __init__(self, tmp_path: pathlib.Path):
        self.root = tmp_path
        self.repo = ROOT
        self.userdata = tmp_path / "userdata"
        self.appdata = tmp_path / "appdata"
        self.tmp = tmp_path / "os-tmp"
        self.save_dir = tmp_path / "saves"
        self.image_dir = tmp_path / "images"
        self.pick_image_src = tmp_path / "pick-source.png"
        for d in (self.userdata, self.appdata, self.tmp, self.save_dir, self.image_dir):
            d.mkdir(parents=True, exist_ok=True)
        self.pick_image_src.write_bytes(_PNG_1x1)

        self.proc: subprocess.Popen | None = None
        self.pw = None
        self.browser = None
        self.page = None
        self.console_errors: list[str] = []
        self.page_errors: list[str] = []
        self.requests: list[str] = []
        self.startup_seconds: float | None = None

    # ---- env ----
    def env(self) -> dict:
        e = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
        e.update(
            {
                "DNS_TEST_USER_DATA": str(self.userdata),
                "DNS_TEST_SAVE_DIR": str(self.save_dir),
                "DNS_TEST_IMAGE_DIR": str(self.image_dir),
                "DNS_TEST_PICK_IMAGE_SRC": str(self.pick_image_src),
                "APPDATA": str(self.appdata),
                "LOCALAPPDATA": str(self.appdata),
                "TEMP": str(self.tmp),
                "TMP": str(self.tmp),
            }
        )
        return e

    # ---- lifecycle ----
    def start(self) -> "ElectronApp":
        port = _free_port()
        self.console_errors.clear()
        self.page_errors.clear()
        self.requests.clear()
        t0 = time.time()
        self.proc = subprocess.Popen(
            [
                str(EXE),
                f"--remote-debugging-port={port}",
                "--remote-allow-origins=*",
                "--no-sandbox",
                "--disable-gpu",
                str(ROOT),
            ],
            env=self.env(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _wait_cdp(port, self.proc)
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        self.page = self._find_page()
        self.page.wait_for_function(
            "() => window.DNSDesktop && window.DNSDesktop.ready === true", timeout=40000
        )
        self.startup_seconds = time.time() - t0
        self.page.on("console", self._on_console)
        self.page.on("pageerror", lambda exc: self.page_errors.append(str(exc)))
        self.page.on("request", lambda req: self.requests.append(req.url))
        return self

    def _find_page(self):
        deadline = time.time() + 20
        while time.time() < deadline:
            for ctx in self.browser.contexts:
                for pg in ctx.pages:
                    if pg.url.endswith("webapp/index.html"):
                        return pg
            time.sleep(0.2)
        raise RuntimeError(
            "app page not found; pages="
            + str([pg.url for ctx in self.browser.contexts for pg in ctx.pages])
        )

    def _on_console(self, msg):
        try:
            if msg.type == "error":
                self.console_errors.append(msg.text)
        except Exception:  # noqa: BLE001
            pass

    def eval(self, expression: str, arg=None):
        return self.page.evaluate(expression, arg)

    def restart(self) -> "ElectronApp":
        """Restart the app the way a user would: close the window, relaunch."""
        self.quit_gracefully()
        return self.start()

    def quit_gracefully(self, timeout: float = 15.0) -> None:
        try:
            self.page.evaluate("window.close()")
        except Exception:  # noqa: BLE001 - page torn down
            pass
        proc = self.proc
        if proc and proc.poll() is None:
            try:
                proc.wait(timeout=timeout)
            except Exception:  # noqa: BLE001
                try:
                    proc.terminate()
                    proc.wait(timeout=10)
                except Exception:  # noqa: BLE001
                    pass
        self.proc = None
        self._close_playwright()

    def settle(self, seconds: float = 1.5) -> None:
        """Idle wait, letting Chromium flush localStorage to disk."""
        time.sleep(seconds)

    def hard_kill(self) -> None:
        """Kill the process as if it crashed (no clean shutdown)."""
        proc = self.proc
        if proc and proc.poll() is None:
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass
            try:
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                pass
        self._close_playwright()

    def _close_playwright(self) -> None:
        try:
            if self.browser is not None:
                self.browser.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if self.pw is not None:
                self.pw.stop()
        except Exception:  # noqa: BLE001
            pass
        self.browser = None
        self.pw = None
        self.page = None

    def stop(self) -> None:
        proc = self.proc
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass
            try:
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001
                    pass
        self.proc = None
        self._close_playwright()

    def spawn_second_instance(self) -> subprocess.Popen:
        """Launch a second copy that shares the same (isolated) profile."""
        return subprocess.Popen(
            [str(EXE), "--no-sandbox", str(ROOT)],
            env=self.env(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    # ---- assertions helpers ----
    def http_requests(self) -> list[str]:
        return [u for u in self.requests if u.startswith(("http://", "https://"))]

    def assert_under(self, path: str, parent: pathlib.Path) -> None:
        assert pathlib.Path(path).resolve().is_relative_to(
            parent.resolve()
        ), f"{path!r} is not under {parent!r}"


@pytest.fixture
def app(tmp_path):
    a = ElectronApp(tmp_path)
    try:
        a.start()
        yield a
    finally:
        a.stop()
