import AVFoundation
import UIKit
import Capacitor

/**
 * Buddy 原生摄像头插件
 *
 * 功能：
 * 1. 前后摄像头实时帧捕获
 * 2. JPEG 压缩后推送给 WebView
 * 3. 前后摄像头切换
 */
@objc(NativeCameraPlugin)
public class NativeCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeCameraPlugin"
    public let jsName = "NativeCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "switchCamera", returnType: CAPPluginReturnPromise),
    ]

    private var captureSession: AVCaptureSession?
    private var currentDevice: AVCaptureDevice?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var isCapturing = false
    private var jpegQuality: CGFloat = 0.7
    private var frameIntervalMs: Int = 200
    private var lastFrameTime: TimeInterval = 0

    // 帧处理队列
    private let frameQueue = DispatchQueue(label: "com.buddy.camera-frame", qos: .userInitiated)

    // MARK: - 公开方法

    @objc func startCamera(_ call: CAPPluginCall) {
        let facing = call.getString("facing") ?? "environment"
        frameIntervalMs = call.getInt("intervalMs") ?? 200

        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self = self else { return }
            guard granted else {
                call.reject("摄像头权限被拒绝")
                return
            }
            DispatchQueue.main.async {
                self.doStartCamera(facing: facing, call: call)
            }
        }
    }

    @objc func stopCamera(_ call: CAPPluginCall) {
        isCapturing = false
        captureSession?.stopRunning()
        captureSession = nil
        currentDevice = nil
        videoOutput = nil
        call.resolve(["status": "stopped"])
    }

    @objc func switchCamera(_ call: CAPPluginCall) {
        guard let session = captureSession, isCapturing else {
            call.reject("摄像头未启动")
            return
        }

        let currentPosition = currentDevice?.position ?? .back
        let newPosition: AVCaptureDevice.Position = currentPosition == .back ? .front : .back
        let newFacing = newPosition == .front ? "user" : "environment"

        guard let newDevice = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: newPosition) else {
            call.reject("切换失败：目标摄像头不可用")
            return
        }

        session.beginConfiguration()

        // 移除旧输入
        if let currentInput = session.inputs.first {
            session.removeInput(currentInput)
        }

        // 添加新输入
        do {
            let newInput = try AVCaptureDeviceInput(device: newDevice)
            session.addInput(newInput)
            currentDevice = newDevice
        } catch {
            session.commitConfiguration()
            call.reject("切换失败: \(error.localizedDescription)")
            return
        }

        session.commitConfiguration()

        call.resolve(["status": "switched", "facing": newFacing])
    }

    // MARK: - 内部方法

    private func doStartCamera(facing: String, call: CAPPluginCall) {
        guard !isCapturing else {
            call.resolve(["status": "already_capturing"])
            return
        }

        // 创建会话
        captureSession = AVCaptureSession()
        guard let session = captureSession else {
            call.reject("创建会话失败")
            return
        }

        session.sessionPreset = .vga640x480

        // 选择摄像头
        let position: AVCaptureDevice.Position = facing == "user" ? .front : .back
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
            call.reject("摄像头不可用: \(facing)")
            return
        }
        currentDevice = device

        // 配置输入
        do {
            let input = try AVCaptureDeviceInput(device: device)
            session.addInput(input)
        } catch {
            call.reject("摄像头输入配置失败: \(error.localizedDescription)")
            return
        }

        // 配置输出
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.setSampleBufferDelegate(self, queue: frameQueue)
        output.alwaysDiscardsLateVideoFrames = true
        session.addOutput(output)
        videoOutput = output

        // 启动
        session.startRunning()
        isCapturing = true
        lastFrameTime = 0

        call.resolve(["status": "capturing", "facing": facing])
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension NativeCameraPlugin: AVCaptureVideoDataOutputSampleBufferDelegate {
    public func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard isCapturing else { return }

        // 帧率控制
        let now = Date().timeIntervalSince1970
        let intervalSec = Double(frameIntervalMs) / 1000.0
        guard now - lastFrameTime >= intervalSec else { return }
        lastFrameTime = now

        // CMSampleBuffer → UIImage → JPEG base64
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvImageBuffer: imageBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }

        // 根据设备方向调整图像
        let orientation: UIImage.Orientation = currentDevice?.position == .front ? .leftMirrored : .right
        let uiImage = UIImage(cgImage: cgImage, scale: 1.0, orientation: orientation)

        guard let jpegData = uiImage.jpegData(compressionQuality: jpegQuality) else { return }

        let timestamp = Int(now * 1000)

        // 推送给 JS
        notifyListeners("cameraFrame", data: [
            "frame": jpegData.base64EncodedString(),
            "width": Int(uiImage.size.width),
            "height": Int(uiImage.size.height),
            "timestamp": timestamp
        ])
    }
}
