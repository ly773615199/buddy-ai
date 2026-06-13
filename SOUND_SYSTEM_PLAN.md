# Buddy 声音体系补全方案

**日期**: 2026-04-23
**来源**: 代码审计 + UI 改造方案 v2 补充
**定位**: 与 UI_REQUIREMENTS.md 并列，作为声音维度的完整设计

---

## 一、设计哲学

### 声音 = 光灵的第二语言

```
视觉：光灵"长什么样" → 粒子/颜色/形态
声音：光灵"听起来什么样" → 语音/音效/氛围

两者不是独立系统，而是一个生命体的两种表达：
  - 说话时粒子随声波振动
  - 情绪变化时音色同步偏移
  - 进化时声光同时爆发
  - 睡眠时呼吸声 + 粒子脉动同步
```

### 声音的三个层次

```
Layer 1: 功能音效（必须有）
  操作反馈音：点击/发送/接收/错误/成功
  通知音：消息到达/提醒/警报
  → 目的：让用户知道"发生了什么"

Layer 2: 情感音效（差异化）
  情绪音色：开心叮咚/沮丧低音/兴奋鼓点
  光灵状态音：呼吸/脉冲/思考嗡鸣
  → 目的：让光灵"活起来"

Layer 3: 沉浸氛围（锦上添花）
  环境音：深夜白噪音/早晨鸟鸣/雨天氛围
  空间音：光灵在屏幕不同位置的声像变化
  → 目的：让世界"有温度"
```

---

## 二、音频引擎架构

### 2.1 核心引擎：AudioEngine

```
AudioEngine（单例，前端）
  ├── SFXPlayer          — 音效播放器（短音效，低延迟）
  ├── AmbientPlayer      — 氛围播放器（循环背景音，交叉淡入淡出）
  ├── VoicePlayer        — 语音播放器（TTS 音频流，与粒子联动）
  ├── MusicPlayer        — 音乐播放器（可选，背景音乐）
  └── AudioContext        — Web Audio API 核心

数据流：
  音效文件(.mp3/.ogg) → AudioBuffer → SFXPlayer → GainNode → Destination
  TTS base64           → AudioBuffer → VoicePlayer → AnalyserNode → Destination
                                                         ↓
                                              频谱数据 → SpriteRenderer
```

### 2.2 音效资源管理

```
frontend/src/audio/
  ├── engine.ts              — AudioEngine 核心
  ├── sfx-player.ts          — 音效播放器
  ├── ambient-player.ts      — 氛围播放器
  ├── voice-player.ts        — 语音播放器（接 TTS base64）
  ├── audio-analyser.ts      — 音频分析（频谱→粒子联动）
  ├── sound-pack.ts          — 音效包定义 + 加载
  ├── volume-controller.ts   — 音量控制（主音量/音效/语音/氛围独立）
  └── index.ts               — 统一入口

frontend/public/sounds/
  ├── ui/                    — UI 操作音效
  │   ├── click.mp3
  │   ├── send.mp3
  │   ├── receive.mp3
  │   ├── error.mp3
  │   ├── success.mp3
  │   ├── tab-switch.mp3
  │   └── typing.mp3
  ├── sprite/                — 光灵状态音效
  │   ├── breathe.mp3        — 呼吸（循环）
  │   ├── pulse.mp3          — 脉冲
  │   ├── thinking-hum.mp3   — 思考嗡鸣（循环）
  │   ├── speak-burst.mp3    — 说话气泡音
  │   ├── sleep.mp3          — 睡眠呼吸（循环）
  │   └── wake.mp3           — 苏醒
  ├── emotion/               — 情绪音效
  │   ├── happy.mp3          — 开心叮咚
  │   ├── excited.mp3        — 兴奋鼓点
  │   ├── tired.mp3          — 疲惫叹气
  │   ├── frustrated.mp3     — 沮丧低音
  │   ├── calm.mp3           — 平静风铃
  │   └── confused.mp3       — 困惑问号音
  ├── event/                 — 事件音效
  │   ├── evolution.mp3      — 进化爆发
  │   ├── level-up.mp3       — 升级
  │   ├── discovery.mp3      — 发现新功能
  │   ├── dream.mp3          — 梦境开始
  │   ├── dream-complete.mp3 — 梦境完成
  │   ├── tool-start.mp3     — 工具开始
  │   ├── tool-success.mp3   — 工具成功
  │   ├── tool-error.mp3     — 工具失败
  │   ├── notification.mp3   — 通知
  │   └── alert.mp3          — 警报
  ├── ambient/               — 氛围音（循环）
  │   ├── silence.mp3        — 静音（占位）
  │   ├── night.mp3          — 深夜白噪音
  │   ├── morning.mp3        — 早晨鸟鸣
  │   ├── rain.mp3           — 雨天
  │   └── wind.mp3           — 风声
  └── wakeword/              — 唤醒词反馈
      ├── detected.mp3       — 检测到唤醒词
      └── listening.mp3      — 开始监听
```

