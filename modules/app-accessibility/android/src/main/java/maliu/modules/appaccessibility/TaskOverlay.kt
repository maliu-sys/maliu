package maliu.modules.appaccessibility

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView

// Between MaLiu's two accents, readable on light and dark apps alike.
private val ACCENT = Color.rgb(0xF0, 0x60, 0x3C)
private const val TOUCH_MS = 450L

// While MaLiu works in another app, the screen says so: a glowing frame around the
// edges, a label with the step and Stop in the status bar, and a ripple where it taps.
// Accessibility overlays need no extra permission. The frame never takes touches, so
// gestures MaLiu dispatches and the user's own fingers both reach the app below.
class TaskOverlay(private val service: AccessibilityService) {
  private val main = Handler(Looper.getMainLooper())
  private val windows = service.getSystemService(WindowManager::class.java)
  private var frame: FrameView? = null
  private var label: TextView? = null

  fun show(step: Int, onStop: () -> Unit) = main.post {
    if (frame == null) add(onStop)
    label?.text = "MaLiu · Step $step   Stop"
  }

  // Screen coordinates of the action, so the user sees what MaLiu touched.
  fun touch(x: Float, y: Float) = main.post { frame?.ripple(x, y) }

  fun hide() = main.post {
    frame?.let {
      it.stop()
      windows.removeView(it)
    }
    label?.let(windows::removeView)
    frame = null
    label = null
  }

  private fun add(onStop: () -> Unit) {
    val view = FrameView(service)
    windows.addView(
      view,
      params(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
        .apply {
          // Actions on a screen that timed out would fail; the visible frame keeps it on
          // while MaLiu works in another app.
          flags = flags or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        },
    )
    view.start()
    frame = view

    // Inside the status bar, where apps rarely place controls MaLiu would tap.
    val bar = statusBarHeight()
    val text = TextView(service).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      gravity = Gravity.CENTER
      setPadding(dp(12), 0, dp(12), 0)
      background = GradientDrawable().apply {
        setColor(ACCENT)
        cornerRadius = dp(14).toFloat()
      }
      contentDescription = "MaLiu is operating this phone. Double tap to stop."
      setOnClickListener { onStop() }
    }
    windows.addView(
      text,
      params(WindowManager.LayoutParams.WRAP_CONTENT, maxOf(bar - dp(8), dp(22))).apply {
        gravity = Gravity.TOP or Gravity.END
        x = dp(12)
        y = dp(4)
      },
    )
    label = text
  }

  // Full screen, status bar and camera cutout included: by default Android 11+ shrinks
  // overlay windows to stay clear of the system bars.
  private fun params(width: Int, height: Int) = WindowManager.LayoutParams(
    width,
    height,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
    PixelFormat.TRANSLUCENT,
  ).apply {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      fitInsetsTypes = 0
      layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
  }

  @SuppressLint("InternalInsetResource", "DiscouragedApi")
  private fun statusBarHeight(): Int {
    val id = service.resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) service.resources.getDimensionPixelSize(id) else dp(24)
  }

  private fun dp(value: Int) = (value * service.resources.displayMetrics.density).toInt()
}

private class FrameView(context: Context) : View(context) {
  private val density = resources.displayMetrics.density
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = ACCENT
  }
  private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ACCENT }
  private val box = RectF()
  private var glow = 1f
  private var touchX = 0f
  private var touchY = 0f
  private var touchedAt = 0L
  // A slow breath, so the frame reads as alive without pulling the eye from the app.
  private val pulse = ValueAnimator.ofFloat(0.55f, 1f).apply {
    duration = 1_200
    repeatMode = ValueAnimator.REVERSE
    repeatCount = ValueAnimator.INFINITE
    addUpdateListener {
      glow = it.animatedValue as Float
      invalidate()
    }
  }

  fun start() = pulse.start()

  fun stop() = pulse.cancel()

  fun ripple(x: Float, y: Float) {
    // The window starts at the screen origin, so screen coordinates map directly.
    val origin = IntArray(2).also(::getLocationOnScreen)
    touchX = x - origin[0]
    touchY = y - origin[1]
    touchedAt = SystemClock.uptimeMillis()
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    // Three strokes fading inward give a soft glow along the screen's rounded edges.
    val radius = 28 * density
    for ((width, alpha) in listOf(10f to 0.18f, 6f to 0.35f, 3f to 1f)) {
      val w = width * density
      stroke.strokeWidth = w
      stroke.alpha = (255 * alpha * glow).toInt()
      box.set(w / 2, w / 2, this.width - w / 2, height - w / 2)
      canvas.drawRoundRect(box, radius, radius, stroke)
    }
    val age = SystemClock.uptimeMillis() - touchedAt
    if (touchedAt > 0 && age < TOUCH_MS) {
      val progress = age.toFloat() / TOUCH_MS
      dot.alpha = (150 * (1 - progress)).toInt()
      canvas.drawCircle(touchX, touchY, (14 + 30 * progress) * density, dot)
      postInvalidateOnAnimation()
    }
  }
}
