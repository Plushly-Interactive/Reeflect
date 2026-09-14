package reeflect.app

// The Rust side of the services (app_lib, `src/android.rs`): the tracker's tick, the shield's check,
// the sync run. Loaded here so a service started at boot needs no activity.
object Native {
    init {
        System.loadLibrary("app_lib")
    }

    external fun since(dataDir: String, now: Long): Long
    external fun tick(dataDir: String, eventsJson: String, now: Long, ownPackage: String): String
    external fun check(dataDir: String, pkg: String): String
    external fun syncRun(dataDir: String): String
}
