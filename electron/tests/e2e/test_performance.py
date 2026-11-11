"""性能与顺畅：启动、模块切换、大数据渲染的时延预算（宽松阈值，防回归）。"""
import time

from conftest import ElectronApp


def _nav(app, route: str) -> float:
    """切换模块并返回耗时(ms)。"""
    return app.eval(
        """async (route) => {
            const t0 = performance.now();
            await DNSDesktop.navigate(route);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return performance.now() - t0;
        }""",
        route,
    )


def test_startup_within_budget(tmp_path):
    a = ElectronApp(tmp_path)
    try:
        a.start()
        assert a.startup_seconds is not None
        assert a.startup_seconds < 15.0, f"startup took {a.startup_seconds:.1f}s"
        assert a.page_errors == [], a.page_errors
    finally:
        a.stop()


def test_panel_navigation_within_budget(app):
    routes = ["#/orders", "#/products", "#/customers", "#/stats", "#/home"]
    timings = {}
    for route in routes:
        timings[route] = _nav(app, route)
    assert app.page_errors == [], app.page_errors
    slow = {r: round(ms, 1) for r, ms in timings.items() if ms > 2000}
    assert not slow, f"module switch too slow: {slow}"
    # 至少要有一次切换被真实测得（>0）
    assert any(ms > 0 for ms in timings.values())


def test_bulk_orders_render_within_budget(app):
    write_ms = app.eval(
        """(n) => {
            const t0 = performance.now();
            Store.transaction(() => {
                for (let i = 0; i < n; i++) {
                    Store.addOrder({
                        no: 'BULK-' + i, date: '2026-11-10', customer: null,
                        items: [{ name: '货' + i, qty: 1, price: 1, amount: 1 }], total: 1
                    });
                }
            });
            return performance.now() - t0;
        }""",
        300,
    )
    assert write_ms < 3000, f"writing 300 orders took {write_ms:.0f}ms"
    render_ms = _nav(app, "#/orders")
    assert render_ms < 3000, f"rendering 300 orders took {render_ms:.0f}ms"
    assert app.eval("() => Store.countAll().orders") == 300
    assert app.page_errors == [], app.page_errors


def test_repeated_panel_switch_does_not_leak_errors(app):
    for _ in range(3):
        for route in ("#/orders", "#/stats", "#/home"):
            _nav(app, route)
    # 反复切换后不应有未捕获异常、DOM 根仍在
    assert app.page_errors == [], app.page_errors
    assert app.eval("() => !!document.querySelector('#desktop-app')") is True
    assert app.eval("() => Store.countAll().orders >= 0") is True
