# ACR Master — handoff

Last updated: 2026-11-10 18:54 (Asia/Kathmandu)

## Scope
- Goal: OCR / auto-fill of New Trxn vouchers from attached documents (the ACR module only).
- App path (laptop DESKTOP-M4HAJE9, machineId `87099f47-479e-481c-afa5-031d443c15b8`): `C:\Project ERP\Refference apps\Touri + React`
- Files/paths:
  - `src/modules/ocr/` — engine, bill parser, hook, field bubbles, adapters, prefs
  - `src/lib/ocr/` — dates, receipt/document detectors, account matching, money-voucher fill
  - `tests/ocr/` — self-tests and text fixtures
- Architecture: local tesseract.js (eng/nep, `public/ocr/`) → format registry → generic field map + format parsers → unified own-account scorer → voucher-type classify → fill + field bubbles (SVG leader: speech-bubble tail or straight arrow).
- Does **not** own: Firebase, Git, Tauri/EXE/APK, PocketBase server, Gallery, or other form logic.

## Rules
- Recovery is from Git. **No local backup copies** of the working tree as a general rule (user rule since 4 Nov 2026), except when the user explicitly asks for a pre-edit copy because uncommitted work would be lost on Git restore.
- No git commit / push / stash / reset unless the user explicitly asks Git Master.
- Change only ACR/OCR module files (plus this handoff and the ACR Master row in `NIYAM.md`). Exception (owner-approved, 2026-11-10): `src/components/vouchers/AddVoucherDialog.tsx` only, so OCR bubble tails are not clipped — see progress log. `NIYAM.md` does not assign that file to any bot; it is not in ACR Master’s owned paths (`src/modules/ocr/`, `src/lib/ocr/`).

## Checklist
- [x] Format registry: connectIPS, Prabhu Bank, generic bank receipt, handwritten kharcha voucher, tax invoice (bill-like → existing `parseBill`)
- [x] Generic label-based field mapper (sender/beneficiary, amount, charge, date AD+BS incl. DMY and month-name, ref/txn, initiator phone, remarks, status)
- [x] Masked account matching (`*`, `#`, `x`); no equal-length rule; unified scorer for classify + fill; unique → fill, tie → pick popup
- [x] Direction: our A/c sender → Payment; receiver → Receipt; both → Contra. Party not found → stay + “create X?”, no auto-switch to Direct Expense
- [x] Auto-switch only when type confidence is high (≥ 0.85) and unique; else “Cannot detect voucher type” listing types
- [x] Status not SUCCESS → warning popup
- [x] Txn/Ref in narration; duplicate warning via read-only `useVouchers().vouchers` scan
- [x] Fill Payment, Receipt, Contra (and Direct Income/Expense where the same form fields apply)
- [x] SVG connectors: popup stays a rounded rectangle (radius 16). Default tail is a single path (rect + tail): starts at the nearest corner (or side if the field is mid-edge), wide base, cubic-bezier taper to a sharp point at the field, length = distance(corner/side → field). Straight arrow line kept as `connectorStyle: "line"`. Overlap is resolved by a global coordinator (all bubbles, both directions, least-overlap slot, clamp to dialog/viewport).
- [x] One OCR settings gear (when OCR is on): connector style, Auto Post, Overwrite edited, auto-save seconds, voucher-type auto-switch + seconds
- [x] Gallery/string-ref auto-OCR: `local:` / `pbatt:` / https|data|blob resolved in `loadFirstFile`; first-mount run on new vouchers
- [x] Low OCR confidence: confirm popups instead of a hard stop
- [x] Tests/fixtures for the 4 sample documents + existing OCR self-tests
- [x] `npm run typecheck` (tsc --noEmit -p tsconfig.typecheck.json) — pass, 2026-11-10 18:54
- [x] OCR self-tests (all `tests/ocr/*.selftest.mts`) + `npm run test:ocr` — all pass, 2026-11-10 18:54
- [x] Owner-approved outside-ACR clip fix: mobile `DialogContent` `overflow-hidden` → `overflow-visible` in `AddVoucherDialog.tsx` (desktop inner-frame `overflow-hidden` left in place; it does not clip portaled bubbles)
- [ ] Contra From/To fields still have no `data-ocr-field` anchors in `CreateContraForm.tsx` (outside ACR) — popups may fall back to the OCR bar
- [ ] Live UI check of the 4 real photos on the laptop

