package app.reeflect

import android.service.notification.NotificationListenerService

// Empty on purpose. Android names the apps whose media is playing (`MediaSessionManager.getActiveSessions`)
// only to an app with an enabled notification listener; this is that listener. It reads no notification.
class MediaListener : NotificationListenerService()
