//! The key at rest on Android: the core hands its DEK to `wrap` and gets it back through `unwrap`,
//! both AES-256-GCM under a key that never leaves the Android Keystore (alias "dek"). Every call
//! goes to the platform's own Java classes; nothing is decided or stored in Kotlin.
use jni::objects::{JByteArray, JObject, JValue};
use jni::{JNIEnv, JavaVM};
use std::sync::OnceLock;

static VM: OnceLock<JavaVM> = OnceLock::new();
const ALIAS: &str = "dek";
const ENCRYPT: i32 = 1;
const DECRYPT: i32 = 2;
const PURPOSE_ENCRYPT_DECRYPT: i32 = 3;
const IV_LEN: usize = 12;

/// The services enter through JNI and carry the VM; the activity's backend reads it from the
/// context tao published. Either way the first caller leaves it here for the callbacks.
pub fn remember_vm(env: &JNIEnv) {
    if let Ok(vm) = env.get_java_vm() {
        let _ = VM.set(vm);
    }
}

fn vm() -> Result<&'static JavaVM, String> {
    if let Some(vm) = VM.get() {
        return Ok(vm);
    }
    let raw = std::panic::catch_unwind(|| ndk_context::android_context().vm()).map_err(|_| "no Java VM yet".to_string())?;
    let vm = unsafe { JavaVM::from_raw(raw.cast()) }.map_err(|e| e.to_string())?;
    Ok(VM.get_or_init(|| vm))
}

fn run<T>(f: impl FnOnce(&mut JNIEnv) -> jni::errors::Result<T>) -> Result<T, String> {
    let mut env = vm()?.attach_current_thread().map_err(|e| e.to_string())?;
    let out = f(&mut env);
    if out.is_err() && env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }
    out.map_err(|e| e.to_string())
}

fn keystore_key<'l>(env: &mut JNIEnv<'l>) -> jni::errors::Result<JObject<'l>> {
    let provider = env.new_string("AndroidKeyStore")?;
    let alias = env.new_string(ALIAS)?;
    let store = env.call_static_method("java/security/KeyStore", "getInstance", "(Ljava/lang/String;)Ljava/security/KeyStore;", &[JValue::Object(&provider)])?.l()?;
    env.call_method(&store, "load", "(Ljava/security/KeyStore$LoadStoreParameter;)V", &[JValue::Object(&JObject::null())])?;
    let present = env.call_method(&store, "containsAlias", "(Ljava/lang/String;)Z", &[JValue::Object(&alias)])?.z()?;
    if !present {
        let builder = env.new_object("android/security/keystore/KeyGenParameterSpec$Builder", "(Ljava/lang/String;I)V", &[JValue::Object(&alias), JValue::Int(PURPOSE_ENCRYPT_DECRYPT)])?;
        let sig = "([Ljava/lang/String;)Landroid/security/keystore/KeyGenParameterSpec$Builder;";
        let gcm = env.new_string("GCM")?;
        let modes = env.new_object_array(1, "java/lang/String", &gcm)?;
        env.call_method(&builder, "setBlockModes", sig, &[JValue::Object(&modes)])?;
        let padding = env.new_string("NoPadding")?;
        let paddings = env.new_object_array(1, "java/lang/String", &padding)?;
        env.call_method(&builder, "setEncryptionPaddings", sig, &[JValue::Object(&paddings)])?;
        env.call_method(&builder, "setKeySize", "(I)Landroid/security/keystore/KeyGenParameterSpec$Builder;", &[JValue::Int(256)])?;
        let spec = env.call_method(&builder, "build", "()Landroid/security/keystore/KeyGenParameterSpec;", &[])?.l()?;
        let aes = env.new_string("AES")?;
        let generator = env.call_static_method("javax/crypto/KeyGenerator", "getInstance", "(Ljava/lang/String;Ljava/lang/String;)Ljavax/crypto/KeyGenerator;", &[JValue::Object(&aes), JValue::Object(&provider)])?.l()?;
        env.call_method(&generator, "init", "(Ljava/security/spec/AlgorithmParameterSpec;)V", &[JValue::Object(&spec)])?;
        env.call_method(&generator, "generateKey", "()Ljavax/crypto/SecretKey;", &[])?;
    }
    env.call_method(&store, "getKey", "(Ljava/lang/String;[C)Ljava/security/Key;", &[JValue::Object(&alias), JValue::Object(&JObject::null())])?.l()
}

