package maliu.modules.appaccessibility

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Thin bridge onto the enabled service. Calls run on Expo's module queue, off the main
// thread, because reading another app's tree and waiting for it to settle both block.
class AppAccessibilityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MaliuAppAccessibility")

    // Stop in the task notification or on-screen label opens MaLiu with this action; the agent run is aborted.
    Events("onStop")

    OnNewIntent { intent ->
      if (intent.action != ACTION_STOP_TASK) return@OnNewIntent
      MaliuAccessibilityService.active?.requestStop()
      sendEvent("onStop")
    }

    // Reads a setting, not another app, so it is cheap to check whenever MaLiu is in front.
    Function("isEnabled") {
      isServiceEnabled(requireContext())
    }

    // Opens the system accessibility list at MaLiu's row.
    Function("openSettings") {
      openServiceSettings(requireContext())
    }

    AsyncFunction("snapshot") { promise: Promise ->
      respond(promise) { service().snapshot() }
    }

    AsyncFunction("open") { app: String, promise: Promise ->
      respond(promise) { service().open(app) }
    }

    AsyncFunction("click") { ref: String, promise: Promise ->
      respond(promise) { service().let { it.act { it.click(ref) } } }
    }

    AsyncFunction("longPress") { ref: String, promise: Promise ->
      respond(promise) { service().let { it.act { it.longPress(ref) } } }
    }

    AsyncFunction("setText") { ref: String, text: String, promise: Promise ->
      respond(promise) { service().let { it.act { it.setText(ref, text) } } }
    }

    AsyncFunction("scroll") { ref: String?, direction: String, promise: Promise ->
      respond(promise) { service().let { it.act { it.scroll(ref, direction) } } }
    }

    AsyncFunction("press") { key: String, promise: Promise ->
      respond(promise) { service().let { it.act { it.press(key) } } }
    }

    // Called when an agent run ends. Access may have been turned off during the task, so
    // the notification is cleared either way.
    AsyncFunction("finishTask") {
      val service = MaliuAccessibilityService.active
      if (service != null) service.finishTask() else TaskNotification.cancel(requireContext())
    }
  }

  // Rejects with the plain message, which the model reads as the tool error.
  private fun respond(promise: Promise, work: () -> Map<String, Any?>) {
    try {
      promise.resolve(work())
    } catch (error: Exception) {
      promise.reject("ERR_SCREEN", error.message ?: "The screen could not be read.", error)
    }
  }

  private fun service(): MaliuAccessibilityService =
    MaliuAccessibilityService.active
      ?: throw IllegalStateException(
        "Screen access is off. Ask the user to turn on \"MaLiu screen access\" in Accessibility settings, then try again.",
      )

  private fun requireContext() =
    appContext.reactContext ?: throw IllegalStateException("MaLiu is not running.")
}
