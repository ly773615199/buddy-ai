# 传感器模块 — 前端/桌面端专用

> ⚠️ 此目录下的模块使用浏览器/设备 API（`geolocation`、`DeviceMotionEvent`、`AmbientLightSensor` 等），
> **无法在 Node.js 后端运行**。

## 模块列表

| 模块 | 功能 | 浏览器 API |
|------|------|-----------|
| location.ts | 地理位置 | `navigator.geolocation` |
| motion.ts | 运动/方向传感器 | `DeviceMotionEvent`, `DeviceOrientationEvent` |
| environment.ts | 环境传感器 | `AmbientLightSensor`, `navigator.connection` |
| sensors.ts | 传感器统一管理 | 聚合以上模块 |
| sensor-interface.ts | 传感器接口定义 | 类型引用 |
| context-fusion.ts | 物理上下文融合 | 聚合所有传感器数据 |

## 后端保留模块

后端 `src/perception/` 保留以下 Node.js 可用模块：
- `observer.ts` — 环境感知器
- `fs-watcher.ts` — 文件变更监听
- `event-bus.ts` — 事件总线
- `privacy.ts` — 隐私管理
- `types.ts` — 共享类型定义
