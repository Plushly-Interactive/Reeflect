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
        val list = JSONObject(Native.bars())
        bars = list.keys().asSequence().associateWith { list.getString(it) }
        serviceInfo = serviceInfo.apply { packageNames = bars.keys.toTypedArray() }
        handler.postDelayed(recheck, RECHECK_MS)
    }

    override fun onDestroy() {
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
        val node = find(root, bars[pkg] ?: return) ?: return
        val text = (node.text ?: node.contentDescription)?.toString() ?: ""
        if (!force && text == lastText) return
        if (send(pkg, text, lastRead)) lastText = text
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
                    foreground = null
                    lastText = null
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra(MainActivity.EXTRA_ROUTE, route))
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
    }
}