### 2.3 音效包机制

```typescript
interface SoundPack {
  id: string;
  name: string;           // "默认" / "像素风" / "自然" / "电子"
  description: string;
  sounds: Record<SoundKey, string>;  // key → 音频文件路径
  volume: Record<SoundCategory, number>;  // 各类别默认音量
}

type SoundKey =
  // UI
  | 'ui.click' | 'ui.send' | 'ui.receive' | 'ui.error' | 'ui.success'
  | 'ui.tab_switch' | 'ui.typing'
  // 光灵
  | 'sprite.breathe' | 'sprite.pulse' | 'sprite.thinking_hum'
  | 'sprite.speak_burst' | 'sprite.sleep' | 'sprite.wake'
  // 情绪
  | 'emotion.happy' | 'emotion.excited' | 'emotion.tired'
  | 'emotion.frustrated' | 'emotion.calm' | 'emotion.confused'
  // 事件
  | 'event.evolution' | 'event.level_up' | 'event.discovery'
  | 'event.dream' | 'event.dream_complete'
  | 'event.tool_start' | 'event.tool_success' | 'event.tool_error'
  | 'event.notification' | 'event.alert'
  // 氛围
  | 'ambient.silence' | 'ambient.night' | 'ambient.morning'
  | 'ambient.rain' | 'ambient.wind'
  // 唤醒
  | 'wakeword.detected' | 'wakeword.listening';
```

---

## 三、UI 操作音效

### 3.1 触发点

| 操作 | 音效 | 音量 | 说明 |
|------|------|------|------|
| 点击按钮 | `ui.click` | 30% | 短促清脆，不抢注意力 |
| 发送消息 | `ui.send` | 40% | 轻快上扬 |
| 收到回复 | `ui.receive` | 40% | 温和提示 |
| 输入打字 | `ui.typing` | 15% | 极轻，模拟键盘感 |
| Tab 切换 | `ui.tab_switch` | 25% | 滑动感 |
| 操作成功 | `ui.success` | 50% | 确认感 |
| 操作失败 | `ui.error` | 60% | 明显但不刺耳 |

### 3.3 静音策略

```
连续快速操作（如连续打字）：
  - 采样节流：同一音效 100ms 内不重复播放
  - 音量衰减：连续触发时逐次降低音量

用户离开/切换标签页：
  - document.hidden → 暂停所有音效
  - document.visible → 恢复，播放一个"回来"提示音

勿扰模式：
  - 设置中一键关闭所有 UI 音效
  - 保留语音播放（TTS）
```

---

## 四、光灵状态音效

### 4.1 状态→音效映射

