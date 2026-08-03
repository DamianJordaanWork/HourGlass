# Workflow: dev setup

## Prerequisites
- Node ≥ 20 (have v24), npm.
- For desktop (`tauri dev/build`) only: Rust (`rustup`, msvc toolchain) + Visual Studio C++ Build Tools (`Microsoft.VisualStudio.Workload.VCTools`). WebView2 (already present on Win11).

## First run
```bash
npm install
npm run dev          # http://localhost:1420 (web mode — no Rust needed)
```

## Toolchain install (desktop)
```bash
winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
# Elevated (needs admin — accept UAC):
winget install --id Microsoft.VisualStudio.2022.BuildTools -e \
  --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```
If Build Tools install fails with error 8006 → it's elevation; run elevated. Fallback: `rustup default stable-x86_64-pc-windows-gnu`.

## Secrets / config
- Harvest PAT + account id, ADO PATs, and OAuth tokens are stored in the OS keychain at runtime (never committed). No `.env` secrets in the repo. Provider OAuth client IDs live in Settings.
