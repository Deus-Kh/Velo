package com.velo

import android.media.AudioAttributes
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
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min

/**
 * T8.4: voice messages. A MediaRecorder (AAC in MP4) and a MediaPlayer
 * behind a handful of methods; progress reaches JavaScript as events.
 * Written in the app rather than taken from a library: nothing here needs
 * more than the platform. Recordings are written where JavaScript says
 * (the app's cache), read once and deleted by the JavaScript side; playback
 * reads a temporary decrypted file the JavaScript side removes afterwards.
 *
 * Events:
 *   VeloAudio.recordTick { elapsedMs, amplitude 0..1 }            every 100 ms while recording
 *   VeloAudio.playTick   { positionMs, durationMs, state, message? } every 100 ms while playing,
 *                         and once on pause / seek / end / error (state: playing|paused|ended|error)
 */
class VeloAudioModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "VeloAudio"

  private var recorder: MediaRecorder? = null
  private var recordingPath: String? = null
  private var recordStartedAt: Long = 0
  private var player: MediaPlayer? = null
  private var playbackSpeed: Float = 1.0f
  /** startPlaying with a start position: the player starts when that seek lands (seekTo is asynchronous). */
  private var startAfterSeek = false
  private val handler = Handler(Looper.getMainLooper())
  private var recordTicker: Runnable? = null
  private var playTicker: Runnable? = null

  private fun emit(event: String, params: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, params)
  }

  @ReactMethod
  fun addListener(eventName: String) { /* required by NativeEventEmitter; nothing to do */ }

  @ReactMethod
  fun removeListeners(count: Int) { /* required by NativeEventEmitter; nothing to do */ }

  // ───────────── recording ─────────────

  /** 0..1 from MediaRecorder.getMaxAmplitude (0..32767) on a decibel scale: −50 dB → 0, full scale → 1. */
  private fun level(maxAmplitude: Int): Double {
    if (maxAmplitude <= 0) return 0.0
    val db = 20.0 * log10(maxAmplitude / 32767.0)
    return max(0.0, min(1.0, 1.0 + db / 50.0))
  }

  @ReactMethod
  fun startRecording(path: String, promise: Promise) {
    try {
      stopRecorderQuietly()
      File(path).parentFile?.mkdirs()
      val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(reactContext) else @Suppress("DEPRECATION") MediaRecorder()
      r.setAudioSource(MediaRecorder.AudioSource.MIC)
      r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      r.setAudioChannels(1)
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
          val current = recorder ?: return
          val params = Arguments.createMap()
          params.putDouble("elapsedMs", (System.currentTimeMillis() - recordStartedAt).toDouble())
          val amplitude = try { current.maxAmplitude } catch (_: Exception) { 0 }
          params.putDouble("amplitude", level(amplitude))
          emit("VeloAudio.recordTick", params)
          handler.postDelayed(this, RECORD_TICK_MS)
        }
      }
      recordTicker = ticker
      handler.postDelayed(ticker, RECORD_TICK_MS)
      promise.resolve(path)
    } catch (e: Exception) {
      stopRecorderQuietly()
      promise.reject("E_RECORD", e.message ?: "Could not start recording", e)
    }
  }

  private fun stopRecorderQuietly() {
    recordTicker?.let { handler.removeCallbacks(it) }
    recordTicker = null
    val r = recorder ?: return
    recorder = null
    try {
      r.stop()
    } catch (_: Exception) {
      // stop() throws when nothing was recorded; the file is then empty or missing
    }
    try {
      r.release()
    } catch (_: Exception) {}
  }

  /** Resolves { path, durationMs } (durationMs 0 when nothing was recording). */
  @ReactMethod
  fun stopRecording(promise: Promise) {
    val path = recordingPath ?: ""
    val durationMs = if (recorder != null) System.currentTimeMillis() - recordStartedAt else 0L
    stopRecorderQuietly()
    recordingPath = null
    val result = Arguments.createMap()
    result.putString("path", path)
    result.putDouble("durationMs", durationMs.toDouble())
    promise.resolve(result)
  }

  // ───────────── playback ─────────────

  private fun tick(p: MediaPlayer, state: String, message: String? = null) {
    val params = Arguments.createMap()
    val position = try { p.currentPosition } catch (_: Exception) { 0 }
    val duration = try { p.duration } catch (_: Exception) { 0 }
    params.putDouble("positionMs", if (state == "ended") duration.toDouble() else position.toDouble())
    params.putDouble("durationMs", duration.toDouble())
    params.putString("state", state)
    if (message != null) params.putString("message", message)
    emit("VeloAudio.playTick", params)
  }

  private fun seek(p: MediaPlayer, positionMs: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) p.seekTo(max(0, positionMs).toLong(), MediaPlayer.SEEK_CLOSEST)
    else p.seekTo(max(0, positionMs))
  }

  /** Apply the speed (which also starts a paused player on API 23+), make sure it plays, and tick. */
  private fun beginPlayback(p: MediaPlayer) {
    if (playbackSpeed != 1.0f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try { p.playbackParams = p.playbackParams.setSpeed(playbackSpeed) } catch (_: Exception) {}
    }
    if (!p.isPlaying) p.start()
    startTicker()
    tick(p, "playing")
  }

  private fun startTicker() {
    playTicker?.let { handler.removeCallbacks(it) }
    val ticker = object : Runnable {
      override fun run() {
        val current = player ?: return
        val playing = try { current.isPlaying } catch (_: Exception) { false }
        if (!playing) return // paused: quiet until resumed
        tick(current, "playing")
        handler.postDelayed(this, PLAY_TICK_MS)
      }
    }
    playTicker = ticker
    handler.postDelayed(ticker, PLAY_TICK_MS)
  }

  @ReactMethod
  fun startPlaying(path: String, startMs: Double, promise: Promise) {
    try {
      stopPlayerQuietly()
      val p = MediaPlayer()
      p.setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
      )
      p.setDataSource(path)
      p.setOnCompletionListener { mp ->
        if (player === mp) {
          tick(mp, "ended")
          stopPlayerQuietly()
        }
      }
      p.setOnErrorListener { mp, what, extra ->
        if (player === mp) {
          tick(mp, "error", "MediaPlayer error $what/$extra")
          stopPlayerQuietly()
        }
        true
      }
      p.setOnSeekCompleteListener { mp ->
        if (player !== mp) return@setOnSeekCompleteListener
        if (startAfterSeek) {
          startAfterSeek = false
          try { beginPlayback(mp) } catch (_: Exception) {}
        } else {
          tick(mp, if (mp.isPlaying) "playing" else "paused")
        }
      }
      p.prepare()
      player = p
      if (startMs > 0) {
        startAfterSeek = true
        seek(p, startMs.toInt()) // beginPlayback runs from the seek-complete listener
      } else {
        beginPlayback(p)
      }
      promise.resolve(p.duration.toDouble())
    } catch (e: Exception) {
      stopPlayerQuietly()
      promise.reject("E_PLAY", e.message ?: "Could not play", e)
    }
  }

  /** Resolves the position in ms (−1 when nothing is playing). */
  @ReactMethod
  fun pausePlaying(promise: Promise) {
    val p = player
    if (p == null) {
      promise.resolve(-1.0)
      return
    }
    try { if (p.isPlaying) p.pause() } catch (_: Exception) {}
    playTicker?.let { handler.removeCallbacks(it) }
    playTicker = null
    tick(p, "paused")
    promise.resolve(try { p.currentPosition.toDouble() } catch (_: Exception) { -1.0 })
  }

  @ReactMethod
  fun resumePlaying(promise: Promise) {
    val p = player
    if (p == null) {
      promise.reject("E_PLAY", "Nothing to resume")
      return
    }
    try {
      p.start()
      startTicker()
      tick(p, "playing")
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PLAY", e.message ?: "Could not resume", e)
    }
  }

  @ReactMethod
  fun seekTo(positionMs: Double, promise: Promise) {
    val p = player
    if (p == null) {
      promise.resolve(null)
      return
    }
    try {
      seek(p, positionMs.toInt()) // the seek-complete listener ticks the new position
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PLAY", e.message ?: "Could not seek", e)
    }
  }

  /** 0.5 … 3.0; applies to the current player and every later one. */
  @ReactMethod
  fun setPlaybackSpeed(rate: Double, promise: Promise) {
    playbackSpeed = rate.toFloat().coerceIn(0.5f, 3.0f)
    val p = player
    if (p != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        val wasPlaying = p.isPlaying
        p.playbackParams = p.playbackParams.setSpeed(playbackSpeed)
        if (!wasPlaying) p.pause() // setPlaybackParams starts a paused player
      } catch (_: Exception) {}
    }
    promise.resolve(null)
  }

  private fun stopPlayerQuietly() {
    startAfterSeek = false
    playTicker?.let { handler.removeCallbacks(it) }
    playTicker = null
    val p = player ?: return
    player = null
    try {
      p.stop()
    } catch (_: Exception) {}
    try {
      p.release()
    } catch (_: Exception) {}
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

  companion object {
    private const val RECORD_TICK_MS = 100L
    private const val PLAY_TICK_MS = 100L
  }
}
