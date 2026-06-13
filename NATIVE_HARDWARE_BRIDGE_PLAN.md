# Buddy 移动端原生硬件桥实现计划

> 目标：让 Buddy 现有的耳朵（麦克风）、嘴巴（TTS）、眼睛（摄像头）能力在移动端原生运行，不依赖付费第三方服务，全部自研。

---

## 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                  WebView（现有前端）                      │
│  现有代码全部复用，零改动                                  │
│  emotion-voice.ts / sound-events.ts / wakeword.ts       │
│  camera.ts / face-detect.ts / scene-analyze.ts / ocr.ts │
└──────────────────────┬──────────────────────────────────┘
                       │ Capacitor Bridge (JS ↔ Native)
┌──────────────────────▼──────────────────────────────────┐
│               Capacitor 原生插件层                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 🎤 麦克风插件  │  │ 🔊 音频播放插件│  │ 👁️ 摄像头插件 │   │
│  │ PCM 实时帧    │  │ 原生音频会话  │  │ JPEG 实时帧   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │            │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐   │
│  │ iOS:         │  │ iOS:         │  │ iOS:         │   │
│  │ AVAudioEngine│  │ AVAudioPlayer│  │ AVCaptureSes.│   │
│  │ Android:     │  │ Android:     │  │ Android:     │   │
│  │ AudioRecord  │  │ MediaPlayer  │  │ CameraX      │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 第一部分：🎤 耳朵 — 原生麦克风桥

### 问题

移动端 WebView 中 `navigator.mediaDevices.getUserMedia()` 不可靠：
- iOS Safari 必须 HTTPS + 用户手势触发
- 部分 Android WebView 不支持 `MediaRecorder`
- `AudioContext` + `AnalyserNode` 实时处理在 WebView 中不稳定

### 方案

写一个 Capacitor 插件，用原生 API 采集 PCM 音频帧，通过事件推送给 WebView。

### 1.1 iOS 端实现（Swift）

**文件**：`ios/App/App/Plugins/NativeAudioPlugin.swift`

```swift
import AVFoundation
import Capacitor

@objc(NativeAudioPlugin)
public class NativeAudioPlugin: CAPPlugin {
    private var audioEngine: AVAudioEngine?
    private var isRecording = false
    private let sampleRate: Double = 16000

    @objc func startRecording(_ call: CAPPluginCall) {
        // 1. 请求麦克风权限
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else {
                call.reject("麦克风权限被拒绝")
                return
            }
            DispatchQueue.main.async {
                self.doStartRecording(call)
            }
        }
    }

    private func doStartRecording(_ call: CAPPluginCall) {
        // 2. 配置音频会话
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try? session.setPreferredSampleRate(sampleRate)
        try? session.setActive(true)

        // 3. 创建音频引擎
        audioEngine = AVAudioEngine()
        let inputNode = audioEngine!.inputNode
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        )

        // 4. 安装 tap，实时获取 PCM 帧
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self, self.isRecording else { return }
            let data = self.bufferToData(buffer)
            // 5. 通过 Capacitor 事件推送给 JS
            self.notifyListeners("audioFrame", data: [
                "pcm": data.base64EncodedString(),
                "sampleRate": self.sampleRate,
                "channels": 1,
                "frameSize": buffer.frameLength
            ])
        }

        // 6. 启动
        try? audioEngine?.start()
        isRecording = true
        call.resolve(["status": "recording"])
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        isRecording = false
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        call.resolve(["status": "stopped"])
    }

    private func bufferToData(_ buffer: AVAudioPCMBuffer) -> Data {
        let floatData = buffer.floatChannelData![0]
        let count = Int(buffer.frameLength)
        // Float32 → Int16 PCM（兼容 Web Audio API）
        var int16Data = [Int16](repeating: 0, count: count)
        for i in 0..<count {
            int16Data[i] = Int16(max(-32768, min(32767, floatData[i] * 32767)))
        }
        return Data(bytes: int16Data, count: count * 2)
    }
}
```

### 1.2 Android 端实现（Kotlin）

