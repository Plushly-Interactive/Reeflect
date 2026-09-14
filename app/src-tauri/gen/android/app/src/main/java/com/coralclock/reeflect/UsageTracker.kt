package com.coralclock.reeflect

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Turns the system's own usage-event history into closed intervals, one row per foreground stay of
// a package, and hands them to the core. Runs whenever asked; nothing is lost between runs because
// Android keeps the events. The extension's intervalTracker is the web twin of this file.
object UsageTracker {
    private const val PREFS = "usage-tracker"
    private const val FIRST_RUN_LOOKBACK_MS = 24L * 60 * 60 * 1000

    fun poll(context: Context): Int {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val since = prefs.getLong("since", now - FIRST_RUN_LOOKBACK_MS)
        var openPkg = prefs.getString("openPkg", null)
        var openFrom = prefs.getLong("openFrom", 0)
        val pm = context.packageManager
        val trackable = HashMap<String, Boolean>()
        // Only apps a user can open from a launcher count; launchers, permission dialogs and system
        // surfaces have no launcher entry. Needs the <queries> block in the manifest to see other apps.
        fun tracked(pkg: String) = trackable.getOrPut(pkg) { pkg != context.packageName && pm.getLaunchIntentForPackage(pkg) != null }
        val rows = JSONArray()

        fun close(at: Long) {
            val pkg = openPkg ?: return
            if (at > openFrom) rows.put(JSONObject().put("domain", pkg).put("kind", "active").put("from", openFrom).put("to", at))
            openPkg = null
        }

        val events = usm.queryEvents(since, now)
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> if (e.packageName != openPkg) {
                    close(e.timeStamp)
                    if (tracked(e.packageName)) { openPkg = e.packageName; openFrom = e.timeStamp }
                }
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> if (e.packageName == openPkg) close(e.timeStamp)
                UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.KEYGUARD_SHOWN, UsageEvents.Event.DEVICE_SHUTDOWN -> close(e.timeStamp)
            }
        }
        if (rows.length() > 0) {
            Core.ensureOpen(context)
            Core.invoke("rows.append", JSONObject().put("rows", rows))
        }
        prefs.edit().putLong("since", now).putString("openPkg", openPkg).putLong("openFrom", openFrom).apply()
        return rows.length()
    }
}
