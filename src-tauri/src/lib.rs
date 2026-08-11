#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    .plugin(
      tauri_plugin_stronghold::Builder::new(|password| {
        use argon2::{hash_raw, Config, Variant, Version};
        let config = Config {
          variant: Variant::Argon2id,
          version: Version::Version13,
          lanes: 4,
          mem_cost: 10_000,
          time_cost: 10,
          ..Default::default()
        };
        // TODO(F16 open question): salt provenance is human-gated — replace this fixed salt with a per-install value before shipping.
        let salt = b"hourglass-stronghold-salt";
        hash_raw(password.as_ref(), salt, &config)
          .expect("failed to hash stronghold password")
          .to_vec()
      })
      .build(),
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
