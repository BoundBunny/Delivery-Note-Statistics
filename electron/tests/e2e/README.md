# delivery-note Electron 端到端测试（Python + Playwright + pytest）

针对用户三个硬要求做自动化验证：

1. **数据不流失** —— 增删改、重启、崩溃、写失败回滚、备份恢复都不能丢数据或写脏数据。
2. **顺畅不卡顿** —— 启动、模块切换、大数据量渲染有时延预算。
3. **不在硬盘乱下载** —— 导出/分享/商品图片只落在指定目录，全程离线无网络。

## 为什么是「CDP + Playwright」而不是 `p.electron`

Python 版 Playwright 没有 Electron 启动 API（`_electron` 只在 Node 端）。但 Electron 会开
Chrome DevTools Protocol 端口，所以我们：

1. 用 `--remote-debugging-port=<free>` 启动**真实的 `electron.exe`**（真实 main.js / preload.js / IPC）；
2. `chromium.connect_over_cdp()` 用 Playwright 接管真实渲染进程；
3. 用 `DNS_TEST_*` 环境变量（main.js 里的测试钩子）把所有副作用隔离到 pytest 临时目录。

因此主进程、preload 桥、真实磁盘写入都被真实执行，没有 mock 外壳。

## 隔离用的环境变量（main.js 测试钩子，未设置时行为与生产完全一致）

| 变量 | 作用 |
| --- | --- |
| `DNS_TEST_USER_DATA` | 把 `userData`（localStorage/window-state/单实例锁）指向临时目录 |
| `DNS_TEST_SAVE_DIR` | `saveFile` / `shareFile` 跳过系统弹窗，直接写入该目录 |
| `DNS_TEST_IMAGE_DIR` | 覆盖默认商品图片目录 `CommercesData` |
| `DNS_TEST_PICK_FILE` | `pickFile` 直接用该文件，跳过打开对话框 |
| `DNS_TEST_PICK_IMAGE_SRC` | `pickProductImage` 直接用该图片，跳过打开对话框 |

APPDATA/LOCALAPPDATA/TEMP 也指向临时目录，连 Chromium 自己的缓存都不外溢。

## 运行

```bash
python -m pip install -r tests/e2e/requirements.txt
python -m pytest tests/e2e -q
# 并行（每个用例独立 profile + 独立端口）
python -m pytest tests/e2e -q -n auto
```

依赖本机 `E:\github\delivery-note\electron\node_modules\electron\dist\electron.exe`。

## 用例分布

- `test_data_integrity.py`(8)：启动冒烟、种子幂等、CRUD 重启保留、硬杀后数据/不重复、
  事务回滚、写失败无半成品、备份导出恢复往返、单实例锁。
- `test_disk_hygiene.py`(5)：普通保存只落测试目录、反复分享不堆叠、商品图片只进图片目录无残留、
  Excel 导出落盘、零 http(s) 请求。
- `test_performance.py`(4)：启动预算、模块切换预算、300 单写入+渲染预算、反复切换无异常。

## 已知限制（重要）

Chromium 的 localStorage 是**约每 5 秒批量落盘**一次。因此：

- 正常关闭窗口 / 正常重启：数据必然已持久化（已由 `test_crud_persists_across_restart` 验证）。
- 进程被强杀（任务管理器）：最后 ~5 秒内的写可能丢失。`test_data_survives_hard_kill_without_duplication`
  先等待刷盘再杀，验证「已落盘的数据强杀不丢、且不产生重复单据」。

若要「强杀也零丢失最近一次保存」，需要产品层面把关键写入同步镜像到一个文件（走 IPC 落盘），
而不是只依赖 localStorage。这是后续可选加固项。
