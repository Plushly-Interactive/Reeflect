package app.reeflect

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import android.webkit.WebView
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream

// What the pages may ask of Android: the three permissions, the two system screens that grant two
// of them, and the installed app list. Loading the plugin (the app opening) starts the tracker
// service. Plumbing only.
@InvokeArg
class LaunchAppArgs {
    lateinit var pkg: String
}

@InvokeArg
class OpenUrlArgs {
    lateinit var url: String
}

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class TrackerPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        TrackerService.start(activity)
    }

    private fun notificationsAllowed() =
        Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @Command
    fun status(invoke: Invoke) {
        val ops = activity.getSystemService(Activity.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName)
        val enabled = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val on = { service: Class<*> -> enabled.split(':').any { it.equals("${activity.packageName}/${service.name}", ignoreCase = true) } }
        invoke.resolve(JSObject()
            .put("usageAccess", mode == AppOpsManager.MODE_ALLOWED)
            .put("accessibility", on(ShieldService::class.java))
            .put("webAccessibility", on(WebShieldService::class.java))
            .put("notifications", notificationsAllowed()))
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

    // Installed apps a user can open, by label and launcher icon: what an app rule may target, and
    // how the pages name and draw a package.
    @Command
    fun apps(invoke: Invoke) {
        val pm = activity.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = JSArray()
        pm.queryIntentActivities(launcher, 0)
            .filter { it.activityInfo.packageName != activity.packageName }
            .distinctBy { it.activityInfo.packageName }
            .map { Triple(it.activityInfo.packageName, it.loadLabel(pm).toString(), it) }
            .sortedBy { it.second.lowercase() }
            .forEach { (pkg, label, info) ->
                list.put(JSObject().put("package", pkg).put("label", label).put("icon", iconDataUrl(info.loadIcon(pm))))
            }
        invoke.resolve(JSObject().put("apps", list))
    }

    // "Close app" on the blocked page: the home screen. Not moveTaskToBack, which would uncover
    // the blocked app itself, still underneath.
    @Command
    fun leave(invoke: Invoke) {
        (activity as MainActivity).goHome()
        invoke.resolve()
    }

    @Command
    fun launchApp(invoke: Invoke) {
        val pkg = invoke.parseArgs(LaunchAppArgs::class.java).pkg
        val intent = activity.packageManager.getLaunchIntentForPackage(pkg)
        if (intent == null) {
            invoke.reject("no launcher entry for $pkg")
            return
        }
        activity.startActivity(intent)
        invoke.resolve()
    }

    // The phone's browser, not this WebView.
    @Command
    fun openUrl(invoke: Invoke) {
        val url = invoke.parseArgs(OpenUrlArgs::class.java).url
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
            invoke.resolve()
        } catch (e: ActivityNotFoundException) {
            invoke.reject("no browser for $url")
        }
    }

    private fun iconDataUrl(icon: Drawable): String {
        val size = 64
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        icon.mutate().setBounds(0, 0, size, size)
        icon.draw(Canvas(bitmap))
        val png = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, png)
        bitmap.recycle()
        return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)
    }
}
