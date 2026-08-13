use argon2::{hash_raw, Config, Variant, Version};

// TODO(F16 open question): salt provenance is human-gated — replace this fixed salt with a per-install value before shipping.
const STRONGHOLD_SALT: &[u8] = b"hourglass-stronghold-salt";

fn stronghold_argon2_config() -> Config<'static> {
  Config {
    variant: Variant::Argon2id,
    version: Version::Version13,
    lanes: 4,
    mem_cost: 10_000,
    time_cost: 10,
    ..Default::default()
  }
}

/// Derive the Stronghold snapshot key.
///
/// Panicking here would be invisible AND unrecoverable: this runs inside the
/// plugin's `initialize` IPC command, so a panic means the command never
/// replies (the webview promise hangs forever with nothing in devtools) and it
/// poisons the plugin's `Mutex`, after which *every* later stronghold call
/// panics on `.unwrap()` and hangs too. See ADR-032.
///
/// So we never panic here. `run()` validates the same config once at startup
/// instead, where a failure is loud, immediate, and visible in the terminal.
fn hash_stronghold_password(password: &[u8]) -> Vec<u8> {
  match hash_raw(password, STRONGHOLD_SALT, &stronghold_argon2_config()) {
    Ok(hash) => hash,
    Err(e) => {
      // Unreachable if the startup self-check passed. Report and let the vault
      // surface a decryption error rather than hanging the whole app.
      eprintln!("[stronghold] argon2 key derivation failed: {e}");
      Vec::new()
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Fail fast, in the terminal, if the Argon2 parameters are invalid — rather
  // than discovering it later as a silent hang inside an IPC command.
  hash_raw(b"startup-self-check", STRONGHOLD_SALT, &stronghold_argon2_config())
    .expect("invalid Stronghold argon2 configuration — key derivation cannot succeed");

  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    .plugin(
      tauri_plugin_stronghold::Builder::new(|password| hash_stronghold_password(password.as_ref())).build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