**文件**：`android/app/src/main/java/com/buddy/ai/NativeAudioPlugin.kt`

```kotlin
package com.buddy.ai

import android.Manifest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "NativeAudio",
    permissions = [
        Permission(
            alias = "microphone",
            strings = [Manifest.permission.RECORD_AUDIO]
        )
    ]
)
class NativeAudioPlugin : Plugin() {
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private var recordThread: Thread? = null
    private val sampleRate = 16000
    private val bufferSize = AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT
    )

    @PluginMethod
    fun startRecording(call: PluginCall) {
        if (ActivityCompat.checkSelfPermission(
                context, Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionForAlias("microphone", call, "handleMicPermission")
            return
        }
        doStartRecording(call)
    }

    private fun doStartRecording(call: PluginCall) {
        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize * 2
        )

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            call.reject("AudioRecord 初始化失败")
            return
        }

        isRecording = true
        audioRecord?.startRecording()

        // 后台线程读取 PCM 帧，推送给 JS
        recordThread = Thread {
            val buffer = ByteArray(bufferSize)
            while (isRecording) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                if (read > 0) {
                    val data = buffer.copyOf(read)
                    notifyListeners("audioFrame", JSObject().apply {
                        put("pcm", android.util.Base64.encodeToString(
                            data, android.util.Base64.NO_WRAP
                        ))
                        put("sampleRate", sampleRate)
                        put("channels", 1)
                        put("frameSize", read / 2) // Int16 = 2 bytes per sample
                    })
                }
            }
        }.apply { start() }

        call.resolve(JSObject().apply { put("status", "recording") })
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        isRecording = false
        recordThread?.join(1000)
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        call.resolve(JSObject().apply { put("status", "stopped") })
    }

    @PermissionCallback
    private fun handleMicPermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStartRecording(call)
        } else {
            call.reject("麦克风权限被拒绝")
        }
    }
}
```

### 1.3 JS Bridge 层

**文件**：`frontend/src/voice/native-audio-bridge.ts`

```typescript
/**
 * 原生音频桥
 * 将 Capacitor 原生麦克风的 PCM 帧注入 Web Audio API
 * 供现有 emotion-voice.ts / sound-events.ts / wakeword.ts / audio-stream.ts 使用
 */

import { registerPlugin } from '@capacitor/core';

interface NativeAudioPlugin {
  startRecording(): Promise<{ status: string }>;
  stopRecording(): Promise<{ status: string }>;
  addListener(event: 'audioFrame', callback: (data: AudioFrameData) => void): Promise<PluginListenerHandle>;
}

interface AudioFrameData {
  pcm: string;        // base64 编码的 Int16 PCM
  sampleRate: number;
  channels: number;
  frameSize: number;
}

interface PluginListenerHandle {
  remove(): Promise<void>;
}

const NativeAudio = registerPlugin<NativeAudioPlugin>('NativeAudio');

export class NativeAudioBridge {
  private audioContext: AudioContext | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private listenerHandle: PluginListenerHandle | null = null;
  private isNativeMode = false;
  private pcmBuffer: Float32Array[] = [];

  /**
   * 检测是否需要原生模式
   * getUserMedia 失败时降级到原生
   */
  async needsNativeMode(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return false; // 浏览器 API 可用，不需要原生
    } catch {
      return true; // 浏览器 API 不可用，需要原生桥
    }
  }

  /**
   * 启动原生录音，创建 Web Audio 管线
   * 返回 MediaStream 供现有代码使用
   */
  async start(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // 监听原生层推送的 PCM 帧
    this.listenerHandle = await NativeAudio.addListener('audioFrame', (data) => {
      this.handleNativeFrame(data);
    });

    await NativeAudio.startRecording();
    this.isNativeMode = true;
  }

  /**
   * 处理原生 PCM 帧 → 注入 Web Audio 管线
   */
  private handleNativeFrame(data: AudioFrameData): void {
    if (!this.audioContext) return;

    // base64 → Int16 → Float32
    const raw = atob(data.pcm);
    const int16 = new Int16Array(raw.length / 2);
    for (let i = 0; i < int16.length; i++) {
      int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    // 推入缓冲区，供 ScriptProcessorNode 消费
    this.pcmBuffer.push(float32);

    // 通知音量回调（供 VAD / 唤醒词使用）
    let energy = 0;
    for (let i = 0; i < float32.length; i++) energy += float32[i] * float32[i];
    energy = Math.sqrt(energy / float32.length);
    this.onVolumeCallback?.(energy);
  }

  /**
   * 创建一个伪 MediaStream，内含 ScriptProcessorNode
   * 现有的 AnalyserNode 代码可以从中获取数据
   */
  createAnalyserNode(): AnalyserNode | null {
    if (!this.audioContext) return null;
    return this.audioContext.createAnalyser();
  }

  /**
   * 停止原生录音
   */
  async stop(): Promise<void> {
    this.isNativeMode = false;
    await NativeAudio.stopRecording();
    await this.listenerHandle?.remove();
    this.listenerHandle = null;
    this.audioContext?.close();
    this.audioContext = null;
  }

  private onVolumeCallback: ((level: number) => void) | null = null;

  onVolume(callback: (level: number) => void): void {
    this.onVolumeCallback = callback;
  }
}
```

