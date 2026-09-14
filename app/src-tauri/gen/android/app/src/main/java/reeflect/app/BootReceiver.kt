package reeflect.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Tracking resumes with the device: the service starts again after a reboot.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) TrackerService.start(context)
    }
}
