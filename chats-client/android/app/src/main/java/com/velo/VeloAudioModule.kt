package com.velo

import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * T8.4: voice messages. A MediaRecorder (AAC in MP4) and a MediaPlayer
 * behind four methods; progress reaches JavaScript as events. Written in
 * the app rather than taken from a library: nothing here needs more than
 * the platform. Recordings are written where JavaScript says (the app's
 * cache), read once and deleted by the JavaScript side; playback reads a
 * temporary decrypted file the JavaScript side removes afterwards.
 */
class VeloAudioModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "VeloAudio"

  private var recorder: MediaRecorder? = null
  private var recordingPath: String? = null
  private var recordStartedAt: Long = 0
  private var player: MediaPlayer? = null
  private val handler = Handler(Looper.getMainLooper())
  private var recordTicker: Runnable? = null
  private var playTicker: Runnable? = null

  private fun emit(event: String, params: com.facebook.react.bridge.WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, params)
  }

  @ReactMethod
  fun addListener(eventName: String) { /* required by NativeEventEmitter; nothing to do */ }

  @ReactMethod
  fun removeListeners(count: Int) { /* required by NativeEventEmitter; nothing to do */ }

  @ReactMethod
  fun startRecording(path: String, promise: Promise) {
    try {
      stopRecorderQuietly()
      File(path).parentFile?.mkdirs()
      val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(reactContext) else @Suppress("DEPRECATION") MediaRecorder()
      r.setAudioSource(MediaRecorder.AudioSource.MIC)
      r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      r.setAudioEncodingBitRate(64_000)
      r.setAudioSamplingRate(44_100)
      r.setOutputFile(path)
      r.prepare()
      r.start()
      recorder = r
      recordingPath = path
      recordStartedAt = System.currentTimeMillis()
      val ticker = object : Runnable {
        override fun run() {
          if (recorder == null) return
          val params = Arguments.createMap()
          params.putDouble("elapsedMs", (System.currentTimeMillis() - recordStartedAt).toDouble())
          emit("VeloAudio.recordTick", params)
          handler.postDelayed(this, 250)
        }
      }
      recordTicker = ticker
      handler.postDelayed(ticker, 250)
      promise.resolve(path)
    } catch (e: Exception) {
      stopRecorderQuietly()
      promise.reject("E_RECORD", e.message ?: "Could not start recording", e)
    }
  }

  private fun stopRecorderQuietly() {
    recordTicker?.let { handler.removeCallbacks(it) }
    recordTicker = null
    try {
      recorder?.stop()
    } catch (_: Exception) {
      // stop() throws when nothing was recorded; the file is then empty or missing
    }
    try {
      recorder?.release()
    } catch (_: Exception) {}
    recorder = null
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    val path = recordingPath ?: ""
    stopRecorderQuietly()
    recordingPath = null
    promise.resolve(path)
  }

  @ReactMethod
  fun startPlaying(path: String, promise: Promise) {
    try {
      stopPlayerQuietly()
      val p = MediaPlayer()
      p.setDataSource(path)
      p.setOnCompletionListener {
        val params = Arguments.createMap()
        params.putDouble("positionMs", it.duration.toDouble())
        params.putDouble("durationMs", it.duration.toDouble())
        params.putBoolean("ended", true)
        emit("VeloAudio.playTick", params)
        stopPlayerQuietly()
      }
      p.prepare()
      p.start()
      player = p
      val ticker = object : Runnable {
        override fun run() {
          val current = player ?: return
          val params = Arguments.createMap()
          params.putDouble("positionMs", current.currentPosition.toDouble())
          params.putDouble("durationMs", current.duration.toDouble())
          params.putBoolean("ended", false)
          emit("VeloAudio.playTick", params)
          handler.postDelayed(this, 200)
        }
      }
      playTicker = ticker
      handler.postDelayed(ticker, 200)
      promise.resolve(p.duration.toDouble())
    } catch (e: Exception) {
      stopPlayerQuietly()
      promise.reject("E_PLAY", e.message ?: "Could not play", e)
    }
  }

  private fun stopPlayerQuietly() {
    playTicker?.let { handler.removeCallbacks(it) }
    playTicker = null
    try {
      player?.stop()
    } catch (_: Exception) {}
    try {
      player?.release()
    } catch (_: Exception) {}
    player = null
  }

  @ReactMethod
  fun stopPlaying(promise: Promise) {
    stopPlayerQuietly()
    promise.resolve(null)
  }

  override fun invalidate() {
    stopRecorderQuietly()
    stopPlayerQuietly()
    super.invalidate()
  }
}
