package com.buddy.ai

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File

/**
 * Buddy 原生音频插件
 *
 * 功能：
 * 1. 麦克风采集（PCM 实时帧推送）
 * 2. 音频播放（接收 base64 MP3，原生播放）
 */
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
    // ── 录音状态 ──
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private var recordThread: Thread? = null
    private val sampleRate = 16000
    private val bufferSize by lazy {
        AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
    }

    // ── 播放状态 ──
    private var mediaPlayer: MediaPlayer? = null

    // MARK: - 录音

    @PluginMethod
    fun startRecording(call: PluginCall) {
        if (ActivityCompat.checkSelfPermission(
                context, Manifest.permission.RECORD_AUDIO
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionForAlias("microphone", call, "handleMicPermission")
            return
        }
        doStartRecording(call)
    }

    private fun doStartRecording(call: PluginCall) {
        if (isRecording) {
            call.resolve(JSObject().apply { put("status", "already_recording") })
            return
        }

        try {
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
                        val base64 = Base64.encodeToString(data, Base64.NO_WRAP)
                        notifyListeners("audioFrame", JSObject().apply {
                            put("pcm", base64)
                            put("sampleRate", sampleRate)
                            put("channels", 1)
                            put("frameSize", read / 2) // Int16 = 2 bytes per sample
                        })
                    }
                }
            }.apply { start() }

            call.resolve(JSObject().apply { put("status", "recording") })
        } catch (e: Exception) {
            call.reject("录音启动失败: ${e.message}")
        }
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        isRecording = false
        recordThread?.join(1000)
        recordThread = null
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        call.resolve(JSObject().apply { put("status", "stopped") })
    }

    @PermissionCallback
    private fun handleMicPermission(call: PluginCall) {
        if (getPermissionState("microphone")?.toString() == "granted") {
            doStartRecording(call)
        } else {
            call.reject("麦克风权限被拒绝")
        }
    }

    // MARK: - 播放

    @PluginMethod
    fun playAudio(call: PluginCall) {
        val base64 = call.getString("audio") ?: run {
            call.reject("缺少 audio 参数")
            return
        }

        val title = call.getString("title") ?: "Buddy"

        try {
            val data = Base64.decode(base64, Base64.DEFAULT)

            // 写入临时文件
            val tempFile = File.createTempFile("buddy-tts", ".mp3", context.cacheDir)
            tempFile.writeBytes(data)

            // 释放旧播放器
            mediaPlayer?.release()

            mediaPlayer = MediaPlayer().apply {
                setDataSource(tempFile.absolutePath)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                setOnCompletionListener {
                    notifyListeners("audioPlaybackComplete", JSObject().apply {
                        put("success", true)
                    })
                    tempFile.delete()
                }
                setOnErrorListener { _, _, _ ->
                    notifyListeners("audioPlaybackComplete", JSObject().apply {
                        put("success", false)
                    })
                    tempFile.delete()
                    true
                }
                prepare()
                start()
            }

            call.resolve(JSObject().apply { put("status", "playing") })
        } catch (e: Exception) {
            call.reject("播放失败: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAudio(call: PluginCall) {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        call.resolve(JSObject().apply { put("status", "stopped") })
    }

    // MARK: - 生命周期

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        isRecording = false
        recordThread?.join(500)
        audioRecord?.release()
        audioRecord = null
        mediaPlayer?.release()
        mediaPlayer = null
    }
}