### 1.4 集成到现有代码

**改动文件**：`frontend/src/voice/mic-manager.ts`（~20 行改动）

```typescript
// 在 startRecording() 方法中添加降级逻辑
import { NativeAudioBridge } from './native-audio-bridge.js';

private nativeBridge: NativeAudioBridge | null = null;

async startRecording(constraints?: MicConstraints): Promise<void> {
  if (this.stream) throw new Error('麦克风已在使用中');

  try {
    // 尝试浏览器 API
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ... } });
  } catch {
    // 降级到原生桥
    console.log('[Mic] 浏览器 API 不可用，降级到原生麦克风');
    this.nativeBridge = new NativeAudioBridge();
    await this.nativeBridge.start();
    // 原生模式下，音量通过回调获取
    this.nativeBridge.onVolume((level) => {
      for (const cb of this.volumeCallbacks) cb(level);
    });
  }
}
```

### 1.5 工作量估算

| 任务 | 工作量 |
|---|---|
| iOS 原生插件 | ~120 行 Swift |
| Android 原生插件 | ~100 行 Kotlin |
| JS Bridge | ~150 行 TypeScript |
| mic-manager.ts 改动 | ~20 行 |
| capacitor.config.ts 配置 | ~10 行 |
| 测试 | ~2h |
| **合计** | **~400 行 + 2h 测试** |

---

## 第二部分：👄 嘴巴 — TTS 原生播放

### 现状

TTS 合成在后端（Edge TTS WebSocket），合成后返回 MP3 base64。前端播放用 `<audio>` 元素或 `AudioContext.decodeAudioData()`。

### 问题

移动端 WebView 中音频播放有限制：
- iOS Safari 要求用户手势触发才能播放
- 后台播放可能被系统中断
- 通知栏/锁屏无媒体控制

### 方案

加一个原生音频播放插件，接收 base64 MP3 数据，用原生播放器播放。

### 2.1 iOS 端实现

```swift
@objc(NativeAudioPlugin)
public class NativeAudioPlugin: CAPPlugin {
    // ... 麦克风部分同上 ...

    private var audioPlayer: AVAudioPlayer?

    @objc func playAudio(_ call: CAPPluginCall) {
        guard let base64 = call.getString("audio"),
              let data = Data(base64Encoded: base64) else {
            call.reject("无效的音频数据")
            return
        }

        do {
            // 配置音频会话为播放模式
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)

            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.delegate = self
            audioPlayer?.play()

            // 设置锁屏媒体信息
            setupNowPlaying(title: call.getString("title") ?? "Buddy")

            call.resolve(["status": "playing"])
        } catch {
            call.reject("播放失败: \(error.localizedDescription)")
        }
    }

    @objc func stopAudio(_ call: CAPPluginCall) {
        audioPlayer?.stop()
        call.resolve(["status": "stopped"])
    }

    private func setupNowPlaying(title: String) {
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = "Buddy"
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

extension NativeAudioPlugin: AVAudioPlayerDelegate {
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        notifyListeners("audioPlaybackComplete", data: ["success": flag])
    }
}
```

