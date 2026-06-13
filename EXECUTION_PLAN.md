# 四项改造执行计划

优先级：4 → 2 → 3 → 1

## Task 4: 信号汇聚层接入主循环 ✅ `a0f7c20`
- OnlineLearner 新增 ingestSample(): 仅入 Buffer 不触发权重更新
- RightBrain 新增 ingestExternalSample()
- Subsystems 实例化 SignalConvergenceLayer 并接入 3 个源模块
- Agent 中接入 ReasoningChainStore → 汇聚层
- 汇聚层输出统一写入右脑 ReplayBuffer

## Task 2: 小脑读真实指标 ✅ `d1b08be`
- 新增 updateSystemMetrics(): 从 process.memoryUsage() + os.loadavg() 计算真实 load
- load = 60% 内存使用率 + 40% CPU 负载（加权）
- temperature 直接映射 CPU 负载
- systemHealth 基于真实指标判定
- energy 衰减根据真实交互间隔动态调整

## Task 3: 在线学习安全阀 ✅ `338ebc8`
- OnlineLearnConfig 新增 observeOnly / observeRounds / convergenceThreshold / convergencePatience
- update() 在 observeOnly=true 时只计算 loss 不更新权重
- loss 连续 N 轮变化 < 阈值 → 自动切换到真实更新
- 新增 safetyValveStatus 暴露安全阀状态

## Task 1: 三脑 A/B 对比 ✅ `e7b2c1a`
- orchestrate() 支持 A/B 对比模式（setABTest 启用/禁用）
- 决策追踪记录 path + latencyMs
- getABStats() 返回两条路径的对比统计
- 默认关闭，需手动 setABTest(true) 启用
