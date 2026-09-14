package com.coralclock.reeflect

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    TrackerPlugin.pendingRoute = intent?.getStringExtra(TrackerPlugin.EXTRA_ROUTE)
  }

  // The shield brought the app to the front with a page to show; the pages ask for it when visible.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    intent.getStringExtra(TrackerPlugin.EXTRA_ROUTE)?.let { TrackerPlugin.pendingRoute = it }
  }
}