### 2.2 Android 端实现

```kotlin
@PluginMethod
fun playAudio(call: PluginCall) {
    val base64 = call.getString("audio") ?: run {
        call.reject("无效的音频数据")
        return
    }

    val data = Base64.decode(base64, Base64.DEFAULT)
    val tempFile = File.createTempFile("buddy-tts", ".mp3", context.cacheDir)
    tempFile.writeBytes(data)

    mediaPlayer?.release()
    mediaPlayer = MediaPlayer().apply {
        setDataSource(tempFile.absolutePath)
        setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build())
        setOnCompletionListener {
            notifyListeners("audioPlaybackComplete", JSObject().apply {
                put("success", true)
            })
            tempFile.delete()
        }
        prepare()
        start()
    }

    call.resolve(JSObject().apply { put("status", "playing") })
}

@PluginMethod
fun stopAudio(call: PluginCall) {
    mediaPlayer?.stop()
    mediaPlayer?.release()
    mediaPlayer = null
    call.resolve(JSObject().apply { put("status", "stopped") })
}
```

### 2.3 JS Bridge

```typescript
// 在 NativeAudioBridge 中添加播放方法
async playAudio(base64Mp3: string, title?: string): Promise<void> {
  await NativeAudio.playAudio({ audio: base64Mp3, title });
}

async stopAudio(): Promise<void> {
  await NativeAudio.stopAudio();
}
```

### 2.4 工作量估算

| 任务 | 工作量 |
|---|---|
| iOS 播放逻辑 | ~80 行 Swift |
| Android 播放逻辑 | ~60 行 Kotlin |
| JS Bridge 扩展 | ~30 行 |
| 锁屏媒体控制 | ~40 行 |
| **合计** | **~210 行** |

---

## 第三部分：👁️ 眼睛 — 原生摄像头桥

### 问题

与麦克风相同：`getUserMedia({ video: true })` 在移动端 WebView 不可靠。

### 方案

原生摄像头插件，实时获取视频帧 JPEG base64，推送给 WebView。

### 3.1 iOS 端实现

```swift
@objc(NativeCameraPlugin)
public class NativeCameraPlugin: CAPPlugin, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var captureSession: AVCaptureSession?
    private var currentDevice: AVCaptureDevice?
    private var isCapturing = false
    private var quality: CGFloat = 0.7

    @objc func startCamera(_ call: CAPPluginCall) {
        let facing = call.getString("facing") ?? "environment" // front/back

        // 1. 请求权限
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else {
                call.reject("摄像头权限被拒绝")
                return
            }
            DispatchQueue.main.async {
                self.doStartCamera(facing: facing, call: call)
            }
        }
    }

    private func doStartCamera(facing: String, call: CAPPluginCall) {
        captureSession = AVCaptureSession()
        captureSession?.sessionPreset = .vga640x480

        // 2. 选择摄像头
        let position: AVCaptureDevice.Position = facing == "user" ? .front : .back
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
            call.reject("摄像头不可用")
            return
        }
        currentDevice = device

        // 3. 配置输入
        guard let input = try? AVCaptureDeviceInput(device: device) else {
            call.reject("摄像头输入配置失败")
            return
        }
        captureSession?.addInput(input)

        // 4. 配置输出（视频帧回调）
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "camera-frame-queue"))
        captureSession?.addOutput(output)

        // 5. 启动
        captureSession?.startRunning()
        isCapturing = true

        call.resolve(["status": "capturing", "facing": facing])
    }

    @objc func stopCamera(_ call: CAPPluginCall) {
        isCapturing = false
        captureSession?.stopRunning()
        captureSession = nil
        call.resolve(["status": "stopped"])
    }

    @objc func switchCamera(_ call: CAPPluginCall) {
        guard let session = captureSession else {
            call.reject("摄像头未启动")
            return
        }

        // 切换前后摄像头
        let currentPosition = currentDevice?.position ?? .back
        let newPosition: AVCaptureDevice.Position = currentPosition == .back ? .front : .back

        guard let newDevice = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: newPosition) else {
            call.reject("切换失败")
            return
        }

        session.beginConfiguration()
        if let currentInput = session.inputs.first {
            session.removeInput(currentInput)
        }
        if let newInput = try? AVCaptureDeviceInput(device: newDevice) {
            session.addInput(newInput)
            currentDevice = newDevice
        }
        session.commitConfiguration()

        call.resolve(["status": "switched", "facing": newPosition == .front ? "user" : "environment"])
    }

    // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

    public func captureOutput(_ output: AVCaptureOutput,
                              didOutput sampleBuffer: CMSampleBuffer,
                              from connection: AVCaptureConnection) {
        guard isCapturing else { return }

        // 6. CMSampleBuffer → UIImage → JPEG base64
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvImageBuffer: imageBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }

        let uiImage = UIImage(cgImage: cgImage, scale: 1.0, orientation: .right)
        guard let jpegData = uiImage.jpegData(compressionQuality: quality) else { return }

        // 7. 推送给 JS
        notifyListeners("cameraFrame", data: [
            "frame": jpegData.base64EncodedString(),
            "width": Int(uiImage.size.width),
            "height": Int(uiImage.size.height),
            "timestamp": Int(Date().timeIntervalSince1970 * 1000)
        ])
    }
}
```

