package com.buddy.ai

import android.Manifest
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Buddy 原生摄像头插件
 *
 * 功能：
 * 1. 前后摄像头实时帧捕获（CameraX）
 * 2. YUV → JPEG 压缩后推送给 WebView
 * 3. 前后摄像头切换
 */
@CapacitorPlugin(
    name = "NativeCamera",
    permissions = [
        Permission(
            alias = "camera",
            strings = [Manifest.permission.CAMERA]
        )
    ]
)
class NativeCameraPlugin : Plugin() {
    private var cameraProvider: ProcessCameraProvider? = null
    private var imageAnalysis: ImageAnalysis? = null
    private var analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var isCapturing = false
    private var frameIntervalMs = 200L
    private var lastFrameTime = 0L
    private var currentFacing = "environment"

    // MARK: - 公开方法

    @PluginMethod
    fun startCamera(call: PluginCall) {
        if (getPermissionState("camera")?.toString() != "granted") {
            requestPermissionForAlias("camera", call, "handleCameraPermission")
            return
        }

        currentFacing = call.getString("facing") ?: "environment"
        frameIntervalMs = (call.getInt("intervalMs") ?: 200).toLong()

        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            bindCameraUseCases(call)
        }, ContextCompat.getMainExecutor(context))
    }

    @PluginMethod
    fun stopCamera(call: PluginCall) {
        isCapturing = false
        cameraProvider?.unbindAll()
        call.resolve(JSObject().apply { put("status", "stopped") })
    }

    @PluginMethod
    fun switchCamera(call: PluginCall) {
        if (!isCapturing) {
            call.reject("摄像头未启动")
            return
        }

        currentFacing = if (currentFacing == "user") "environment" else "user"
        isCapturing = false
        cameraProvider?.unbindAll()
        bindCameraUseCases(call)
    }

    // MARK: - 内部方法

    private fun bindCameraUseCases(call: PluginCall) {
        val provider = cameraProvider ?: run {
            call.reject("CameraProvider 不可用")
            return
        }

        val cameraSelector = if (currentFacing == "user") {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }

        // 图像分析用例
        imageAnalysis = ImageAnalysis.Builder()
            .setTargetResolution(android.util.Size(640, 480))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        lastFrameTime = 0L

        imageAnalysis?.setAnalyzer(analysisExecutor) { imageProxy ->
            val now = System.currentTimeMillis()
            if (isCapturing && now - lastFrameTime >= frameIntervalMs) {
                lastFrameTime = now
                processFrame(imageProxy)
            }
            imageProxy.close()
        }

        try {
            provider.unbindAll()
            provider.bindToLifecycle(
                context as androidx.lifecycle.LifecycleOwner,
                cameraSelector,
                imageAnalysis!!
            )
            isCapturing = true
            call.resolve(JSObject().apply {
                put("status", "capturing")
                put("facing", currentFacing)
            })
        } catch (e: Exception) {
            call.reject("摄像头启动失败: ${e.message}")
        }
    }

    private fun processFrame(imageProxy: ImageProxy) {
        try {
            val jpeg = yuvToJpeg(imageProxy)
            if (jpeg != null) {
                val base64 = Base64.encodeToString(jpeg, Base64.NO_WRAP)
                notifyListeners("cameraFrame", JSObject().apply {
                    put("frame", base64)
                    put("width", imageProxy.width)
                    put("height", imageProxy.height)
                    put("timestamp", System.currentTimeMillis())
                })
            }
        } catch (_: Exception) {
            // 帧处理失败，忽略
        }
    }

    /**
     * YUV_420_888 → JPEG
     */
    private fun yuvToJpeg(imageProxy: ImageProxy): ByteArray? {
        return try {
            val nv21 = yuv420ToNv21(imageProxy)
            val yuvImage = YuvImage(
                nv21,
                ImageFormat.NV21,
                imageProxy.width,
                imageProxy.height,
                null
            )
            val out = ByteArrayOutputStream()
            yuvImage.compressToJpeg(
                Rect(0, 0, imageProxy.width, imageProxy.height),
                70, // JPEG 质量
                out
            )
            out.toByteArray()
        } catch (_: Exception) {
            null
        }
    }

    /**
     * YUV_420_888 → NV21 字节数组
     */
    private fun yuv420ToNv21(imageProxy: ImageProxy): ByteArray {
        val yPlane = imageProxy.planes[0]
        val uPlane = imageProxy.planes[1]
        val vPlane = imageProxy.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)

        // Y 平面
        yBuffer.get(nv21, 0, ySize)

        // VU 交替（NV21 格式：Y...VU VU VU...）
        val uvStart = ySize
        val uvPixelStride = uPlane.pixelStride
        val uvRowStride = uPlane.rowStride
        val uvWidth = imageProxy.width / 2
        val uvHeight = imageProxy.height / 2

        var pos = uvStart
        for (row in 0 until uvHeight) {
            for (col in 0 until uvWidth) {
                val uvIndex = row * uvRowStride + col * uvPixelStride
                nv21[pos++] = vBuffer.get(uvIndex) // V
                nv21[pos++] = uBuffer.get(uvIndex) // U
            }
        }

        return nv21
    }

    @PermissionCallback
    private fun handleCameraPermission(call: PluginCall) {
        if (getPermissionState("camera")?.toString() == "granted") {
            val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
            cameraProviderFuture.addListener({
                cameraProvider = cameraProviderFuture.get()
                bindCameraUseCases(call)
            }, ContextCompat.getMainExecutor(context))
        } else {
            call.reject("摄像头权限被拒绝")
        }
    }

    // MARK: - 生命周期

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        isCapturing = false
        cameraProvider?.unbindAll()
        cameraProvider = null
        analysisExecutor.shutdown()
    }
}
