package com.coralclock.reeflect

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import kotlin.concurrent.thread

// The app-block's shell: on every window change, and every ten seconds while an app stays in
// front, Rust is asked whether an over-limit rule covers the package (`Native.check`). If it
// answers with a route, the app comes to the front on the shared blocked page. Nothing is decided here.
class ShieldService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private var foreground: String? = null
    private var checking = false
    private val recheck = object : Runnable {
        override fun run() {
            foreground?.let { check(it) }
            handler.postDelayed(this, RECHECK_MS)
        }
    }

    override fun onServiceConnected() {
        handler.postDelayed(recheck, RECHECK_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(recheck)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName || packageManager.getLaunchIntentForPackage(pkg) == null) return
        foreground = pkg
        check(pkg)
    }

    override fun onInterrupt() {}

    private fun check(pkg: String) {
        if (checking) return
        checking = true
        thread {
            try {
                val route = Native.check(dataDir.absolutePath, pkg)
                if (route.isNotEmpty()) {
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra(TrackerPlugin.EXTRA_ROUTE, route))
                }
            } catch (_: Exception) {
            } finally {
                checking = false
            }
        }
    }

    companion object {
        private const val RECHECK_MS = 10_000L
    }
}