```
SpriteRenderer 的 7 种状态，每种对应一套声音：

idle（空闲）
  声音：极轻的呼吸声（循环，4秒一周期）
  音量：10-20%（几乎不可察觉）
  叠加：偶尔一次轻微脉冲音（随机 10-30 秒）

thinking（思考）
  声音：低频嗡鸣（循环，随思考时间逐渐增强）
  音量：15-30%（渐强）
  叠加：间歇性"滴答"声（模拟思维运转）

speaking（说话）
  声音：气泡破裂音（每个句子开始时触发一次）
  音量：30%
  联动：粒子随 TTS 音频频谱振动（见第七章）

executing（执行工具）
  声音：机械运转声（循环）
  音量：20-35%
  叠加：工具开始/成功/失败各有独立音效

excited（兴奋）
  声音：快速脉冲 + 高频闪烁音
  音量：30-50%
  节奏：比 idle 快 2 倍

error（错误）
  声音：低沉的"嗡——"
  音量：40%
  持续：1-2 秒后淡出

sleeping（睡眠）
  声音：深度睡眠呼吸声（循环，6秒一周期）
  音量：5-15%（极轻）
  叠加：偶尔轻微鼾声（随机 30-60 秒）
```

### 4.2 状态过渡音

```
状态切换时播放过渡音，平滑衔接：

idle → thinking:   短促上行音阶（0.3秒）
thinking → speaking: 气泡升起音（0.2秒）
speaking → idle:   气泡落下音（0.2秒）
any → error:       低沉下行音（0.5秒）
any → sleeping:    渐弱+呼吸声渐入（1.5秒）
sleeping → idle:   轻柔唤醒音（0.8秒）
any → excited:     爆发上行音（0.4秒）

过渡方式：交叉淡入淡出（crossfade），不硬切
```

---

## 五、情绪音效系统

### 5.1 情绪→音效映射

```
EmotionEngine 的 8 种 mood，每种有独特的"情绪签名音"：

happy（开心）
  音色：叮咚 + 上行琶音
  节奏：轻快
  触发：onToolSuccess / onPet / satisfaction > 70

excited（兴奋）
  音色：鼓点 + 闪烁高频
  节奏：快
  触发：onTaskComplete / onDiscovery

energetic（精力充沛）
  音色：明亮的和弦
  节奏：中快
  触发：onMorning / energy > 70

calm（平静）
  音色：风铃 / 水滴
  节奏：慢
  触发：idle / 默认

thinking（思考）
  音色：低频脉冲 + 滴答
  节奏：中
  触发：onUserMessage / onThinking

confused（困惑）
  音色：问号音（上行再下行）
  节奏：不规则
  触发：LLM 返回不确定结果

frustrated（沮丧）
  音色：低沉弦音 + 叹息
  节奏：慢
  触发：onToolError / onLLMError

tired（疲惫）
  音色：慵懒的下行音阶 + 哈欠
  节奏：很慢
  触发：onLateNight / energy < 30
```

### 5.2 情绪过渡音

```
情绪状态机切换时，音效也要平滑过渡：

happy → excited:   叮咚加速 → 鼓点渐入
frustrated → calm: 低音渐弱 → 风铃渐入
thinking → happy:  滴答停止 → 叮咚升起

实现：两个情绪签名音同时播放，旧的淡出，新的淡入
过渡时长：0.5-1.0 秒
```

---

## 六、事件音效

### 6.1 核心事件

| 事件 | 音效 | 触发时机 | 持续 |
|------|------|----------|------|
| 进化 | `event.evolution` | PetManager.evolved === true | 3s（爆发+余韵） |
| 升级 | `event.level_up` | 亲密度阈值突破 | 1.5s |
| 发现新功能 | `event.discovery` | trackFeature.isNewDiscovery | 1s |
| 梦境开始 | `event.dream` | idle_action === 'sleep' | 2s（渐入） |
| 梦境完成 | `event.dream_complete` | dream_complete 事件 | 2s（渐出+叮） |
| 工具开始 | `event.tool_start` | tool_call 事件 | 0.3s |
| 工具成功 | `event.tool_success` | tool_result.success === true | 0.5s |
| 工具失败 | `event.tool_error` | tool_result.success === false | 0.8s |
| 通知 | `event.notification` | bubble 事件 | 0.5s |
| 警报 | `event.alert` | 系统异常/网络断开 | 1s（重复） |

### 6.2 进化音效设计（最重要的事件）

