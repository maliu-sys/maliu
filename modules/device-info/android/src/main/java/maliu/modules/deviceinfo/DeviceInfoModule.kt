package maliu.modules.deviceinfo

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DeviceInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MaliuDeviceInfo")

    AsyncFunction("getDeviceInfo") {
      mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "androidVersion" to Build.VERSION.RELEASE,
        "apiLevel" to Build.VERSION.SDK_INT,
        "supportedAbis" to Build.SUPPORTED_ABIS.toList()
      )
    }
  }
}