## Progress log
| Date/time (Asia/Kathmandu) | What changed | Files | Backup path |
|---|---|---|---|
| 2026-11-10 17:55 | Implemented approved ACR plan (format registry, generic mapper, mask/scorer, fill all money types, type/party popups, SVG leaders). Recorded HEAD `d1e0fc15` on clean `main` before edits. No commit. | `src/modules/ocr/*`, `src/lib/ocr/*`, `tests/ocr/*`, `_handoff/ACR Master.md`, ACR row in `_handoff/NIYAM.md` | — (Git; no local backup) |
| 2026-11-10 18:04 | Landed on DESKTOP-M4HAJE9 only (not ServerWin10). Fixed tax-invoice case-insensitive detect (MIN_CONF 0.6), handwritten voucher-no regex (was capturing the word “Voucher”), and `in`-narrowing for account tie options (`tsconfig` has `strict: false`). Typecheck and all OCR self-tests green. | `taxInvoice.ts`, `handwrittenVoucher.ts`, `fillPaymentOut.ts`, `useVoucherOcr.tsx`, this handoff, `NIYAM.md` ACR row | — (Git; no local backup) |
| 2026-11-10 18:15 | Approved follow-up: speech-bubble tail connector (default) + straight-line option via `connectorStyle` pref; one OCR-settings gear (removed Auto Post gear); gallery auto-OCR for string refs (`local:` / `pbatt:` / https|data|blob) and first-mount run on new vouchers. OCR_BUILD `2026-11-10.2`. Typecheck + all OCR self-tests green. No commit. | `OcrFieldBubbles.tsx`, `prefs.ts`, `VoucherOcrHeaderToggles.tsx`, `useVoucherOcr.tsx`, this handoff | `_handoff/acr-backup-2026-11-10-1810/` (pre-edit copies of those five files) |
| 2026-11-10 18:23 | Tail redesign only: popup shape unchanged (not a pill). Tail comes from the nearest corner or side, dynamic length = distance to the field, cubic bend, seamless rect+tail outline, no arrowhead. Line option unchanged. No OCR_BUILD bump. Typecheck + OCR self-tests green. No commit. | `src/modules/ocr/OcrFieldBubbles.tsx`, this handoff | `_handoff/acr-backup-2026-11-10-1810/OcrFieldBubbles.tsx.v2` (pre-edit copy of the previous tail version) |
| 2026-11-10 18:39 | Owner-approved outside-ACR change only: `AddVoucherDialog.tsx`. Confirmed OCR bubbles portal into the Radix `role="dialog"` node (`DialogContent`), as siblings of the desktop visual frame — not into a clipped child. shadcn `DialogContent` keeps a transform (`translate-x/y`, including `!translate-x-0`), so it is the containing block for `position:fixed` bubbles. Desktop `overflow-hidden` at the inner frame (~4917) does **not** clip those siblings; removing it would risk rounded-corner clipping of the form, so it was left alone. Mobile `DialogContent` itself had `overflow-hidden` (~5012, now 5015) which *does* clip tails at the viewport edge. Smallest fix: `overflow-visible` on mobile `DialogContent` only; form scroll stays on the inner wrapper (~5030). No other dialog logic changed. `NIYAM.md` lists no owner for this file (not ACR Master’s module). Typecheck + all OCR self-tests + `npm run test:ocr` green. No commit. Five ACR layout fixes still unapproved, not done. | `src/components/vouchers/AddVoucherDialog.tsx`, this handoff | `_handoff/acr-backup-2026-11-10-1810/src/components/vouchers/AddVoucherDialog.tsx` (pre-edit copy) |
| 2026-11-10 18:54 | Owner-approved overlap fix in OcrFieldBubbles only, edited directly (no backup — owner's choice). Replaced previous-sibling `avoidOverlap` with a global coordinator: measures all `[data-ocr-bubble]` boxes after layout, considers later bubbles as well as earlier ones, tries right/left/down/up candidates, picks the least-overlap slot, iterates until stable or 16 passes, clamps to the dialog content box / viewport, and stacks remaining collisions in free space along a side. `ResizeObserver` on each bubble (scroll/resize/400ms interval kept). Size caps: bubble body `max-height` `min(40vh, 280px)` (shrinks when the dialog is tight) with `overflow-y: auto`; max-width 300. Tails are computed only after final positions, using the same anchor as placement (`found ?? fallback`). If a bubble still sits on its field it is moved off first so a tail can be drawn. Key `"lines"` / `lines#N` prefer a compact row / first visible line cell over the whole table wrapper. Rectangle + seamless tail, `connectorStyle: "line"`, z-index, and Radix portal unchanged. `useVoucherOcr.tsx` not touched. Typecheck + all OCR self-tests + `npm run test:ocr` green. No commit. Live UI not run. | `src/modules/ocr/OcrFieldBubbles.tsx`, this handoff | — (no backup; owner's choice) |

## Next step
- Live UI check of the four sample photos on the laptop (and a gallery-attached string-ref image) to confirm the tail connector and auto-OCR; tune if needed.
- Optional (needs user approval, **outside ACR**): add `data-ocr-field="account"` anchors on Contra From/To in `CreateContraForm.tsx`.