fn cipher<'l>(env: &mut JNIEnv<'l>) -> jni::errors::Result<JObject<'l>> {
    let transformation = env.new_string("AES/GCM/NoPadding")?;
    env.call_static_method("javax/crypto/Cipher", "getInstance", "(Ljava/lang/String;)Ljavax/crypto/Cipher;", &[JValue::Object(&transformation)])?.l()
}

fn do_final(env: &mut JNIEnv, cipher: &JObject, input: &[u8]) -> jni::errors::Result<Vec<u8>> {
    let input = env.byte_array_from_slice(input)?;
    let out: JByteArray = env.call_method(cipher, "doFinal", "([B)[B", &[JValue::Object(&input)])?.l()?.into();
    env.convert_byte_array(&out)
}

/// `iv(12) ‖ ciphertext ‖ tag(16)`, a fresh IV from the platform each time.
fn wrap_bytes(env: &mut JNIEnv, dek: &[u8]) -> jni::errors::Result<Vec<u8>> {
    let key = keystore_key(env)?;
    let cipher = cipher(env)?;
    env.call_method(&cipher, "init", "(ILjava/security/Key;)V", &[JValue::Int(ENCRYPT), JValue::Object(&key)])?;
    let iv: JByteArray = env.call_method(&cipher, "getIV", "()[B", &[])?.l()?.into();
    let mut out = env.convert_byte_array(&iv)?;
    out.extend(do_final(env, &cipher, dek)?);
    Ok(out)
}

fn unwrap_bytes(env: &mut JNIEnv, blob: &[u8]) -> jni::errors::Result<Vec<u8>> {
    if blob.len() <= IV_LEN {
        return Err(jni::errors::Error::NullPtr("wrapped key too short"));
    }
    let key = keystore_key(env)?;
    let cipher = cipher(env)?;
    let iv = env.byte_array_from_slice(&blob[..IV_LEN])?;
    let spec = env.new_object("javax/crypto/spec/GCMParameterSpec", "(I[B)V", &[JValue::Int(128), JValue::Object(&iv)])?;
    env.call_method(&cipher, "init", "(ILjava/security/Key;Ljava/security/spec/AlgorithmParameterSpec;)V", &[JValue::Int(DECRYPT), JValue::Object(&key), JValue::Object(&spec)])?;
    do_final(env, &cipher, &blob[IV_LEN..])
}

fn answer(result: Result<Vec<u8>, String>, out: *mut u8, cap: usize) -> isize {
    match result {
        Ok(bytes) if bytes.len() <= cap => {
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len()) };
            bytes.len() as isize
        }
        _ => -1,
    }
}

/// # Safety
/// `input` is readable for `len` bytes and `out` writable for `cap`; the core calls it so.
pub unsafe extern "C" fn wrap(input: *const u8, len: usize, out: *mut u8, cap: usize) -> isize {
    let dek = unsafe { std::slice::from_raw_parts(input, len) };
    let wrapped = std::panic::catch_unwind(|| run(|env| wrap_bytes(env, dek))).unwrap_or_else(|_| Err("wrap panicked".into()));
    answer(wrapped, out, cap)
}

/// # Safety
/// As `wrap`.
pub unsafe extern "C" fn unwrap(input: *const u8, len: usize, out: *mut u8, cap: usize) -> isize {
    let blob = unsafe { std::slice::from_raw_parts(input, len) };
    let dek = std::panic::catch_unwind(|| run(|env| unwrap_bytes(env, blob))).unwrap_or_else(|_| Err("unwrap panicked".into()));
    answer(dek, out, cap)
}
