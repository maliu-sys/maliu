package maliu.modules.browserinput

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.WebView
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Drives the browser through the same Android paths as a finger, an IME and a hardware
// keyboard, so pages receive trusted events. Script-dispatched events are ignored by many
// widgets, such as autocomplete fields that react to real key events.
class BrowserInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MaliuBrowserInput")

    // x and y are CSS pixels inside the visual viewport, whose CSS width the page reports.
    AsyncFunction("tap") { container: ViewGroup, x: Double, y: Double, viewportWidth: Double, promise: Promise ->
      val view = webView(container)
      val scale = view.width / viewportWidth
      val px = (x * scale).toFloat()
      val py = (y * scale).toFloat()
      val down = SystemClock.uptimeMillis()
      touch(view, down, MotionEvent.ACTION_DOWN, px, py)
      view.postDelayed({
        touch(view, down, MotionEvent.ACTION_UP, px, py)
        promise.resolve(null)
      }, 50)
    }.runOnQueue(Queues.MAIN)

    // Commits like an IME, so Chromium sends keydown 229, input and keyup 229. The text
    // replaces the current selection in the focused field.
    AsyncFunction("insertText") { container: ViewGroup, text: String, promise: Promise ->
      commit(webView(container), text, 10, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pressKey") { container: ViewGroup, key: String ->
      val code = when (key) {
        "Enter" -> KeyEvent.KEYCODE_ENTER
        "Escape" -> KeyEvent.KEYCODE_ESCAPE
        else -> throw IllegalArgumentException("Unsupported key: $key")
      }
      val view = webView(container)
      val time = SystemClock.uptimeMillis()
      view.dispatchKeyEvent(KeyEvent(time, time, KeyEvent.ACTION_DOWN, code, 0))
      view.dispatchKeyEvent(KeyEvent(time, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0))
    }.runOnQueue(Queues.MAIN)

    // WebView writes cookies to disk only now and then; without this, a sign-in finished by
    // XHR can be lost when the app is killed soon after.
    AsyncFunction("flushCookies") {
      CookieManager.getInstance().flush()
    }

    // For QR sign-in: the user scans the saved image from Photos in the site's own app.
    // PixelCopy saves what is on screen; WebView.draw() misses GPU-composited content
    // such as Zhihu's QR code.
    AsyncFunction("saveToPhotos") { container: ViewGroup, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
        throw UnsupportedOperationException("Saving to Photos needs Android 10 or later. Take a screenshot instead.")
      val view = webView(container)
      val window = appContext.currentActivity?.window
        ?: throw IllegalStateException("The browser is not visible.")
      val origin = IntArray(2).also { view.getLocationInWindow(it) }
      val bounds = Rect(origin[0], origin[1], origin[0] + view.width, origin[1] + view.height)
      val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
      PixelCopy.request(window, bounds, bitmap, { result ->
        if (result != PixelCopy.SUCCESS) {
          promise.reject("ERR_CAPTURE", "Could not capture the page.", null)
          return@request
        }
        try {
          save(view, bitmap)
          promise.resolve(null)
        } catch (error: Exception) {
          promise.reject("ERR_SAVE", error.message ?: "Could not save the image.", error)
        } finally {
          bitmap.recycle()
        }
      }, Handler(Looper.getMainLooper()))
    }.runOnQueue(Queues.MAIN)
  }

  private fun save(view: View, bitmap: Bitmap) {
    val resolver = view.context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, "maliu-${System.currentTimeMillis()}.png")
      put(MediaStore.Images.Media.MIME_TYPE, "image/png")
      put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/MaLiu")
    }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Could not create the image in Photos.")
    resolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  // The tag belongs to a host View around react-native-webview, whose ref hides its native view.
  private fun webView(container: ViewGroup): WebView {
    val pending = ArrayDeque<View>(listOf(container))
    while (pending.isNotEmpty()) {
      when (val view = pending.removeFirst()) {
        is WebView -> return view
        is ViewGroup -> for (i in 0 until view.childCount) pending.add(view.getChildAt(i))
      }
    }
    throw IllegalStateException("The browser is not mounted.")
  }

  private fun touch(view: WebView, down: Long, action: Int, x: Float, y: Float) {
    val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
    event.source = InputDevice.SOURCE_TOUCHSCREEN
    view.dispatchTouchEvent(event)
    event.recycle()
  }

  private fun commit(view: WebView, text: String, attempts: Int, promise: Promise) {
    val connection = view.onCreateInputConnection(EditorInfo())
    if (connection == null) {
      // Focus reaches the browser process asynchronously after the page focuses a field.
      if (attempts > 0) view.postDelayed({ commit(view, text, attempts - 1, promise) }, 50)
      else promise.reject("ERR_NO_TEXT_FIELD", "No text field has focus.", null)
      return
    }
    // Chromium's connection must be used on its own IME thread.
    (connection.handler ?: Handler(Looper.getMainLooper())).post {
      connection.commitText(text, 1)
      promise.resolve(null)
    }
  }
}
