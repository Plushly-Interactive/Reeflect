package com.coralclock.reeflect

import android.content.Context
import org.json.JSONObject

// The shared core session of this process, the same one the Rust backend uses. Kotlin reaches it
// straight through the library, so a background worker needs no webview and no Rust runtime.
object Core {
    init {
        System.loadLibrary("reeflect_core_ffi")
    }

    private external fun open(dataDir: String, config: String): String?
    private external fun call(cmd: String, args: String): String

    fun ensureOpen(context: Context) {
        val config = JSONObject().put("clientType", "app").put("baseUrl", "https://sync.coralclock.com").toString()
        val error = open(context.dataDir.absolutePath, config)
        if (error != null) throw IllegalStateException("core: $error")
    }

    // `{"ok": ...}` on success; throws the core's error string otherwise.
    fun invoke(cmd: String, args: JSONObject? = null): Any? {
        val reply = JSONObject(call(cmd, args?.toString() ?: ""))
        if (reply.has("error")) throw IllegalStateException(reply.getString("error"))
        return reply.opt("ok")
    }
}
