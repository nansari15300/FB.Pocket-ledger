# ACR Master — handoff

Last updated: 2026-11-10 18:04 (Asia/Kathmandu)

## Scope
- Goal: OCR / auto-fill of New Trxn vouchers from attached documents (the ACR module only).
- App path (laptop DESKTOP-M4HAJE9, machineId `87099f47-479e-481c-afa5-031d443c15b8`): `C:\Project ERP\Refference apps\Touri + React`
- Files/paths:
  - `src/modules/ocr/` — engine, bill parser, hook, field bubbles, adapters, prefs
  - `src/lib/ocr/` — dates, receipt/document detectors, account matching, money-voucher fill
  - `tests/ocr/` — self-tests and text fixtures
- Architecture: local tesseract.js (eng/nep, `public/ocr/`) → format registry → generic field map + format parsers → unified own-account scorer → voucher-type classify → fill + field bubbles (SVG leader lines).
- Does **not** own: Firebase, Git, Tauri/EXE/APK, PocketBase server, or other form logic.

## Rules
- Recovery is from Git. **No local backup copies** (user rule since 4 Nov 2026).
- No git commit / push / stash / reset unless the user explicitly asks Git Master.
- Change only ACR/OCR module files (plus this handoff and the ACR Master row in `NIYAM.md`).

## Checklist
- [x] Format registry: connectIPS, Prabhu Bank, generic bank receipt, handwritten kharcha voucher, tax invoice (bill-like → existing `parseBill`)
- [x] Generic label-based field mapper (sender/beneficiary, amount, charge, date AD+BS incl. DMY and month-name, ref/txn, initiator phone, remarks, status)
- [x] Masked account matching (`*`, `#`, `x`); no equal-length rule; unified scorer for classify + fill; unique → fill, tie → pick popup
- [x] Direction: our A/c sender → Payment; receiver → Receipt; both → Contra. Party not found → stay + “create X?”, no auto-switch to Direct Expense
- [x] Auto-switch only when type confidence is high (≥ 0.85) and unique; else “Cannot detect voucher type” listing types
- [x] Status not SUCCESS → warning popup
- [x] Txn/Ref in narration; duplicate warning via read-only `useVouchers().vouchers` scan
- [x] Fill Payment, Receipt, Contra (and Direct Income/Expense where the same form fields apply)
- [x] SVG leader lines + stronger collision avoidance
- [x] Low OCR confidence: confirm popups instead of a hard stop
- [x] Tests/fixtures for the 4 sample documents + existing OCR self-tests
- [x] `npm run typecheck` (tsc --noEmit -p tsconfig.typecheck.json) — pass, 2026-11-10 18:04
- [x] OCR self-tests (dates, receiptDetect, fillPaymentOut, sampleDocs) + `npm run test:ocr` — all pass
- [ ] Contra From/To fields still have no `data-ocr-field` anchors in `CreateContraForm.tsx` (outside ACR) — popups may fall back to the OCR bar
- [ ] Live UI check of the 4 real photos on the laptop

## Progress log
| Date/time (Asia/Kathmandu) | What changed | Files | Backup path |
|---|---|---|---|
| 2026-11-10 17:55 | Implemented approved ACR plan (format registry, generic mapper, mask/scorer, fill all money types, type/party popups, SVG leaders). Recorded HEAD `d1e0fc15` on clean `main` before edits. No commit. | `src/modules/ocr/*`, `src/lib/ocr/*`, `tests/ocr/*`, `_handoff/ACR Master.md`, ACR row in `_handoff/NIYAM.md` | — (Git; no local backup) |
| 2026-11-10 18:04 | Landed on DESKTOP-M4HAJE9 only (not ServerWin10). Fixed tax-invoice case-insensitive detect (MIN_CONF 0.6), handwritten voucher-no regex (was capturing the word “Voucher”), and `in`-narrowing for account tie options (`tsconfig` has `strict: false`). Typecheck and all OCR self-tests green. | `taxInvoice.ts`, `handwrittenVoucher.ts`, `fillPaymentOut.ts`, `useVoucherOcr.tsx`, this handoff, `NIYAM.md` ACR row | — (Git; no local backup) |

## Next step
- Live UI check of the four sample photos on the laptop; tune detector scores / labels if a live slip OCR’s labels differ from the text fixtures.
- Optional (needs user approval, **outside ACR**): add `data-ocr-field="account"` anchors on Contra From/To in `CreateContraForm.tsx`.
