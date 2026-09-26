fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let target = std::env::var("TARGET").unwrap();
    println!("cargo:rustc-env=REEFLECT_NATIVE_DIR={manifest}/../native/{target}");
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "tracker",
            tauri_build::InlinedPlugin::new().commands(&["status", "open_settings", "open_accessibility_settings", "request_notifications", "pending_route", "apps", "launch_app", "open_url", "leave"]).default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("tauri build");
}
