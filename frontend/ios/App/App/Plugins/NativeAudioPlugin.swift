import AVFoundation
import Capacitor

/**
 * Buddy 原生音频插件
 *
 * 功能：
 * 1. 麦克风采集（PCM 实时帧推送）
 * 2. 音频播放（接收 base64 MP3，原生播放）
 * 3. 锁屏媒体控制
 */
@objc(NativeAudioPlugin)
public class NativeAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAudioPlugin"
    public let jsName = "NativeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAudio", returnType: CAPPluginReturnPromise),
    ]

    // ── 录音状态 ──
    private var audioEngine: AVAudioEngine?
    private var isRecording = false
    private let sampleRate: Double = 16000

    // ── 播放状态 ──
    private var audioPlayer: AVAudioPlayer?

    // MARK: - 录音

    @objc func startRecording(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            guard let self = self else { return }
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
        guard !isRecording else {
            call.resolve(["status": "already_recording"])
            return
        }

        // 配置音频会话
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setPreferredSampleRate(sampleRate)
            try session.setActive(true)
        } catch {
            call.reject("音频会话配置失败: \(error.localizedDescription)")
            return
        }

        // 创建音频引擎
        audioEngine = AVAudioEngine()
        guard let audioEngine = audioEngine else {
            call.reject("音频引擎创建失败")
            return
        }

        let inputNode = audioEngine.inputNode
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        )

        guard let tapFormat = format else {
            call.reject("音频格式创建失败")
            return
        }

        // 安装 tap，实时获取 PCM 帧
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: tapFormat) { [weak self] buffer, _ in
            guard let self = self, self.isRecording else { return }
            let data = self.pcmBufferToInt16Data(buffer)
            self.notifyListeners("audioFrame", data: [
                "pcm": data.base64EncodedString(),
                "sampleRate": self.sampleRate,
                "channels": 1,
                "frameSize": buffer.frameLength
            ])
        }

        do {
            try audioEngine.start()
            isRecording = true
            call.resolve(["status": "recording"])
        } catch {
            call.reject("音频引擎启动失败: \(error.localizedDescription)")
        }
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        isRecording = false
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil

        // 恢复音频会话
        try? AVAudioSession.sharedInstance().setActive(false)

        call.resolve(["status": "stopped"])
    }

    // MARK: - 播放

    @objc func playAudio(_ call: CAPPluginCall) {
        guard let base64 = call.getString("audio") else {
            call.reject("缺少 audio 参数")
            return
        }

        guard let data = Data(base64Encoded: base64) else {
            call.reject("无效的 base64 音频数据")
            return
        }

        do {
            // 配置音频会话为播放模式
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)

            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.delegate = self

            // 设置锁屏媒体信息
            let title = call.getString("title") ?? "Buddy"
            setupNowPlaying(title: title)

            audioPlayer?.play()
            call.resolve(["status": "playing"])
        } catch {
            call.reject("播放失败: \(error.localizedDescription)")
        }
    }

    @objc func stopAudio(_ call: CAPPluginCall) {
        audioPlayer?.stop()
        audioPlayer = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve(["status": "stopped"])
    }

    // MARK: - 辅助方法

    /**
     * AVAudioPCMBuffer → Int16 Data
     * Float32 PCM → Int16 PCM（兼容 Web Audio API）
     */
    private func pcmBufferToInt16Data(_ buffer: AVAudioPCMBuffer) -> Data {
        guard let floatData = buffer.floatChannelData?[0] else {
            return Data()
        }
        let count = Int(buffer.frameLength)
        var int16Data = [Int16](repeating: 0, count: count)
        for i in 0..<count {
            let sample = max(-1.0, min(1.0, floatData[i]))
            int16Data[i] = Int16(sample * 32767)
        }
        return Data(bytes: int16Data, count: count * 2)
    }

    /**
     * 设置锁屏媒体信息
     */
    private func setupNowPlaying(title: String) {
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = "Buddy"
        info[MPMediaItemPropertyPlaybackDuration] = audioPlayer?.duration ?? 0
        info[MPNowPlayingInfoPropertyPlaybackRate] = 1.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

// MARK: - AVAudioPlayerDelegate

extension NativeAudioPlugin: AVAudioPlayerDelegate {
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        notifyListeners("audioPlaybackComplete", data: ["success": flag])
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        notifyListeners("audioPlaybackComplete", data: ["success": false])
    }
}
