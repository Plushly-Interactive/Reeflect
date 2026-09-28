package app.reeflect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

// The live tracker's shell: a foreground service, alive as long as its notification is, that every
// few seconds hands the system's foreground events to Rust (`Native.tick`) and, every 15 minutes,
// asks Rust to run a sync. Sticky, restarted by the system if killed and started again at boot.
class TrackerService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val busy = AtomicBoolean(false)
    private var lastSync = 0L
    private val tick = object : Runnable {
        override fun run() {
            if (busy.compareAndSet(false, true)) {
                thread {
                    try {
                        val now = System.currentTimeMillis()
                        Native.tick(dataDir.absolutePath, eventsSince(Native.since(dataDir.absolutePath, now), now), now, packageName)
                        if (now - lastSync >= SYNC_MS) {
                            lastSync = now
                            Native.syncRun(dataDir.absolutePath)
                        }
                    } catch (_: Exception) {
                    } finally {
                        busy.set(false)
                    }
                }
            }
            handler.postDelayed(this, TICK_MS)
        }
    }

    // The system's record of what came to the front, as JSON for Rust; launchable = has a launcher entry,
    // label = that entry's name, the one the app's pages show.
    private fun eventsSince(since: Long, now: Long): String {
        val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val pm = packageManager
        val apps = HashMap<String, Pair<Boolean, String?>>()
        val out = JSONArray()
        val events = usm.queryEvents(since, now)
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            val pkg = e.packageName ?: continue
            val (launchable, label) = apps.getOrPut(pkg) {
                val launch = pm.getLaunchIntentForPackage(pkg)
                Pair(launch != null, launch?.let { pm.resolveActivity(it, 0) }?.loadLabel(pm)?.toString())
            }
            out.put(JSONObject()
                .put("package", pkg)
                .put("kind", e.eventType)
                .put("at", e.timeStamp)
                .put("class", e.className ?: "")
                .put("launchable", launchable)
                .putOpt("label", label))
        }
        return out.toString()
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification())
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.tracker_channel), NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.tracker_notification_title))
            .setContentText(getString(R.string.tracker_notification_text))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "tracker"
        private const val NOTIFICATION_ID = 1
        private const val TICK_MS = 5_000L
        private const val SYNC_MS = 15L * 60 * 1000

        fun start(context: Context) {
            val intent = Intent(context, TrackerService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
