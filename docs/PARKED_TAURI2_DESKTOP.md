# Parked: Tauri 2 desktop EXE

**Status:** idea only (Oct 2026). Do **not** build until the human explicitly asks.

## Why

Current Electron EXE (~105 MB) is heavy on **low-end PCs** (RAM / startup). Tauri 2 uses the PC’s **Edge WebView2 inside the app window** (not a separate Edge/Chrome window). Smaller installer (~30–50 MB typical), less RAM, faster open. **Ledger/voucher JS stays the same** — table speed will not magically 2×.

## What not to confuse

- UI runs **in the Pocket Ledger window**, like today’s EXE.
- Not “open in browser”.
- Android APK stays Capacitor unless asked otherwise.
- Pocket Ledger **Server** license Phase 1 is started: `PocketLedger-Server/main-server` + `sub-server/plguard`. Hooks→Go compile is still Phase 2.

## When building (later)

- New `src-tauri` shell; keep `electron/` until parity.
- Port preload bridges: tabs, local PL server, backup folder pick, attachments, Google sign-in, auto-update.
- Same static `out/` web UI.