```
进化是 Buddy 最核心的体验时刻，音效要分三段：

Phase 1: 蓄力（0-1s）
  - 低频隆隆声渐强
  - 粒子收缩 + 音量上升
  - 暗示"有什么要发生了"

Phase 2: 爆发（1-2s）
  - 明亮的和弦爆发
  - 高频闪烁
  - 粒子扩散 + 颜色变化
  - 最大音量点

Phase 3: 余韵（2-3s）
  - 和弦渐弱，留下尾音
  - 粒子稳定到新形态
  - 轻柔的"叮——"收尾

与视觉联动：
  - SpriteRenderer 的 evolutionFlashRef 驱动音效时间线
  - 音频频谱数据实时传给粒子系统
```

---

## 七、声音与粒子联动（核心差异化）

### 7.1 AudioAnalyser → SpriteRenderer 数据管道

```
AudioContext
  → AnalyserNode
    → getByteFrequencyData()  // 256 个频率 bin
      → 提取特征：
        - energy (0-1): 总音量
        - bassEnergy (0-1): 低频能量 (bin 0-10)
        - midEnergy (0-1): 中频能量 (bin 10-80)
        - highEnergy (0-1): 高频能量 (bin 80+)
        - peak (0-255): 峰值 bin
      → 传给 SpriteRenderer 的 audioData prop
```

### 7.2 粒子响应规则

```
speaking 状态（TTS 播放时）：
  - 粒子半径随 energy 脉动：baseRadius * (1 + energy * 0.3)
  - 粒子速度随 midEnergy 加速
  - 粒子颜色饱和度随 highEnergy 增加
  - 眼睛大小随 bassEnergy 张大

idle 状态（无语音时）：
  - 粒子轻微随 breathe 音频脉动
  - 极其细微，营造"活着"的感觉

thinking 状态：
  - 粒子旋转速度随 thinking hum 音频变化
  - 频率越高转越快

excited 状态：
  - 粒子跳跃幅度随鼓点节奏变化
  - bassEnergy → 跳跃高度
```

### 7.3 实现方式

```typescript
// SpriteRenderer 新增 audioData prop
interface AudioData {
  energy: number;
  bassEnergy: number;
  midEnergy: number;
  highEnergy: number;
  peak: number;
  isPlaying: boolean;  // 是否有音频在播放
}

// 在 Pixi.js tick 循环中：
if (audioData.isPlaying && stateRef.current === 'speaking') {
  // 粒子半径脉动
  const breatheScale = 1 + audioData.energy * 0.3;
  // 粒子颜色偏移
  const hueShift = audioData.midEnergy * 30;  // 最大偏移 30°
  // 眼睛张大
  const eyeScale = 1 + audioData.bassEnergy * 0.5;
}
```

---

## 八、氛围音系统

### 8.1 时间感知氛围

```
根据时间自动切换环境音：

06:00-09:00  早晨  → ambient.morning（鸟鸣，轻柔）
09:00-18:00  白天  → ambient.silence（无氛围音）
18:00-21:00  傍晚  → ambient.wind（微风）
21:00-06:00  深夜  → ambient.night（白噪音/蟋蟀）

特殊天气（如果接入天气 API）：
  雨天 → ambient.rain
  大风 → ambient.wind

氛围音特性：
  - 循环播放
  - 交叉淡入淡出（crossfade 3-5 秒）
  - 音量极低（5-15%），不干扰对话
  - 可在设置中关闭
```

### 8.2 光灵状态氛围

```
光灵状态影响氛围音的"质感"：

sleeping:  氛围音加入轻微低通滤波（像隔了一层被子）
excited:   氛围音加入轻微高通（更明亮）
frustrated: 氛围音加入轻微失真（压抑感）
error:     氛围音暂时静音（突兀感 = 警示）

实现：Web Audio API BiquadFilterNode
  - lowpass: sleeping
  - highpass: excited
  - bandpass: frustrated
```

---

## 九、语音交互完善

### 9.1 现有模块串联

