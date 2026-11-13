//! The key at rest on Windows: the core hands its keys to `wrap` and gets them back through `unwrap`,
//! both Windows DPAPI under the signed-in user's login. Only that user on this machine can open them.
//! Every call goes to the platform; nothing is decided or stored here.
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData};
use windows::core::PCWSTR;

/// Ties a blob to this app: another program that calls DPAPI as the same user needs it too.
const ENTROPY: &[u8] = b"reeflect-core-key-at-rest";

fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
}

fn through(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    let data = blob(input);
    let entropy = blob(ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if protect {
            CryptProtectData(&data, PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&data, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
        .map_err(|e| e.to_string())?;
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        Ok(bytes)
    }
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
    let key = unsafe { std::slice::from_raw_parts(input, len) };
    let wrapped = std::panic::catch_unwind(|| through(key, true)).unwrap_or_else(|_| Err("wrap panicked".into()));
    answer(wrapped, out, cap)
}

/// # Safety
/// As `wrap`.
pub unsafe extern "C" fn unwrap(input: *const u8, len: usize, out: *mut u8, cap: usize) -> isize {
    let blob = unsafe { std::slice::from_raw_parts(input, len) };
    let key = std::panic::catch_unwind(|| through(blob, false)).unwrap_or_else(|_| Err("unwrap panicked".into()));
    answer(key, out, cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_round_trips_and_the_blob_hides_it_and_fits_the_core_buffer() {
        let key = [0x42u8; 32];
        let mut blob = vec![0u8; 1024];
        let n = unsafe { wrap(key.as_ptr(), key.len(), blob.as_mut_ptr(), blob.len()) };
        assert!(n > 32, "wrap failed: {n}");
        let blob = &blob[..n as usize];
        println!("DPAPI blob for 32 bytes: {n} bytes");
        assert!(!blob.windows(32).any(|w| w == key));
        let mut back = vec![0u8; 1024];
        let m = unsafe { unwrap(blob.as_ptr(), blob.len(), back.as_mut_ptr(), back.len()) };
        assert_eq!(&back[..m as usize], &key);
        let mut tampered = blob.to_vec();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(unsafe { unwrap(tampered.as_ptr(), tampered.len(), back.as_mut_ptr(), back.len()) } < 0);
        let short = [0u8; 32];
        assert!(unsafe { unwrap(short.as_ptr(), short.len(), back.as_mut_ptr(), back.len()) } < 0, "a raw 32-byte file must not unwrap");
    }
}
