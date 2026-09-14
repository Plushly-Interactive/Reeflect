package com.coralclock.reeflect

import android.app.Activity
import android.app.AppOpsManager
import android.content.Intent
import android.os.Process
import android.provider.Settings
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.concurrent.thread

// What the pages may ask of the tracker: is usage access granted, open the system screen that
// grants it, poll now. Loading the plugin (the app opening) schedules the periodic poll and runs one.
@TauriPlugin
class TrackerPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        TrackerWorker.schedule(activity)
        thread { runCatching { UsageTracker.poll(activity) } }
    }

    @Command
    fun status(invoke: Invoke) {
        val ops = activity.getSystemService(Activity.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName)
        invoke.resolve(JSObject().put("usageAccess", mode == AppOpsManager.MODE_ALLOWED))
    }

    @Command
    fun openSettings(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        invoke.resolve()
    }

    @Command
    fun poll(invoke: Invoke) {
        thread {
            runCatching { UsageTracker.poll(activity) }
                .onSuccess { invoke.resolve(JSObject().put("appended", it)) }
                .onFailure { invoke.reject(it.message ?: "poll failed") }
        }
    }
}
