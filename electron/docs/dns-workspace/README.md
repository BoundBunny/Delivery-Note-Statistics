# DNS 场景工作台设计记录

本目录保留设计历史。2026-11-09 起，示例数据控制器和重复场景源码已移除。正式页面唯一入口为 electron/webapp/index.html。

- 场景：renderer/warehouse-scene.js
- 业务控制器：renderer/desktop.js
- 外壳模板与样式：renderer/src/
- 构建产物：renderer/generated/，通过 npm run build:desktop-assets 生成
- 预览与验证：npm start、npm run test:desktop、npm run test:3d

全部数据由 Store 提供；不再维护独立示例业务逻辑。