### 3.2 Android 端实现

```kotlin
@CapacitorPlugin(
    name = "NativeCamera",
    permissions = [
        Permission(alias = "camera", strings = [Manifest.permission.CAMERA])
    ]
)
class NativeCameraPlugin : Plugin() {
    private var imageCapture: ImageCapture? = null
    private var imageAnalysis: ImageAnalysis? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var previewView: PreviewView? = null
    private var isCapturing = false
    private var frameIntervalMs = 200L // 每 200ms 一帧

    @PluginMethod
    fun startCamera(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "handleCameraPermission")
            return
        }

        val facing = call.getString("facing") ?: "environment"
        val interval = call.getInt("intervalMs") ?: 200
        frameIntervalMs = interval.toLong()

        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            bindCameraUseCases(facing, call)
        }, ContextCompat.getMainExecutor(context))
    }

    private fun bindCameraUseCases(facing: String, call: PluginCall) {
        val cameraSelector = if (facing == "user") {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }

        // 图像分析用例：实时帧回调
        imageAnalysis = ImageAnalysis.Builder()
            .setTargetResolution(android.util.Size(640, 480))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        var lastFrameTime = 0L

        imageAnalysis?.setAnalyzer(ContextCompat.getMainExecutor(context)) { imageProxy ->
            val now = System.currentTimeMillis()
            if (isCapturing && now - lastFrameTime >= frameIntervalMs) {
                lastFrameTime = now

                // YUV → JPEG → base64
                val jpeg = imageProxyToJpeg(imageProxy)
                if (jpeg != null) {
                    val base64 = Base64.encodeToString(jpeg, Base64.NO_WRAP)
                    notifyListeners("cameraFrame", JSObject().apply {
                        put("frame", base64)
                        put("width", imageProxy.width)
                        put("height", imageProxy.height)
                        put("timestamp", now)
                    })
                }
            }
            imageProxy.close()
        }

        try {
            cameraProvider?.unbindAll()
            cameraProvider?.bindToLifecycle(
                context as LifecycleOwner,
                cameraSelector,
                imageAnalysis
            )
            isCapturing = true
            call.resolve(JSObject().apply {
                put("status", "capturing")
                put("facing", facing)
            })
        } catch (e: Exception) {
            call.reject("摄像头启动失败: ${e.message}")
        }
    }

    @PluginMethod
    fun stopCamera(call: PluginCall) {
        isCapturing = false
        cameraProvider?.unbindAll()
        call.resolve(JSObject().apply { put("status", "stopped") })
    }

    @PluginMethod
    fun switchCamera(call: PluginCall) {
        // 重新绑定到另一个摄像头
        val newFacing = call.getString("facing") ?: "environment"
        isCapturing = false
        cameraProvider?.unbindAll()
        bindCameraUseCases(newFacing, call)
    }

    private fun imageProxyToJpeg(image: ImageProxy): ByteArray? {
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        // 简化：直接返回 NV21 数据的 JPEG 编码
        // 生产环境需要用 YuvImage 正确转换
        val yuvImage = android.graphics.YuvImage(
            imageToNV21(image),
            ImageFormat.NV21,
            image.width, image.height, null
        )
        val out = java.io.ByteArrayOutputStream()
        yuvImage.compressToJpeg(
            android.graphics.Rect(0, 0, image.width, image.height),
            70, out
        )
        return out.toByteArray()
    }

    private fun imageToNV21(image: ImageProxy): ByteArray {
        // YUV_420_888 → NV21 转换
        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer
        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()
        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)
        return nv21
    }

    @PermissionCallback
    private fun handleCameraPermission(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            val facing = call.getString("facing") ?: "environment"
            bindCameraUseCases(facing, call)
        } else {
            call.reject("摄像头权限被拒绝")
        }
    }
}
```

