fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let target = std::env::var("TARGET").unwrap();
    println!("cargo:rustc-env=REEFLECT_NATIVE_DIR={manifest}/../native/{target}");
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