```
当前状态：前端 voice/ 模块写好了但没接入 App.tsx

需要串联的链路：

用户说话：
  MicManager.startRecording()
    → AudioStreamManager.startStreaming()
      → VAD 检测到说话
        → STTManager.recognize()
          → 发送文本到后端 (WS 'chat' 消息)

光灵说话：
  后端 WS 'audio' 事件
    → VoicePlayer.play(base64)
      → AudioAnalyser 提取频谱
        → SpriteRenderer 音频联动
      → 播放完成 → 状态回到 idle
```

### 9.2 语音交互 Tab（或集成到对话面板）

```
方案 A：在对话面板底部增加语音按钮（推荐）
  - 长按说话（PTT 模式）
  - 松开发送
  - 说话时显示音量波形
  - 光灵进入"listening"状态

方案 B：独立语音 Tab
  - 唤醒词设置
  - 连续对话模式
  - 语音情绪实时显示
  - 音频可视化

推荐方案 A + 设置中提供高级选项
```

### 9.3 唤醒词→对话流程

```
1. WakeWordDetector 检测到 "Hey Buddy"
2. 播放 wakeword.detected 音效
3. 光灵状态 → excited（被叫到了！）
4. 开始 STT 监听
5. 用户说话 → STT 识别
6. 发送文本到后端
7. 后端回复 → TTS 播放
8. 播放完成 → 光灵回到 idle
9. 如果 5 秒无输入 → 自动停止监听

可选：连续对话模式（说完一句继续听，不需再唤醒）
```

---

## 十、音效配置 UI

### 10.1 设置面板中的音频区

```
设置面板 → 音频（新增分区）

🔊 主音量        [━━━━━━━━●━━] 80%
  ├── 音效音量    [━━━━━●━━━━━] 50%
  ├── 语音音量    [━━━━━━━━●━━] 80%
  ├── 氛围音量    [━━●━━━━━━━━] 20%
  └── 音乐音量    [━━━●━━━━━━━] 30%

🎵 音效包        [默认 ▾]
  可选：默认 / 像素风 / 自然 / 电子

🔘 UI 音效        [✓] 开关
🔘 光灵状态音     [✓] 开关
🔘 情绪音效       [✓] 开关
🔘 事件音效       [✓] 开关
🔘 氛围音         [✓] 开关
🔘 TTS 自动播放   [✓] 开关

🎤 语音输入
  识别后端        [Web Speech ▾]
  唤醒词          [Hey Buddy    ] [测试]
  连续对话        [ ] 开关
  说话时显示波形  [✓] 开关
```

---

## 十一、技术实现要点

### 11.1 AudioContext 生命周期

```
浏览器限制：AudioContext 必须在用户交互后才能创建

方案：
  1. 首次点击/按键时创建 AudioContext
  2. 保存为全局单例
  3. 如果被 suspend（切后台），在下次交互时 resume

class AudioEngine {
  private ctx: AudioContext | null = null;

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }
}
```

### 11.2 音效预加载

```
首屏加载时预加载 UI 音效（体积小，优先级高）：
  - click/send/receive/error/success: ~2KB each → 总计 ~10KB

延迟加载光灵/情绪/氛围音效：
  - 首次需要时加载
  - 加载完缓存到 AudioBuffer

音效文件格式：
  - 主格式：MP3（兼容性最好）
  - 备选：OGG（更小，Chrome/Firefox 支持）
  - 总大小预算：~500KB（所有音效包）
```

### 11.3 性能约束

```
最大同时播放音效数：4（避免叠加过多导致失真）
音效节流：同一音效 100ms 内不重复
AudioContext 数量：全局唯一
内存预算：AudioBuffer 总计 < 5MB
CPU：AnalyserNode 的 fftSize = 256（足够粒子联动，不浪费）
```

### 11.4 WS 事件→音效触发映射