### 3.3 JS Bridge

```typescript
interface NativeCameraPlugin {
  startCamera(options?: { facing?: string; intervalMs?: number }): Promise<{ status: string; facing: string }>;
  stopCamera(): Promise<{ status: string }>;
  switchCamera(options?: { facing?: string }): Promise<{ status: string; facing: string }>;
  addListener(event: 'cameraFrame', callback: (data: CameraFrameData) => void): Promise<PluginListenerHandle>;
}

interface CameraFrameData {
  frame: string;      // base64 JPEG
  width: number;
  height: number;
  timestamp: number;
}

const NativeCamera = registerPlugin<NativeCameraPlugin>('NativeCamera');

export class NativeCameraBridge {
  private listenerHandle: PluginListenerHandle | null = null;
  private frameCallback: ((frame: string) => void) | null = null;
  private isNativeMode = false;

  async needsNativeMode(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      return false;
    } catch {
      return true;
    }
  }

  async start(facing: 'user' | 'environment' = 'environment', intervalMs = 200): Promise<void> {
    this.listenerHandle = await NativeCamera.addListener('cameraFrame', (data) => {
      this.frameCallback?.(data.frame);
    });

    await NativeCamera.startCamera({ facing, intervalMs });
    this.isNativeMode = true;
  }

  async stop(): Promise<void> {
    this.isNativeMode = false;
    await NativeCamera.stopCamera();
    await this.listenerHandle?.remove();
    this.listenerHandle = null;
  }

  async switchCamera(): Promise<void> {
    await NativeCamera.switchCamera();
  }

  onFrame(callback: (frame: string) => void): void {
    this.frameCallback = callback;
  }
}
```

### 3.4 集成到现有代码

**改动文件**：`frontend/src/vision/camera.ts`（~15 行改动）

```typescript
import { NativeCameraBridge } from './native-camera-bridge.js';

private nativeBridge: NativeCameraBridge | null = null;

async startStream(deviceId?: string, constraints?: MediaTrackConstraints): Promise<MediaStream> {
  try {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { ... } });
  } catch {
    console.log('[Camera] 浏览器 API 不可用，降级到原生摄像头');
    this.nativeBridge = new NativeCameraBridge();
    await this.nativeBridge.start(
      constraints?.facingMode === 'user' ? 'user' : 'environment'
    );
    // 原生模式下，帧通过回调获取
    this.nativeBridge.onFrame((base64) => {
      this.latestFrame = base64;
    });
  }
}

// captureFrame() 降级
async captureFrame(quality = 0.8): Promise<string> {
  if (this.nativeBridge) {
    return this.latestFrame ?? '';
  }
  // ... 原有 Canvas 逻辑 ...
}
```

