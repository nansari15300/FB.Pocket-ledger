# Outside OCR 2 — voucher dialog company masters pull

Date: 2026-11-10 (Asia/Katmandu)

## Intent (user)

Header/sidebar company aur voucher-dialog company alag hon to **dono selected/active** maani jayein. Dialog wali company ke liye **poora company sync nahi** — sirf form ke kaam ke masters (parties, items, ledgers/accounts, groups). Main page / header ki company change nahi honi chahiye. Read/write kam, app smooth.

## Cause

Sidebar switch `setCompanyId` → `writeSelectedCompanyId` → `pl-selected-company-changed` → `pbRealtime` full/incremental pull of the **selected** company.

Desktop/EXE/web voucher-dialog header sirf `setTargetCompanyId` karta tha (jaan-boojh ke global `setCompanyId` nahi, taaki main page na badle). Nested `VoucherProvider` nayi company ki **local SQLite** padhta tha, lekin us company ka server pull trigger nahi hota tha. `activePocketBaseCompanyId()` header par hi rehta tha.

## What changed (no commit / no backup / no Firebase)

### `src/lib/pocketbaseData/pbCompanyRegistry.ts`

- `setDialogActivePocketBaseCompanyId` / `dialogActivePocketBaseCompanyId`.
- `isActivePocketBaseCompanyId` ab header **ya** open dialog target (PocketBase) dono ko active maanta hai.
- `activePocketBaseCompanyId` aur `listActivePocketBaseCompanyIds` **sirf header** — full idle catch-up / files pull dialog company par nahi chalte.
- Dialog band ya target = header ho to dialog id clear.

### `src/lib/pocketbaseData/pbSync.ts`

- `pullPocketBaseCompanyToLocal` optional `collections` filter. Scoped pull:
  - sirf un PocketBase collections ko padhta hai
  - company pull **cursor advance nahi** karta (baad ka full/incremental sync tut na jaye)
  - files pull, company-root sync, aur global progress bar skip
- Naya helper: `pullPocketBaseVoucherFormMastersToLocal` — `pl_parties`, `pl_bank_accounts`, `pl_staff`, `pl_items`, `pl_taxes`, `pl_expense_accounts`, `pl_groups`. **vouchers / unassigned docs / files nahi.**
- Live apply par file-queue sirf header selected company ke liye.

### `src/lib/pocketbaseData/pbRealtime.ts`

- Change-log: header company → pehle jaisa full/incremental catch-up pull.
- Change-log: dialog-only company → **masters-only** pull (`pullPocketBaseVoucherFormMastersToLocal`).
- Live collection events dialog company par apply ho sakte hain (`isActive` dono id).

### `src/components/vouchers/AddVoucherDialog.tsx`

- Global `setCompanyId` / `writeSelectedCompanyId` desktop dialog switch par ab bhi nahi (APK wala pehle jaisa pin path same hai).
- Jab dialog open ho, `targetCompanyId !==` header company, aur target PocketBase ho: dialog id mark + masters-only pull.
- Pull khatam hone tak chhota banner + form overlay guard.
- Dialog close / same-as-header / non-PB target par dialog-active clear.

`useVouchers.tsx` nahi chheda: pehle se `pl_server_pull` bump se nested provider SQLite re-read karta hai.

Forbidden files (OCR, `CreateItemDialog.tsx`, masterEntityGroup*) nahi chhui.

## How to test

1. Header/sidebar me company A select rakho. Page A ka ledger/dashboard same rehna chahiye.
2. Voucher dialog kholo, header company dropdown se **PocketBase company B** choose karo (A se alag).
3. Banner “Loading parties, items and accounts…” dikhe, phir B ke parties/items/accounts/ledgers dropdown me aane chahiye.
4. Peeche main page ab bhi company A par honi chahiye.
5. Dialog band karo; A ka data waisa hi. Sidebar se B kholo — pehle jaisa full sync path kaam kare (cursor scoped pull se aage nahi badha).
6. Offline: pehle se mirror me ho to wahi dikhe; crash na ho.
