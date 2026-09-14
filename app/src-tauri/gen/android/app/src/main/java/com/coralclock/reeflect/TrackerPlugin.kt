package com.coralclock.reeflect

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.webkit.WebView
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

// What the pages may ask of Android: the three permissions, the two system screens that grant two
// of them, the installed app list, and the route the shield asked for. Loading the plugin (the app
// opening) starts the tracker service. Plumbing only.
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class TrackerPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        TrackerService.start(activity)
    }

    @Command
    fun pendingRoute(invoke: Invoke) {
        val route = pendingRoute
        pendingRoute = null
        invoke.resolve(JSObject().put("url", route))
    }

    private fun notificationsAllowed() =
        Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @Command
    fun status(invoke: Invoke) {
        val ops = activity.getSystemService(Activity.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName)
        val enabled = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val shield = enabled.split(':').any { it.equals("${activity.packageName}/${ShieldService::class.java.name}", ignoreCase = true) }
        invoke.resolve(JSObject().put("usageAccess", mode == AppOpsManager.MODE_ALLOWED).put("accessibility", shield).put("notifications", notificationsAllowed()))
    }

    @Command
    fun openSettings(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        invoke.resolve()
    }

    @Command
    fun openAccessibilitySettings(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        invoke.resolve()
    }

    @Command
    fun requestNotifications(invoke: Invoke) {
        if (notificationsAllowed()) {
            invoke.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("notifications", invoke, "onNotifications")
    }

    @PermissionCallback
    private fun onNotifications(invoke: Invoke) {
        invoke.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    // Installed apps a user can open, by label: what an app rule may target.
    @Command
    fun apps(invoke: Invoke) {
        val pm = activity.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = JSArray()
        pm.queryIntentActivities(launcher, 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != activity.packageName }
            .distinctBy { it.first }
            .sortedBy { it.second.lowercase() }
            .forEach { (pkg, label) -> list.put(JSObject().put("package", pkg).put("label", label)) }
        invoke.resolve(JSObject().put("apps", list))
    }

    companion object {
        const val EXTRA_ROUTE = "route"
        @Volatile var pendingRoute: String? = null
    }
}
