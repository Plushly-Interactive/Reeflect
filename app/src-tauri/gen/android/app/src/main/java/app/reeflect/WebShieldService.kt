package app.reeflect

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

// The web shield's shell: in the browsers Rust lists (`Native.bars`), the address bar's text goes to
// Rust (`Native.address`) on every window change, at most once a second while the page changes, and
// every ten seconds while a browser stays in front. A route in the answer brings this app to the
// front on the blocked page. Nothing is decided here; Rust checks the opt-in.
class WebShieldService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val busy = AtomicBoolean(false)
    private var bars: Map<String, String> = emptyMap()
    private var foreground: String? = null
    private var lastText: String? = null
    private var lastRead = 0L
    private var pending = false
    private val throttled = Runnable {
        pending = false
        read(force = false)
    }
    private val recheck = object : Runnable {
        override fun run() {
            read(force = true)
            handler.postDelayed(this, RECHECK_MS)
        }
    }

    override fun onServiceConnected() {
        running = true
        val list = JSONObject(Native.bars())
        bars = list.keys().asSequence().associateWith { list.getString(it) }
        serviceInfo = serviceInfo.apply { packageNames = bars.keys.toTypedArray() }
        handler.postDelayed(recheck, RECHECK_MS)
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacks(recheck)
        handler.removeCallbacks(throttled)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        if (pkg !in bars) return
        foreground = pkg
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            read(force = true)
        } else if (!pending) {
            pending = true
            handler.postDelayed(throttled, maxOf(0L, READ_MS - (System.currentTimeMillis() - lastRead)))
        }
    }

    override fun onInterrupt() {}

    // An unchanged address is sent again only when forced, so the verdict runs on window changes
    // and on the ten-second recheck, not on every scroll. No bar found (a fullscreen video hides
    // the toolbar): nothing is sent and the last address stands.
    private fun read(force: Boolean) {
        val pkg = foreground ?: return
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != pkg) {
            foreground = null
            return
        }
        lastRead = System.currentTimeMillis()
        val text = barText(root, pkg) ?: return
        if (!force && text == lastText) return
        if (send(pkg, text, lastRead)) lastText = text
    }

    private fun barText(root: AccessibilityNodeInfo, pkg: String): String? {
        val node = find(root, bars[pkg] ?: return null) ?: return null
        return (node.text ?: node.contentDescription)?.toString() ?: ""
    }

    // The tab leaves the blocked site before the blocked page covers it, so the rest of the browser
    // stays usable: one Back per page, as a site navigated within took several pages to reach.
    // Stops once the address is allowed, when the browser leaves the front (no history left), or
    // after MAX_BACKS. True while the browser is still in front, on an allowed page.
    private fun retreat(pkg: String): Boolean {
        repeat(MAX_BACKS) {
            performGlobalAction(GLOBAL_ACTION_BACK)
            Thread.sleep(BACK_WAIT_MS)
            val root = rootInActiveWindow ?: return false
            if (root.packageName?.toString() != pkg) return false
            val text = barText(root, pkg) ?: return false
            if (Native.address(dataDir.absolutePath, pkg, text, System.currentTimeMillis()).isEmpty()) return true
        }
        return false
    }

    // A Chromium id carries its package and resolves directly; a Compose tag (Firefox) is bare, so
    // the tree is walked for it.
    private fun find(root: AccessibilityNodeInfo, id: String): AccessibilityNodeInfo? {
        root.findAccessibilityNodeInfosByViewId(id).firstOrNull()?.let { return it }
        return if (':' in id) null else walk(root, id, 0)
    }

    private fun walk(node: AccessibilityNodeInfo, id: String, depth: Int): AccessibilityNodeInfo? {
        if (node.viewIdResourceName == id) return node
        if (depth >= MAX_DEPTH) return null
        for (i in 0 until node.childCount) {
            walk(node.getChild(i) ?: continue, id, depth + 1)?.let { return it }
        }
        return null
    }

    // False while the last call still runs; the caller then keeps its old text and retries.
    private fun send(pkg: String, text: String, at: Long): Boolean {
        if (!busy.compareAndSet(false, true)) return false
        thread {
            try {
                val route = Native.address(dataDir.absolutePath, pkg, text, at)
                if (route.isNotEmpty()) {
                    val cleared = retreat(pkg)
                    foreground = null
                    lastText = null
                    val blocked = Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra(MainActivity.EXTRA_ROUTE, route)
                    if (cleared) blocked.putExtra(MainActivity.EXTRA_RETURN_TO, pkg)
                    startActivity(blocked)
                }
            } catch (_: Exception) {
            } finally {
                busy.set(false)
            }
        }
        return true
    }

    companion object {
        private const val READ_MS = 1_000L
        private const val RECHECK_MS = 10_000L
        private const val MAX_DEPTH = 30
        // Both invented: enough Backs for a deep visit, and time for the bar to show the page
        // the Back landed on.
        private const val MAX_BACKS = 10
        private const val BACK_WAIT_MS = 800L

        // As ShieldService.running.
        @Volatile
        var running = false
    }
}
