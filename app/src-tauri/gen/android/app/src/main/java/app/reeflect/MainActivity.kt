package app.reeflect

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // A blocked page is up, with the blocked app right underneath: Back must not uncover it.
  private var shieldUp = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge to edge puts the page under the status bar: keep the web view inside the system bars and the keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    // A restore from recents replays the old intent: only a fresh launch carries a live route.
    if (savedInstanceState == null && intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0) takeRoute(intent)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (shieldUp) return goHome()
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
    })
  }

  // Home, Recents or "Close app": the blocked page is dismissed with the activity out of sight.
  override fun onStop() {
    super.onStop()
    shieldUp = false
  }

  fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    takeRoute(intent)
  }

  // The shield's route travels in its launch intent: a launch Android refused leaves no route behind.
  private fun takeRoute(intent: Intent) {
    val route = intent.getStringExtra(EXTRA_ROUTE) ?: return
    intent.removeExtra(EXTRA_ROUTE)
    shieldUp = true
    Native.setRoute(route)
  }

  companion object {
    const val EXTRA_ROUTE = "app.reeflect.route"
  }
}