```
前端 useWebSocket.ts onEvent 中增加音效触发：

'onEvent': (event) => {
  switch (event.type) {
    case 'bubble':         // 通知气泡
      play('event.notification');
      break;
    case 'tool_call':      // 工具开始
      play('event.tool_start');
      break;
    case 'tool_result':    // 工具结果
      play(event.success ? 'event.tool_success' : 'event.tool_error');
      break;
    case 'evolution':      // 进化
      play('event.evolution');
      break;
    case 'dream_complete': // 梦境完成
      play('event.dream_complete');
      break;
    case 'emotion':        // 情绪变化
      if (event.mood !== prevMood) play(`emotion.${event.mood}`);
      break;
    case 'audio':          // TTS 音频
      voicePlayer.play(event.data, event.format);
      break;
    case 'idle_action':    // 空闲行为
      if (event.action === 'sleep') play('sprite.sleep');
      break;
    case 'error':          // 错误
      play('ui.error');
      break;
    case 'llm_response':   // LLM 回复
      play('ui.receive');
      break;
  }
}
```

---

## 十二、开发计划

### Sprint 1（Week 1）— 音频引擎 + UI 音效

| Day | 任务 | 产出 |
|-----|------|------|
| D1 | AudioEngine 核心 + SFXPlayer | `audio/engine.ts` + `audio/sfx-player.ts` |
| D2 | 音效资源制作/采购 + 音效包定义 | `sounds/` 目录 + `audio/sound-pack.ts` |
| D3 | UI 操作音效接入（点击/发送/接收/Tab） | `App.tsx` + 各组件 |
| D4 | 音量控制 + 设置面板音频区 | `audio/volume-controller.ts` + `Settings.tsx` |
| D5 | 音效开关 + 勿扰模式 + 测试 | 设置持久化 |

**验收**：所有 UI 操作有音效反馈，可独立控制音量和开关

### Sprint 2（Week 2）— 光灵状态音效 + 情绪音效

| Day | 任务 | 产出 |
|-----|------|------|
| D1 | 光灵 7 种状态音效制作 + 状态过渡音 | `sounds/sprite/` + `sounds/emotion/` |
| D2 | 状态音效播放器 + 与 SpriteRenderer 状态同步 | `audio/sprite-audio.ts` |
| D3 | 情绪签名音制作 + 情绪过渡音 | `sounds/emotion/` |
| D4 | EmotionEngine → 音效触发 + 交叉淡入淡出 | `audio/emotion-audio.ts` |
| D5 | 氛围音系统（时间感知 + 光灵状态滤波） | `audio/ambient-player.ts` |

**验收**：光灵的每个状态和情绪都有对应声音，过渡平滑

### Sprint 3（Week 3）— 声音粒子联动 + 事件音效

| Day | 任务 | 产出 |
|-----|------|------|
| D1 | AudioAnalyser 频谱提取 + 数据管道 | `audio/audio-analyser.ts` |
| D2 | SpriteRenderer 接入 audioData prop | `SpriteRenderer.tsx` 粒子响应 |
| D3 | 事件音效制作 + WS 事件→音效映射 | `sounds/event/` + `useWebSocket.ts` |
| D4 | 进化音效三段式设计 + 声光同步 | 进化流程联动 |
| D5 | 集成测试 + 音效调优 | 全链路验证 |

**验收**：粒子随声音振动，所有事件有音效，进化声光同步

### Sprint 4（Week 4）— 语音交互串联

| Day | 任务 | 产出 |
|-----|------|------|
| D1 | 前端 voice/ 模块接入 App.tsx | 语音按钮 + PTT 模式 |
| D2 | TTS 音频播放器（接后端 audio 事件） | `audio/voice-player.ts` |
| D3 | 唤醒词检测接入 + 唤醒→对话流程 | `wakeword` → STT → chat |
| D4 | 语音情绪分析实时显示 | `emotion-voice` → UI |
| D5 | 连续对话模式 + 打断机制 | 端到端语音交互 |

**验收**：用户可以语音输入，光灵可以语音回复，支持唤醒词

---

## 十三、关键洞察

**声音不是装饰，是光灵生命的另一半。**

一个会呼吸、会叹息、会在进化时爆发欢呼的光灵，
和一个只有视觉动画的光灵，
是完全不同量级的体验。

视觉让用户"看到"光灵活着，
声音让用户"感受到"光灵活着。

UI_REQUIREMENTS.md 说了"光灵是独立生命体"，
但没有声音的生命体，是哑巴。