### 3.5 工作量估算

| 任务 | 工作量 |
|---|---|
| iOS 原生插件 | ~180 行 Swift |
| Android 原生插件 | ~160 行 Kotlin |
| JS Bridge | ~100 行 TypeScript |
| camera.ts 改动 | ~15 行 |
| **合计** | **~455 行** |

---

## 第四部分：集成与配置

### 4.1 Capacitor 项目初始化

```bash
cd buddy/frontend
npm install @capacitor/core @capacitor/cli
npx cap init buddy com.buddy.ai --web-dir dist
npx cap add ios
npx cap add android
```

### 4.2 capacitor.config.ts

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buddy.ai',
  appName: 'Buddy',
  webDir: 'dist',
  server: {
    // 开发时指向 Vite dev server
    url: 'http://192.168.x.x:5173',
    cleartext: true,
  },
  plugins: {
    // 自定义插件不需要额外配置，Capacitor 自动发现
  },
  ios: {
    // iOS 麦克风/摄像头使用描述
    infoPlist: {
      NSMicrophoneUsageDescription: 'Buddy 需要麦克风来听你说话',
      NSCameraUsageDescription: 'Buddy 需要摄像头来看到你',
    },
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
```

### 4.3 项目目录结构

```
buddy/
├── frontend/
│   ├── src/
│   │   ├── voice/
│   │   │   ├── native-audio-bridge.ts    ← 新增
│   │   │   ├── mic-manager.ts            ← 改动 ~20 行
│   │   │   └── ... (现有文件不变)
│   │   └── vision/
│   │       ├── native-camera-bridge.ts   ← 新增
│   │       ├── camera.ts                 ← 改动 ~15 行
│   │       └── ... (现有文件不变)
│   ├── ios/
│   │   └── App/App/Plugins/
│   │       ├── NativeAudioPlugin.swift   ← 新增
│   │       └── NativeCameraPlugin.swift  ← 新增
│   ├── android/
│   │   └── app/src/main/java/com/buddy/ai/
│   │       ├── NativeAudioPlugin.kt      ← 新增
│   │       └── NativeCameraPlugin.kt     ← 新增
│   └── capacitor.config.ts               ← 新增
└── ...
```

---

## 第五部分：总工作量

| 模块 | 新增代码 | 改动代码 | 测试 |
|---|---|---|---|
| 🎤 耳朵（麦克风桥） | ~370 行 | ~20 行 | ~2h |
| 👄 嘴巴（TTS 播放） | ~210 行 | ~0 行 | ~1h |
| 👁️ 眼睛（摄像头桥） | ~455 行 | ~15 行 | ~2h |
| 配置与初始化 | ~50 行 | ~0 行 | ~1h |
| **合计** | **~1085 行** | **~35 行** | **~6h** |

---

## 第六部分：依赖

| 依赖 | 用途 | 是否必须 |
|---|---|---|
| `@capacitor/core` | Capacitor 核心 | ✅ |
| `@capacitor/cli` | 构建工具 | ✅ devDep |
| `@capacitor/ios` | iOS 平台 | ✅ |
| `@capacitor/android` | Android 平台 | ✅ |
| Xcode | iOS 编译 | ✅ macOS |
| Android Studio | Android 编译 | ✅ |
| 其他第三方 SDK | — | ❌ 无 |

**全部自研，零外部付费依赖。**

---

## 第七部分：实施顺序

```
Phase 1（优先级最高）：🎤 耳朵
  → 原因：语音交互是核心场景，且代码改动最小
  → 产出：移动端可以说话、情绪检测、唤醒词、VAD 全部跑通

Phase 2：👄 嘴巴
  → 原因：TTS 后端已通，只差原生播放
  → 产出：移动端可以听到 Buddy 说话，锁屏媒体控制

Phase 3：👁️ 眼睛
  → 原因：摄像头涉及权限更复杂，但架构与耳朵一致
  → 产出：移动端可以拍照分析、人脸检测、场景理解、OCR
```
