package maliu.modules.appaccessibility

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build

// Opens MaLiu and tells the running task to stop. A distinct action makes Android hand the
// intent to the running activity through onNewIntent instead of only bringing it forward.
const val ACTION_STOP_TASK = "maliu.modules.appaccessibility.STOP_TASK"
private const val CHANNEL = "maliu-app-tasks"
private const val NOTIFICATION_ID = 7301

// While MaLiu works inside another app, it is in the background: this ongoing notification
// shows which app it is using and offers Stop. It is not a foreground service; the enabled
// accessibility service already keeps the process at foreground priority.
object TaskNotification {
  fun show(context: Context, app: String?, step: Int) {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Tasks in other apps", NotificationManager.IMPORTANCE_LOW),
      )
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(context)
    val icon = Icon.createWithResource(context, R.drawable.maliu_task_notification)
    val notification = builder
      .setSmallIcon(icon)
      .setContentTitle(if (app == null) "MaLiu is working" else "MaLiu is using $app")
      .setContentText("Step $step. Tap to watch in MaLiu, or stop the task.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(activity(context, 0, null))
      .addAction(
        Notification.Action.Builder(icon, "Stop", activity(context, 1, ACTION_STOP_TASK)).build(),
      )
      .build()
    // Without the notification permission (Android 13+) this is dropped; Stop in chat still works.
    manager.notify(NOTIFICATION_ID, notification)
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }

  // Opens MaLiu; with ACTION_STOP_TASK it also stops the running task.
  fun intent(context: Context, action: String?): Intent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
    val intent = Intent(launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (action != null) intent.setAction(action).component = launch.component
    return intent
  }

  private fun activity(context: Context, code: Int, action: String?): PendingIntent =
    PendingIntent.getActivity(
      context, code, intent(context, action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}
