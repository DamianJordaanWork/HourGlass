# Workflow: run & build

## Web (default dev loop — no Rust)
```bash
npm run dev         # Vite dev server, http://localhost:1420
npm run build       # tsc -b && vite build -> dist/
npm run preview     # serve dist/
npm run typecheck   # tsc -b --noEmit
npm run test        # vitest run
npm run test:watch
```

## Desktop (Tauri — needs toolchain)
```bash
npm run tauri dev     # launches the native window with the Vite dev server
npm run tauri build   # standalone installer (.msi/.exe) under src-tauri/target/release/bundle
```

## Notes
- Live Harvest/ADO/calendar calls work in desktop (Tauri HTTP, no CORS). In plain `vite dev` they need a dev proxy.
- Dev server port is fixed to **1420** (Tauri expects it). `src-tauri/**` is ignored by the Vite watcher.
