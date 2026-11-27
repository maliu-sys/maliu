package maliu.modules.appaccessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.random.Random

// A snapshot is a short, flat list of what is on screen, in the same shape as the browser
// one so the model reads both the same way. Node handles belong to the latest snapshot;
// a ref from an older snapshot is rejected instead of acted on.
private const val MAX_NODES = 160
private const val MAX_CHARACTERS = 16_000
private const val MAX_VISITED = 4_000
private const val MAX_DEPTH = 80
private const val MAX_NAME = 180
private const val MAX_ANCESTORS = 24
// Settings focuses the row named by this extra.
private const val COMPONENT = "maliu.modules.appaccessibility.MaliuAccessibilityService"
// An action is done once the screen has been quiet this long, or at the cap.
private const val QUIET_MS = 150L
private const val SETTLE_MAX_MS = 1_500L
private const val POLL_MS = 30L
// A cold start can take a few seconds before the app's first window appears.
private const val LAUNCH_MAX_MS = 5_000L
// Longer than Android's 400-500 ms long-press timeout; a swipe slow enough not to fling.
private const val LONG_PRESS_MS = 650L
private const val SWIPE_MS = 350L
// A person moves between steps in a fraction of a second; back-to-back actions with no
// pause are what automated use looks like. Paced here rather than in JS, because React
// Native timers stop while MaLiu is in the background, which it is during a task.
private const val ACTION_GAP_MIN_MS = 450L
private const val ACTION_GAP_MAX_MS = 750L
private const val SYSTEM_UI = "com.android.systemui"
// Subscribed only while an action settles, so other apps' redraws cost nothing otherwise.
private const val SETTLE_EVENTS =
  AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
    AccessibilityEvent.TYPE_VIEW_SCROLLED or
    AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
private const val IDLE_EVENTS = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
// Matches the snapshot's depth-first walk.
private const val PREFETCH = AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_DEPTH_FIRST

fun isServiceEnabled(context: Context): Boolean {
  val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
  // The argument filters by feedback type; 0 matches no service at all.
  return manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any {
    ComponentName.unflattenFromString(it.id)?.className == COMPONENT
  }
}

// Opens the accessibility list scrolled to this service, so the switch is one tap away.
// The key is the one Android Settings reads from this extra; there is no public deep link.
fun openServiceSettings(context: Context) {
  val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
  intent.putExtra(":settings:fragment_args_key", COMPONENT)
  intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  context.startActivity(intent)
}

private data class LaunchableApp(val label: String, val packageName: String)

private class Foreground(
  val roots: List<AccessibilityNodeInfo>,
  val system: Boolean,
  val title: String?,
) {
  val root get() = roots.first()
}

class MaliuAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile
    var active: MaliuAccessibilityService? = null
      private set
  }

  // Refs look like "s<generation>-<index>", so any new snapshot invalidates older refs.
  private var generation = 0
  private var handles = emptyList<AccessibilityNodeInfo>()
  private val labels = mutableMapOf<String, String?>()
  private var apps: List<LaunchableApp>? = null
  @Volatile
  private var lastChangeAt = 0L
  // Actions in the current task; zero means no task notification is showing.
  private var steps = 0
  private var lastActionAt = 0L
  // The current action fell back to a swipe, which reports success whether or not it moved.
  private var swiped = false
  // Set by Stop in the notification; an action waiting for its turn does not run.
  @Volatile
  private var stopRequested = false

  fun requestStop() {
    stopRequested = true
  }

  private val overlay by lazy { TaskOverlay(this) }

  // Stop on the overlay label works like Stop in the notification.
  private fun stopFromOverlay() {
    requestStop()
    startActivity(TaskNotification.intent(this, ACTION_STOP_TASK))
  }

  private fun showTouch(node: AccessibilityNodeInfo) {
    val box = Rect().also(node::getBoundsInScreen)
    if (!box.isEmpty) overlay.touch(box.exactCenterX(), box.exactCenterY())
  }

  override fun onServiceConnected() {
    active = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val name = event?.packageName?.toString() ?: return
    // MaLiu's own status line says nothing about the target app. System UI redraws its bars
    // all the time, so only its new windows (a dialog) count as a change.
    if (name == packageName) return
    if (name == SYSTEM_UI && event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)
      return
    lastChangeAt = SystemClock.uptimeMillis()
  }

  override fun onInterrupt() {}

  override fun onUnbind(intent: Intent?): Boolean {
    if (active === this) active = null
    overlay.hide()
    release()
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    if (active === this) active = null
    overlay.hide()
    release()
    super.onDestroy()
  }

  @Synchronized
  fun snapshot(): Map<String, Any?> {
    val foreground = foreground()
      ?: throw IllegalStateException(
        "The current screen could not be read. Take a new snapshot, or open the app again.",
      )
    val root = foreground.root
    val name = root.packageName?.toString()
    release()
    val tag = "s${++generation}"
    // MaLiu's own chat is not a target: tapping it would send messages to the agent itself.
    if (name == packageName) {
      foreground.roots.forEach(::recycle)
      return screen(
        name, foreground, emptyList(), false,
        "MaLiu is on screen, so there is nothing to act on. Use app_open to open the app the task needs.",
      )
    }
    val elements = mutableListOf<MutableMap<String, Any?>>()
    val kept = mutableListOf<AccessibilityNodeInfo>()
    // An unnamed tappable row takes the text inside it as its name, like a browser button
    // named by its inner text, so each label is listed once.
    val rows = ArrayDeque<Pair<MutableMap<String, Any?>, Int>>()
    var characters = 0
    var truncated = false
    var visited = 0
    // Depth first, so reading order matches what the user sees; the topmost window first.
    val stack = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
    foreground.roots.asReversed().forEach { stack.addLast(it to 0) }
    while (stack.isNotEmpty() && kept.size < MAX_NODES && visited < MAX_VISITED) {
      val (node, depth) = stack.removeLast()
      visited++
      // Preorder: once depth comes back to a row's level, its subtree is finished.
      while (rows.isNotEmpty() && rows.last().second >= depth) rows.removeLast()
      if (depth > MAX_DEPTH) {
        recycle(node)
        truncated = true
        continue
      }
      for (index in node.childCount - 1 downTo 0) {
        child(node, index)?.let { stack.addLast(it to depth + 1) }
      }
      val element = describe(node, "$tag-${kept.size + 1}")
      if (element == null) {
        recycle(node)
        continue
      }
      val row = rows.lastOrNull()?.first
      // A field's hint is often drawn as its own text right after it; it is already the name.
      val repeated = element["role"] == "text" && elements.lastOrNull()?.get("name") == element["name"]
      if (repeated) {
        recycle(node)
        continue
      }
      if (row != null && element["role"] == "text") {
        val before = row["name"] as String?
        val after = listOfNotNull(before, element["name"] as String).joinToString(" ").take(MAX_NAME)
        row["name"] = after
        characters += after.length - (before?.length ?: 0)
        recycle(node)
        continue
      }
      characters += element.entries.sumOf { (key, value) ->
        key.length + (value?.toString()?.length ?: 0) + 6
      }
      if (characters > MAX_CHARACTERS) {
        recycle(node)
        truncated = true
        break
      }
      elements.add(element)
      kept.add(node)
      if (element["role"] == "button" && element["name"] == null) rows.addLast(element to depth)
    }
    // Anything still queued was never read.
    stack.forEach { recycle(it.first) }
    handles = kept
    return screen(
      name, foreground, elements, truncated,
      if (foreground.system)
        "A system dialog is in front of the app. Ask the user before granting a permission or consent. Refs are valid only for this snapshot."
      else "Refs are valid only for this snapshot. If the screen is still loading, take another snapshot.",
    )
  }

  // Runs one action, waits until the screen stops changing, and reads it. A click usually
  // returns about 150 ms after its animation ends instead of after a fixed pause.
  @Synchronized
  fun act(action: () -> Unit): Map<String, Any?> {
    // Stop only exists while the notification shows, after a first action; a late tap from
    // an earlier task must not stop this one.
    if (steps == 0) stopRequested = false
    // The first action of a task has nothing to pace against.
    if (lastActionAt > 0) {
      val wait = lastActionAt + Random.nextLong(ACTION_GAP_MIN_MS, ACTION_GAP_MAX_MS) -
        SystemClock.uptimeMillis()
      if (wait > 0) Thread.sleep(wait)
    }
    if (stopRequested) throw IllegalStateException("The user stopped the task.")
    lastActionAt = SystemClock.uptimeMillis()
    // Counted before the action: even a failed launch may have left another app in front,
    // and finishTask must still bring MaLiu back.
    steps++
    overlay.show(steps, ::stopFromOverlay)
    watchChanges(true)
    swiped = false
    try {
      action()
      val start = SystemClock.uptimeMillis()
      while (true) {
        val now = SystemClock.uptimeMillis()
        if (now - maxOf(start, lastChangeAt) >= QUIET_MS || now - start >= SETTLE_MAX_MS) break
        Thread.sleep(POLL_MS)
      }
    } finally {
      watchChanges(false)
    }
    // A swipe always "succeeds"; only the screen says whether anything moved.
    if (swiped && lastChangeAt < lastActionAt)
      throw IllegalStateException(
        "Nothing moved: this part of the screen is at its end or does not scroll that way.",
      )
    val result = snapshot()
    TaskNotification.show(this, result["app"] as String?, steps)
    return result
  }

  // Ends the task notification and brings MaLiu back to show the answer. Accessibility
  // services may start activities from the background, so this works while MaLiu is hidden.
  @Synchronized
  fun finishTask() {
    TaskNotification.cancel(this)
    overlay.hide()
    // Runs after any action in flight, which holds the lock, so Stop has reached it.
    stopRequested = false
    lastActionAt = 0
    if (steps == 0) return
    steps = 0
    if (frontPackage() == packageName) return
    startActivity(
      packageManager.getLaunchIntentForPackage(packageName)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  // Accepts an app name as shown under its icon, or a package name.
  @Synchronized
  fun open(query: String): Map<String, Any?> {
    val app = findApp(query.trim())
    val intent = packageManager.getLaunchIntentForPackage(app.packageName)
      ?: throw IllegalStateException("${app.label} cannot be opened from MaLiu.")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return act {
      val before = frontPackage()
      startActivity(intent)
      waitForLaunch(app, before)
    }
  }

  fun click(ref: String) {
    val node = ancestor(target(ref)) { it.isClickable || it.isEditable }
      ?: throw IllegalStateException("This element cannot be tapped. Take a new snapshot.")
    showTouch(node)
    if (!node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) press(bounds(node), 60)
  }

  // Context menus, selection and drag handles. Elements that do not declare a long click
  // get a finger held at their centre.
  fun longPress(ref: String) {
    val node = target(ref)
    showTouch(node)
    val holder = ancestor(node) { it.isLongClickable }
    if (holder?.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK) == true) return
    press(bounds(node), LONG_PRESS_MS)
  }

  fun setText(ref: String, text: String) {
    val node = target(ref)
    if (!editable(node))
      throw IllegalStateException("This element is not a text field. Take a new snapshot.")
    if (node.isPassword)
      throw IllegalStateException("This is a password field. Ask the user to type it themselves.")
    showTouch(node)
    // Focus first, so a following Enter reaches this field.
    if (!node.isFocused) node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args))
      throw IllegalStateException(
        "The field did not accept text. Many search bars only open a search screen: tap it with app_click, then fill the field on the new screen.",
      )
  }

  // direction names where the content moves into view: "down" shows what is below.
  fun scroll(ref: String?, direction: String) {
    val vertical = direction == "up" || direction == "down"
    val start = ref?.let(::target)
    // Without a ref, the first list on the matching axis, usually the main one; a carousel
    // near the top must not take a vertical scroll.
    val scroller = if (start != null) ancestor(start) { it.isScrollable } else {
      handles.firstOrNull { it.refresh() && it.isScrollable && horizontal(it) == !vertical }
        ?: if (vertical) handles.firstOrNull { it.refresh() && it.isScrollable && horizontal(it) == null } else null
    }
    if (scroller != null && onAxis(scroller, direction)) {
      val action = scrollAction(scroller, direction)
      if (action != null) showTouch(scroller)
      if (action != null && scroller.performAction(action)) return
    }
    // Flutter, games and custom views often draw lists without reporting them, and some
    // gestures have no action at all, such as swiping up from a launcher to open its app
    // list. A swipe moves them the way a finger does; act() reports if nothing moved.
    val area = (scroller ?: start)?.let(::bounds) ?: screenBounds()
    overlay.touch(area.exactCenterX(), area.exactCenterY())
    swipe(area, direction)
    swiped = true
  }

  fun press(key: String) {
    if (key == "enter") return enter()
    val code = when (key) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      else -> throw IllegalArgumentException("Unsupported key: $key")
    }
    if (!performGlobalAction(code))
      throw IllegalStateException("The system did not accept the navigation action.")
  }

  // Search boxes and chat inputs submit with the keyboard's action key, often with no button.
  private fun enter() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R)
      throw UnsupportedOperationException(
        "Enter needs Android 11 or later. Tap the search or send button instead.",
      )
    val field = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
      ?: throw IllegalStateException("No text field is focused. Fill or tap a field first.")
    try {
      if (!field.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id))
        throw IllegalStateException(
          "This field has no Enter action. Tap the search or send button instead.",
        )
    } finally {
      recycle(field)
    }
  }

  private fun screen(
    name: String?,
    foreground: Foreground?,
    elements: List<Map<String, Any?>>,
    truncated: Boolean,
    note: String,
  ): Map<String, Any?> = mapOf(
    "package" to name,
    // Apps without a launcher icon, such as a settings search page, are hidden from
    // MaLiu by package visibility; their window title still says where the user is.
    "app" to name?.let(::label),
    "title" to foreground?.title,
    "window" to if (foreground?.system == true) "system" else "app",
    "elements" to elements,
    "truncated" to truncated,
    "note" to note,
  )

  private fun watchChanges(on: Boolean) {
    val info = serviceInfo
    info.eventTypes = if (on) SETTLE_EVENTS else IDLE_EVENTS
    serviceInfo = info
  }

  private fun frontPackage(): String? {
    val root = foregroundRoot(prefetch = false) ?: return null
    return root.packageName?.toString().also { recycle(root) }
  }

  // An app may resume on a screen owned by another package, such as Settings reopening on
  // its search page, so any change of front app counts as launched.
  private fun waitForLaunch(app: LaunchableApp, before: String?) {
    val start = SystemClock.uptimeMillis()
    while (SystemClock.uptimeMillis() - start < LAUNCH_MAX_MS) {
      val current = frontPackage()
      if (current == app.packageName || (current != null && current != before)) return
      Thread.sleep(100)
    }
    throw IllegalStateException(
      "${app.label} did not come to the front. Take a snapshot to see what is on screen.",
    )
  }

  private fun findApp(query: String): LaunchableApp =
    // The installed list changes rarely; read it again only when nothing matches.
    match(launchable(false), query)
      ?: match(launchable(true), query)
      ?: throw IllegalArgumentException(
        "No installed app matches \"$query\". Ask the user for the app's name.",
      )

  private fun match(apps: List<LaunchableApp>, query: String): LaunchableApp? {
    apps.firstOrNull { it.packageName == query }?.let { return it }
    val key = normalize(query)
    val found = apps.filter { normalize(it.label) == key }
      .ifEmpty { apps.filter { normalize(it.label).contains(key) } }
    if (found.size > 1)
      throw IllegalArgumentException(
        "Several apps match \"$query\": " +
          found.take(8).joinToString { "${it.label} (${it.packageName})" } +
          ". Call app_open with one package name.",
      )
    return found.firstOrNull()
  }

  private fun launchable(refresh: Boolean): List<LaunchableApp> {
    if (!refresh) apps?.let { return it }
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return packageManager.queryIntentActivities(intent, 0)
      .map { LaunchableApp(it.loadLabel(packageManager).toString(), it.activityInfo.packageName) }
      .distinctBy { it.packageName }
      .also { apps = it }
  }

  private fun normalize(value: String): String =
    value.lowercase(Locale.ROOT).replace(Regex("\\s+"), "")

  // The windows the user would act on, topmost first. A focused system dialog, such as a
  // permission or screen-recording prompt, stands alone. Otherwise the app in front: a
  // modal dialog holds focus and stands alone too, while a popup that does not take focus
  // leaves the activity below it usable, so both are read. Bars and the shade are system
  // windows but never hold focus while an app is in use.
  // whole = false reads only the topmost window, enough to tell which app is in front.
  // Prefetching only pays off for a full walk.
  private fun foreground(prefetch: Boolean = true, whole: Boolean = true): Foreground? {
    val batch = prefetch && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val rootOf = { window: AccessibilityWindowInfo ->
      if (batch) window.getRoot(PREFETCH) else window.root
    }
    val all = windows
    all.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_SYSTEM && it.isFocused }?.let { window ->
      rootOf(window)?.let { return Foreground(listOf(it), true, window.title?.toString()) }
    }
    val apps = all.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
    val top = apps.firstNotNullOfOrNull { window -> rootOf(window)?.let { window to it } }
    if (top == null) {
      val root = (if (batch) getRootInActiveWindow(PREFETCH) else rootInActiveWindow) ?: return null
      return Foreground(listOf(root), false, null)
    }
    val (window, root) = top
    val roots = mutableListOf(root)
    if (whole && !window.isFocused) {
      for (below in apps.subList(apps.indexOf(window) + 1, apps.size)) {
        val other = rootOf(below) ?: continue
        if (other.packageName != root.packageName) {
          recycle(other)
          continue
        }
        roots.add(other)
        if (below.isFocused) break
      }
    }
    return Foreground(roots, false, window.title?.toString())
  }

  private fun foregroundRoot(prefetch: Boolean = true): AccessibilityNodeInfo? =
    foreground(prefetch, whole = false)?.root

  // Android 13 can fetch a batch of descendants per call; the walk then reads from cache.
  private fun child(node: AccessibilityNodeInfo, index: Int): AccessibilityNodeInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) node.getChild(index, PREFETCH)
    else node.getChild(index)

  private fun target(ref: String): AccessibilityNodeInfo {
    val index = ref.substringAfter('-', "").toIntOrNull()
    if (ref.substringBefore('-') != "s$generation" || index == null || index !in 1..handles.size)
      throw IllegalStateException("Stale element reference. Take a new snapshot.")
    val node = handles[index - 1]
    if (!node.refresh())
      throw IllegalStateException("Stale element reference. Take a new snapshot.")
    return node
  }

  // A ref can sit inside a tappable row, so the nearest matching ancestor is the target.
  // This walk must not recycle: a snapshot handle is one of the nodes visited.
  private fun ancestor(
    node: AccessibilityNodeInfo,
    matches: (AccessibilityNodeInfo) -> Boolean,
  ): AccessibilityNodeInfo? {
    var current: AccessibilityNodeInfo? = node
    var steps = 0
    while (current != null && steps++ < MAX_ANCESTORS) {
      if (matches(current)) return current
      current = current.parent
    }
    return null
  }

  // true for a horizontal list, false for a vertical one, null when the app does not say.
  private fun horizontal(node: AccessibilityNodeInfo): Boolean? {
    val info = node.collectionInfo
    if (info != null) {
      if (info.rowCount == 1 && info.columnCount > 1) return true
      if (info.rowCount > 1) return false
    }
    val name = node.className?.toString() ?: return null
    return when {
      name.contains("HorizontalScrollView") || name.contains("ViewPager") -> true
      name.contains("ScrollView") || name.contains("ListView") -> false
      else -> null
    }
  }

  // Lists announce scrolling along their own axis; an unknown axis is assumed vertical.
  private fun onAxis(node: AccessibilityNodeInfo, direction: String): Boolean {
    if (exactScroll(direction) in node.actionList.map { it.id }) return true
    val vertical = direction == "up" || direction == "down"
    return horizontal(node)?.let { it != vertical } ?: vertical
  }

  // A directional action when the list offers one; otherwise forward or backward, which
  // follow the list's own axis. Lists drop the action once they reach that end.
  private fun scrollAction(node: AccessibilityNodeInfo, direction: String): Int? {
    val ids = node.actionList.map { it.id }
    val exact = exactScroll(direction)
    if (exact in ids) return exact
    val forward = direction == "down" || direction == "right"
    val id =
      if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
      else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
    return id.takeIf { it in ids }
  }

  private fun exactScroll(direction: String): Int = when (direction) {
    "up" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP
    "down" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN
    "left" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT
    "right" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT
    else -> throw IllegalArgumentException("Unsupported direction: $direction")
  }.id

  private fun bounds(node: AccessibilityNodeInfo): Rect {
    val box = Rect()
    node.getBoundsInScreen(box)
    if (box.isEmpty)
      throw IllegalStateException("This element is not on screen. Take a new snapshot.")
    return box
  }

  private fun screenBounds(): Rect {
    val root = foregroundRoot(prefetch = false)
      ?: throw IllegalStateException("The current screen could not be read. Take a new snapshot.")
    return bounds(root).also { recycle(root) }
  }

  private fun describe(node: AccessibilityNodeInfo, ref: String): MutableMap<String, Any?>? {
    val editable = editable(node)
    // Hidden nodes carry nothing, except a focused field the keyboard is typing into.
    if (!node.isVisibleToUser && !(editable && node.isFocused)) return null
    val description = clean(node.contentDescription)
    // A field's own text is its value; its name comes from a description, hint or label.
    val label = if (editable) {
      description.ifEmpty { clean(hint(node)) }.ifEmpty { labeledBy(node) }
    } else {
      description.ifEmpty { clean(node.text) }
    }
    if (label.isEmpty() && !editable && !node.isClickable && !node.isScrollable && !node.isCheckable)
      return null
    val role = when {
      node.isPassword -> "password"
      editable -> "textbox"
      node.isCheckable -> "checkbox"
      node.isClickable -> "button"
      node.isScrollable -> "region"
      else -> "text"
    }
    val element = linkedMapOf<String, Any?>("ref" to ref, "role" to role)
    if (label.isNotEmpty()) element["name"] = label
    if (node.isPassword) {
      if (editable) element["value"] = "[redacted]"
    } else if (editable && !showingHint(node)) {
      val value = clean(node.text)
      if (value.isNotEmpty()) element["value"] = value
    }
    @Suppress("DEPRECATION")
    if (node.isCheckable) element["checked"] = node.isChecked
    if (!node.isEnabled) element["disabled"] = true
    if (node.isScrollable) element["scrollable"] = true
    return element
  }

  private fun hint(node: AccessibilityNodeInfo): CharSequence? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) node.hintText else null

  // An empty field reports its hint as its text; that is not a value.
  private fun showingHint(node: AccessibilityNodeInfo): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText

  // getLabeledByList replaces this on Android 16; the single label is enough for a name.
  @Suppress("DEPRECATION")
  private fun labeledBy(node: AccessibilityNodeInfo): String {
    val other = node.labeledBy ?: return ""
    return clean(other.text).also { recycle(other) }
  }

  private fun editable(node: AccessibilityNodeInfo): Boolean =
    node.isEditable || node.className?.toString()?.contains("EditText") == true

  private fun clean(value: CharSequence?): String {
    if (value.isNullOrEmpty()) return ""
    val text = value.toString()
    // Most labels are already single line; only pay for the regex when they are not.
    val flat = if (text.indexOf('\n') >= 0) text.replace(Regex("\\s+"), " ") else text
    return flat.trim().take(MAX_NAME)
  }

  private fun label(name: String): String? = labels.getOrPut(name) {
    try {
      val info = packageManager.getApplicationInfo(name, 0)
      packageManager.getApplicationLabel(info).toString()
    } catch (error: Exception) {
      null
    }
  }

  // A finger held at the centre of the box for the given time.
  private fun press(box: Rect, durationMs: Long) {
    gesture(Path().apply { moveTo(box.exactCenterX(), box.exactCenterY()) }, durationMs)
  }

  // Inside the area and away from its edges, where system back and home gestures start.
  private fun swipe(area: Rect, direction: String) {
    val x = area.exactCenterX()
    val y = area.exactCenterY()
    val near = { start: Int, size: Int, part: Float -> start + size * part }
    val path = Path()
    when (direction) {
      "down" -> path.apply {
        moveTo(x, near(area.top, area.height(), 0.75f)); lineTo(x, near(area.top, area.height(), 0.25f))
      }
      "up" -> path.apply {
        moveTo(x, near(area.top, area.height(), 0.25f)); lineTo(x, near(area.top, area.height(), 0.75f))
      }
      "right" -> path.apply {
        moveTo(near(area.left, area.width(), 0.8f), y); lineTo(near(area.left, area.width(), 0.2f), y)
      }
      else -> path.apply {
        moveTo(near(area.left, area.width(), 0.2f), y); lineTo(near(area.left, area.width(), 0.8f), y)
      }
    }
    gesture(path, SWIPE_MS)
  }

  private fun gesture(path: Path, durationMs: Long) {
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
      .build()
    val done = CountDownLatch(1)
    var completed = false
    val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
      override fun onCompleted(description: GestureDescription?) {
        completed = true
        done.countDown()
      }

      override fun onCancelled(description: GestureDescription?) {
        done.countDown()
      }
    }, null)
    if (!dispatched || !done.await(durationMs + 2_000, TimeUnit.MILLISECONDS) || !completed)
      throw IllegalStateException("The gesture did not reach the screen. Take a new snapshot.")
  }

  private fun release() {
    handles.forEach { recycle(it) }
    handles = emptyList()
  }

  // Child nodes are new objects before Android 13; recycling keeps a long task from
  // exhausting native memory. It is a no-op on newer versions.
  @Suppress("DEPRECATION")
  private fun recycle(node: AccessibilityNodeInfo) {
    try {
      node.recycle()
    } catch (error: IllegalStateException) {
      // Already recycled by the framework.
    }
  }
}
