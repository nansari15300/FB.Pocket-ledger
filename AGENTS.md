# Agent instructions (any AI)

This file applies to **any** coding agent working in this repo (Cursor, Claude Code, Codex, Copilot Chat, Gemini CLI, Windsurf, etc.). Read it before changing project code.

## Freeze: Backup & Restore

Backup/restore was stabilized for online → local portable `.plbp` with attachments. **Do not edit these areas unless the human explicitly asks to change backup/restore.**

### Frozen paths (do not touch casually)

- `src/components/settings/BackupRestore.tsx`
- `src/components/settings/AutoBackupScheduler.tsx`
- `src/lib/companyBackupCore.ts`
- `src/lib/companyBackupRunner.ts`
- `src/lib/attachmentBackupBundle.ts`
- `src/lib/backupAttachmentPreflight.ts`
- `src/lib/plbpBackupZip.ts`
- `src/lib/incrementalBackupFromLocation.ts`
- `src/lib/localBackupRestoreCompany.ts`
- `src/lib/companyBackupCollections.ts`
- `src/lib/companyRestoreProgress.ts`
- `src/hooks/useCompanyBackupRun.ts`

### Do not

- Refactor, rename, “clean up”, or drive-by edit the frozen paths.
- Change backup source mode, attachment missing-file policy, restore order, or orphan-delete hold without an explicit request.
- Touch frozen files while doing unrelated UI / ledger / sync work.

### If the human explicitly asks to change backup/restore

- Keep the change minimal and scoped to the request.
- Preserve: SQLite-only static backup, download vs continue-local-only prompt, pending `local:` embed, restore attachment hold (no orphan wipe of restored bytes), zip byte sniff on restore.

## Freeze: Attachment preview (hard — both systems)

**Aug 2026:** Hover portal preview **and** click-to-open full preview are stabilized on web, EXE, and APK. **Do not edit either system unless the human explicitly asks to change attachment preview in that same message.**

### Permission (every AI)

Before changing **any** file listed below (or preview fit/zoom/open routing behavior):

1. **Stop** — do not edit, refactor, or “small fix” preview code while doing unrelated work.
2. **Ask the human** in chat: which preview (portal / full open / both), what symptom, and confirm they want an edit now.
3. Proceed **only** after explicit approval in that conversation (e.g. “preview fix karo”, “portal preview change”, “PDF open preview change”).

Casual mentions (“PDF thoda adjust”, “preview improve”) without clear override **do not** lift this freeze.

---

### A. PDF portal preview (hover / ledger cell / portal panel)

PDF attachment portal preview was stabilized so PDF files behave like image previews:

- no blurry low-resolution thumbnail flash in the portal
- full-quality first-page raster is cached separately from the small row thumbnail
- repeated portal opens must not reuse revoked `blob:` URLs or collapse to an empty strip
- fit-window must stay stable on first click and repeat clicks

#### Frozen portal paths (do not touch casually)

- `src/components/vouchers/AttachmentHoverPortal.tsx`
- `src/components/vouchers/attachmentHoverPreviewBody.tsx`
- `src/hooks/useAttachmentThumbDisplayUrl.ts`
- `src/lib/attachmentHoverBlobCache.ts`
- `src/lib/pdfToImage.ts`
- `src/lib/pdfToImageExport.ts` (portal raster + stitched JPEG meta — shared with full open; **frozen for preview**)

#### Do not (portal)

- Revert PDF portal preview back to browser/PDF iframe rendering for this portal.
- Mix the full-quality PDF portal raster cache with the small `::cell-thumb` cache.
- Revoke a cached `blob:` URL without removing that exact cache entry.
- Change PDF portal fit/zoom/scroll behavior unless the human explicitly asks.

---

### B. Full attachment open preview (click tile → fullscreen)

Click-to-open preview was stabilized so party and voucher forms behave the same:

- PDF opens via raster → **`showInAppImagePreview`** (toolbar: **Browser / Width / Height**; default **Height** = one page fit)
- multi-page PDF: stitched JPEG, `pdfOnePageHeightPx`, scroll for page 2+
- JPEG bytes stored with PDF label (“save as image” / locked PDF image) → **image preview**, not native PDF iframe at 100% with dead ± zoom
- PDF click prefers **canonical** `https` / `local:` / storage path over **cell-thumb** blob URLs
- `showInAppPdfPreview` (Fit / Print / Share) is **fallback only** when raster fails; image sniff must redirect to image preview
- same behavior target on **web, EXE, APK** (APK may still use external viewer only on explicit native-cache edge paths — do not widen those without asking)

#### Frozen full-open paths (do not touch casually)

- `src/lib/openAttachmentInApp.ts`
- `src/lib/inAppImagePreview.ts`
- `src/lib/inAppPdfPreview.ts`
- `src/lib/inAppGalleryImageZoom.ts`
- `src/lib/inAppAttachmentGallery.ts`
- `src/lib/inAppAttachmentPreviewOpen.ts`
- `src/lib/shouldUseInAppPdfPreview.ts`
- `src/lib/pdfToImageExport.ts` (shared with portal — see above)
- `src/components/vouchers/FilePreview.tsx` (tile preview, click-open, PDF thumb prewarm, gallery prewarm hooks)
- `src/components/gallery/GalleryPageClient.tsx` (gallery PDF thumb / open parity)

#### Do not (full open)

- Route voucher PDF click through a different viewer than party (native full-width iframe as default).
- Open cell-thumb JPEG as the fullscreen “PDF” when full bytes or canonical URL exist.
- Remove or bypass `openPdfBlobAsImagePreview` / `pdfOnePageHeightPx` height-fit without explicit request.
- Change ± zoom / Width / Height semantics in full open preview unless the human explicitly asks.

---

### If the human explicitly asks to change attachment preview

- Say which system (portal / full open / both) and keep the diff minimal.
- Preserve repeat-click behavior (portal) and party=voucher open parity (full open).
- Test at minimum: party PDF click, voucher PDF click, multi-page scroll, JPEG-as-PDF receipt, gallery grid PDF.

### Not frozen (outside preview)

Invoice/print-only PDF overlays (`printDirect`, billing statement PDF, sale invoice page) are **not** part of this freeze unless the human groups them with “attachment preview”. Backup/restore preview UI remains under the Backup freeze section above.

## Freeze: File / attachment compression (hard)

**Sep 2026:** Voucher + master image compression (admin From–To KB band, save recompress, add-file compress, parallel multi-file, cancel + toast stack) is stabilized on web, EXE, and APK. **Do not edit unless the human explicitly asks to change attachment / file compression in that same message.**

### Permission (every AI)

Before changing **any** file listed below (or compression cap / cancel / toast behavior):

1. **Stop** — do not edit, refactor, or “small fix” compression code while doing unrelated voucher/ledger/master work.
2. **Ask the human** in chat: which flow (add file / save recompress / master upload), what symptom, and confirm they want an edit now.
3. Proceed **only** after explicit approval (e.g. “compression fix karo”, “compress band change”, “compression speed change”).

Casual mentions (“file thoda chhota karo”, “compress faster”) without clear override **do not** lift this freeze.

### Frozen paths (do not touch casually)

- `src/lib/compression.ts` — JPEG/PDF compress, `fitJpegToTargetBand`, shrink-only fast path, `compressVoucherAttachment`
- `src/lib/attachmentRecompressOnSave.ts` — `prepareVoucherAttachmentsForSave`, `recompressOversizedImageAttachmentsOnSave`, shared HTTPS recompress
- `src/lib/attachmentCompressionUi.ts` — plan band resolve, progress/cancel toasts, `compressImageForCompany`, master compress helpers
- `src/lib/appendCompressedVoucherAttachments.ts` — add-file / paste compress, parallel batch, processing flag
- `src/lib/plansCatalogCache.ts` — `resolvePlansCatalogForEntitlements` (compression plan caps hydrate)
- `src/lib/voucherSaveUi.ts` — **compression/cancel only:** `cancelVoucherInFlightWork`, `VOUCHER_SONNER_TOAST_CN`, `VOUCHER_SONNER_TOAST_POSITION`, compression branch in `voucherSaveErrorToast`
- `src/components/ui/sonner.tsx` — Toaster stack layout used by compression/save toasts (`expand`, `gap`, `visibleToasts`)

### Stabilized behavior to preserve

- **Plan band:** online Firebase company → admin online band (e.g. 40–45 KB); local/PL/Drive → offline band; SQLite + Firestore plans hydrate when cache empty.
- **Add file + save:** same `compressVoucherAttachment` path; multi-file **parallel** compress; oversized HTTPS on save → recompress + upload (shared rewrite with per-voucher fallback).
- **Speed:** oversized photos use **shrink-only** band fit (no upscale scan for 100 KB → cap case).
- **Cancel:** Cancel / dialog close → abort in-flight compress, dismiss loading toast, info toast “Attachment compression cancelled” (no console error).
- **Toasts:** save + compress loading rows stacked (Sonner expanded list); compress done dismisses loading before success row.

### Do not

- Refactor, rename, or drive-by edit frozen paths while fixing unrelated UI / ledger / sync work.
- Revert parallel multi-file compress to sequential.
- Re-enable full upscale `fitJpegToTargetBand` scan for already-oversized voucher photos.
- Change cancel semantics (toast stuck / compress continues after Cancel) without explicit request.
- Change admin per-plan cap resolution back to cache-only `"basic"` / default 100 KB without explicit request.

### If the human explicitly asks to change compression

- Keep the diff minimal and scoped to that request.
- Preserve: working compress on save + add file, cancel abort, toast stack, master + voucher parity.
- Test at minimum: add 2× ~100 KB images, edit save recompress, Cancel mid-compress, one master photo upload.

## Freeze: Master account freeze (hard — Freez Account)

**Aug 2026:** Master account freeze (owner toggle, diagonal overlay, list badge, voucher dropdown disabled) is stabilized for party, staff, bank/cash, tax, and expense. **Do not edit unless the human explicitly asks to change account freeze in that same message.**

### Frozen paths (do not touch casually)

- `src/lib/masterAccountFreeze/**`
- `src/components/masterAccountFreeze/**`
- `src/hooks/useMasterAccountFreezeFeature.ts`
- `src/hooks/useMasterAccountFreezeOwner.ts`
- `src/hooks/useMasterAccountFreezeDetailsChrome.tsx`

### Stabilized behavior to preserve

- Owner footer toggle: tick = freeze / unfreeze (auto-save).
- Frozen details: diagonal overlay blocks new transactions; optional owner-only message.
- List rows: “Freezed Account” badge.
- Voucher comboboxes: frozen masters **visible but disabled** via `map*ForVoucherCombobox` / `withMasterAccountFreezeComboboxOption` — label includes `(Freezed Account)`.
- Plan gate: `masterAccountFreezeEnabled` + permission `freeze_master_account`.

### Do not

- Refactor, rename, or drive-by edit frozen paths while fixing unrelated ledger/voucher/sync work.
- Remove or bypass combobox `disabled` for frozen accounts in voucher forms.
- Change overlay, toggle labels, or save semantics without explicit request.

### If the human explicitly asks to change account freeze

- Keep the diff minimal and scoped to that request.
- Preserve: visible-but-disabled in vouchers, overlay on details, owner-only toggle.

## Freeze: Online Company Sync (hard)

**Online company sync is frozen for every AI.** Do not edit online sync logic unless the human explicitly asks to change **online / Firebase / cloud company sync**.

Stabilized behavior to preserve:
- Firestore live listeners / delta (change-only) sync
- Online company select / mirror / cloud upload
- Write gateway for online companies
- Online attachment HTTPS URL + Storage byte sync

### Frozen online company sync paths (do not touch casually)

- `src/firebase/**`
- `src/app/api/company/**`
- `src/app/api/admin/**`
- `src/lib/writeGateway/**`
- `src/lib/companyOnlineSync.ts`
- `src/hooks/useCompanyOnlineSync.ts`
- `src/lib/onlineCompanySelectorSyncPolicy.ts`
- `src/lib/mirrorOnlineCompaniesFromFirestore.ts`
- `src/lib/firestoreToLocalCompanyPull.ts`
- `src/lib/firebaseLedgerSyncPolicy.ts`
- `src/lib/firebaseLedgerSyncMode.ts`
- `src/lib/firebaseLedgerCompanySyncPrefs.ts`
- `src/lib/firebaseLedgerDataSyncDisabled.ts`
- `src/lib/companyOnlineIntegrity.ts`
- `src/lib/companyOnlineSlots.ts`
- `src/lib/apkOnlineFirestoreWritePolicy.ts`
- `src/lib/companyAttachmentStrategies/onlineCompanyAttachmentStrategy.ts`
- `src/lib/resolveAuthoritativeFirestoreCompanyId.ts`
- `src/lib/resolveVoucherAttachmentRemoteUrl.ts`
- `src/components/FirebaseLedgerDeltaSyncManager.tsx`
- `src/components/company/FirebaseLedgerOnlineCompanySyncList.tsx`
- `src/components/company/UploadCompanyToCloudCard.tsx`
- `src/components/company/ForceUploadLocalDataButton.tsx`
- `src/components/layout/FirebaseLedgerSyncModeSwitch.tsx`
- `src/components/layout/FirebaseLedgerDataSyncSidebarSwitch.tsx`

### Do not (online)

- Refactor, rename, “clean up”, or drive-by edit online sync paths.
- Change Firestore listeners, delta watermarking, cloud upload, write gateway, or Storage attachment linking for unrelated work.
- While fixing **PL Server**, do **not** edit online sync files — read them only as a behavior reference and implement fixes under PL Server paths.
- Do not “share” helpers if that forces online sync files to change; duplicate minimally on the PL side instead.

### If the human explicitly asks to change online sync

- Keep the change minimal and scoped to that exact request.
- Do not silently route online companies through PL Server/local server code.

## Freeze: PL Server / local sharing

PL Server/local sharing is protected. **Do not edit these areas unless the human explicitly asks to change PL Server or local server sharing.**

When the human asks for PL Server fixes (including “make PL like online”):
- Change **only** PL Server paths below.
- Leave **Online Company Sync** frozen (section above).
- Match online *behavior* by reimplementing on the PL side; do not modify online sync code to drive PL.

### Frozen PL Server paths (do not touch casually)

- `localAppServer.js`
- `staticAppServer.js`
- `electron/localAppServer.js`
- `electron/staticAppServer.js`
- `electron/plServerCompanyDetectionAudit.js`
- `electron/plMirrorProtocol.cjs`
- `electron/localAppServerAccessTokens.js`
- `src/components/settings/PlServerLiveSyncManager.tsx`
- `src/components/settings/PlServerHostAttachmentDeltaBootstrap.tsx`
- `src/components/settings/PlServerGateRefreshBootstrap.tsx`
- `src/components/settings/PlServerGateLedgerBootstrap.tsx`
- `src/components/settings/PlServerGateLandingBootstrap.tsx`
- `src/components/settings/PlServerClientDeltaManager.tsx`
- `src/components/settings/PlServerAccessCompanyBanner.tsx`
- `src/components/settings/PlServerAccessBootstrap.tsx`
- `src/components/settings/PlRemoteClientLandingBootstrap.tsx`
- `src/components/settings/PlFirebaseAuthHandoffBootstrap.tsx`
- `src/components/settings/LocalServerShareAutoConnectManager.tsx`
- `src/components/settings/LocalPlServerSharePanel.tsx`
- `src/components/settings/LocalPlServerSharedCompaniesPicker.tsx`
- `src/components/company/PlServerShareUserDialog.tsx`
- `src/components/company/PlServerSharedCompanyUrlDialog.tsx`
- `src/components/ServerShareableCompaniesBridge.tsx`
- `src/components/PlServerAttachmentPreloadManager.tsx`
- `src/lib/plServer*.ts`
- `src/lib/plSharingPortRegistry.ts`
- `src/lib/plMirrorProtocol.ts`
- `src/lib/plServerHttpRelay.ts`
- `scripts/dev-pl-local-server-cli.mjs`
- `scripts/run-plserver-company-detection-audit.mjs`
- `scripts/run-phase1b-runtime-verify.mjs`

### Do not (PL Server)

- Refactor, rename, clean up, or drive-by edit PL Server/local sharing code when not requested.
- Change PL Server invite/access-token/auth, host/client delta sync, port registry, LAN relay, or attachment delta behavior for unrelated work.
- Mix Drive sync or online/cloud edits into PL Server work unless the request explicitly says to connect those flows.
- Silently route PL Server companies through online/cloud sync code.

### If the human explicitly asks to change PL Server

- Keep the change minimal and scoped to that exact request.
- Preserve local-first PL Server behavior.
- Do not edit frozen Online Company Sync paths while doing PL work.

## Freeze: Voucher save (local-first + instant dialog close)

**Sep 2026:** All voucher types (sale, purchase, payment, journal, contra, salary, adjustment, note, production, inter-company) use **SQLite-first save → dialog closes immediately → Firestore/outbox sync in background** on web, EXE, and APK. **Do not edit unless the human explicitly asks to change voucher save / update UX or sync timing in that same message.**

### Frozen paths (do not touch casually)

- `src/lib/writeGateway/voucherActionsClient.ts` — `saveVoucher`, `patchVoucherFields` sqlite-first branches (no blocking inline Firestore on sqlite-first)
- `src/lib/voucherFormAttachmentSave.ts` — `finalizeVoucherAttachmentsAfterFormSave`, `scheduleBackgroundOutboxFlushAfterFormSave`
- `src/lib/apkOnlineFirestoreWritePolicy.ts` — `shouldAutoFlushOutboxAfterEnqueue` semantics for save UX

### Stabilized behavior to preserve

- Save/Update click → local SQLite write completes → voucher dialog hides (Save & Close).
- Online company cloud mirror via outbox + **background** `flushVoucherOutbox` — Save UI must not await network.
- `patchVoucherFields` on sqlite-first path: enqueue outbox only; no inline `updateDoc`/`setDoc` blocking save.
- Salary / Adjustment forms: same dialog-close-first pattern as Sale/Purchase (post-save tail in background for Save & Close).

### Do not

- Re-introduce awaiting Firestore or full outbox flush before dialog close on any voucher form.
- Change sqlite-first gating back to Firestore-first for online companies without explicit request.
- Refactor voucher forms’ save handlers for unrelated UI work.

### If the human explicitly asks to change voucher save

- Keep the diff minimal and scoped to that request.
- Preserve: instant local persist + dialog close + background sync on all platforms.

## Freeze: Ledger Approve / Approve All (hard — web + EXE + APK)

**Sep 2026:** Party/bank/staff ledger **Approve** (row menu) and **Approve All** (page) are stabilized on **web, EXE, and APK** — same shared client bundle, no platform-specific approve fork. **Do not edit unless the human explicitly asks to change ledger approve / approval sync in that same message.**

### Frozen paths (do not touch casually)

- `src/lib/writeGateway/voucherActionsClient.ts` — `approveVoucherWithHistory`, `approveVouchersWithHistoryBatch`, `approveVoucherLocalPersist` (approve-only; save paths stay under voucher-save freeze above)
- `src/lib/ledgerPendingApproval.ts` — unapproved filter, local approve hold, `preserveLocalVoucherApprovalOverIncoming`, merge helpers
- `src/lib/localVoucherOutbox.ts` — `scheduleVoucherApprovalOutboxFlush`, `readPendingApprovalOutboxByVoucherId` (approve background Firestore push)
- `src/lib/voucherFormAttachmentSave.ts` — `dispatchVoucherLivePatch`, `dispatchVoucherLivePatchMany`, `subscribeVoucherLivePatch`
- `src/lib/firestoreToLocalCompanyPull.ts` — voucher `isApproved` preserve inside `mergeRemoteSnapshotWithLocalOnlyDocs`
- `src/lib/localCompanyDocMirror.ts` — voucher approval preserve on `mirrorCollectionDocsToBrowserDbSilent` / `mirrorCompanyDocToBrowserDb`
- `src/lib/fyPagination/scopeFilter.ts` — `mergeFyHydratedWithLiveVouchers`
- `src/contexts/FyVoucherScopeContext.tsx` — `patchHydratedVouchers`
- `src/components/fyPagination/FyVoucherScopeBootstrap.tsx` — `FyHydratedVoucherLivePatchSync`
- `src/hooks/useVouchers.tsx` — `patchVoucherInCache`, `patchVouchersInCache`, live-patch listener (`voucherIds.length > 0`), FY scoped voucher merge
- `src/hooks/useFyScopedVouchers.ts` — scope filter only (no double FY hydrated merge)
- `src/components/vouchers/TransactionsTable.tsx` — `handleApproveVoucherDefault`, `handleApproveAllVisible`, `pageUnapprovedVouchers` (FY partition/opening rows excluded from approve targets only — not from normal txn pink styling)

### Stabilized behavior to preserve (all platforms)

- **Live UI first:** optimistic `dispatchVoucherLivePatch` / `dispatchVoucherLivePatchMany` before SQLite write — pink row turns white without refresh.
- **Local persist:** SQLite `isApproved: true` + history entry; Approve All uses quiet writes (`skipUiNotify`) — no per-row collection bump race.
- **Background server:** `scheduleVoucherApprovalOutboxFlush` (priority per-voucher outbox flush) — Firestore gets `isApproved` without blocking ledger UI.
- **Refresh / listener:** stale Firestore snapshot must not wipe local or pending-outbox approval (`preserveLocalVoucherApprovalOverIncoming`).
- **FY scope:** `mergeFyHydratedWithLiveVouchers(hydrated, live)` — live `useVouchers` patch wins over stale `hydratedVouchers`; hydrated cache also patched on live approve events.
- **EXE / APK:** same paths as web (`embeddedClientPrefersQuietBackgroundSync` may debounce SQLite UI bumps — approve live patch + preserve rules still apply).

### Do not

- Revert to Firestore-first approve that blocks UI or requires page refresh for pink → white.
- Remove optimistic dispatch, batch quiet writes, or end-of-batch re-patch.
- Let `mergeVouchersById(hydrated, live)` overwrite live approve with stale FY hydrate.
- Drop approval preserve on Firestore pull / silent mirror (causes refresh flash back to unapproved).
- `await` full outbox flush before ledger paint on Approve / Approve All click.

### If the human explicitly asks to change ledger approve

- Keep the diff minimal and scoped to that request.
- Preserve: live paint, local-first persist, background server flush, refresh-safe approval merge on web + EXE + APK.
- Test at minimum: single Approve, Approve All (2+ rows), refresh after approve, FY-scoped party ledger on web and one embedded build (EXE or APK).

## Freeze: Mobile Default txn card UI (hard)

**Sep 2026:** Mobile **Default** card theme (picker label “Default”, code `violet`) on party ledger + Dashboard **Recent** uses stabilized list layout: white cards, blue gap strip, 3D shadow, 8px side inset + 8px card gap. **Do not edit unless the human explicitly asks to change mobile Default txn card UI in that same message.**

### Frozen paths (do not touch casually)

- `src/components/vouchers/TransactionsTable.tsx` — `isDefaultMobileTxnCardTheme`, `mobileTxnListGapClass`, `mobileTxnListSideClass`, `mobileCardLayoutLikeParty` / party-parity mobile list block
- `src/app/globals.css` — `[data-pl-mobile-card-page-color="violet"]` gap strip (`#bfdbfe`) and Default 3D card shadow block (search `FREEZE: Default (violet) 3D`)

### Stabilized behavior to preserve

- **Default theme only:** gap strip blue `#bfdbfe`; cards white; layered blue 3D shadow; 8px horizontal inset + 8px between cards.
- **Green / Blue / Pink / Amber themes:** unchanged palette and spacing (2px side / 4px gap legacy).
- **Dashboard Recent (mobile):** `mobileCardLayoutLikeParty` — same mobile card list layout as party page for every card theme; desktop daybook table columns unchanged.

### Do not

- Revert Recent to daybook-only mobile strip (`px-[2px]`, `-mx-[2px]`) without explicit request.
- Change Default gap color, 3D shadow, or 8px spacing while doing unrelated ledger/dashboard work.
- Apply Default-only blue gap / 3D styling to other card themes without explicit request.

### If the human explicitly asks to change mobile Default txn card UI

- Keep the diff minimal and scoped to that request.
- Preserve: white cards, other themes unchanged unless they ask for those too.

## Freeze: Mobile txn card title — no voucher type (hard)

**Sep 2026:** Mobile transaction card header (party, staff, bank, item/group reports, Dashboard Recent, daybook mobile cards — all `TransactionsTable` mobile view) shows **voucher number + opposite account only**. Raw voucher type label (`sale`, `journal`, `payment out`, …) is **hidden** because the voucher no prefix already encodes type (`PUR-095`, `JRNL-0245`, `Sale Inv-053`). **Do not edit unless the human explicitly asks to change mobile txn card title / voucher type display in that same message.**

### Frozen paths (do not touch casually)

- `src/components/vouchers/TransactionsTable.tsx` — mobile `titleLabel` in `renderMobileCard`; `mobileCardPreviews` title (card theme picker samples)

### Stabilized behavior to preserve

- Title format: `{voucherNumber || type fallback} · {opposite account}` — **never** insert `getDisplayType(t)` or equivalent type string between voucher no and party name.
- Example: `JRNL - 0245 · Dinesh Shah Kaanu` — **not** `JRNL - 0245 · journal · Dinesh Shah Kaanu`.
- Desktop/table **Type** column unchanged; freeze applies to **mobile card view only**.

### Do not

- Re-add `displayType` / `getDisplayType` to mobile card titles while fixing unrelated ledger, search, or theme work.
- Show voucher type in mobile card header “for clarity” or parity with desktop without explicit human request.

### If the human explicitly asks to show voucher type on mobile again

- Keep the diff minimal and scoped to that request.
- Confirm whether they want type on all mobile ledgers or only a specific screen.

## Freeze: Bill-wise linked voucher Show more / Show less (hard)

**Sep 2026:** Bill-wise **Status** linked voucher numbers (Partial/Paid rows, opening balance links, mobile bill-wise cards) show **2 voucher nos** by default with **Show more (+N)** / **Show less**. **Do not edit unless the human explicitly asks to change this linked-voucher collapse UX in that same message.**

### Frozen paths (do not touch casually)

- `src/components/vouchers/transactionTableShared.tsx` — `LinkedVouchersColoredCollapsible`, `LINKED_VOUCHERS_COLLAPSED_COUNT`, `LinkedVouchersColored` (when used from collapsible), status-under-badge + narration sub-row + `BillWiseLinkedDetailCells` linked list
- `src/components/vouchers/TransactionsTable.tsx` — **only** `LinkedVouchersColoredCollapsible` usages (mobile bill-wise status detail + opening-balance linked voucher rows); other `TransactionsTable` areas stay under their own freezes (approve, mobile card UI, etc.)

### Stabilized behavior to preserve

- **Collapsed:** max **2** linked voucher numbers visible (2-per-line colors unchanged).
- **Expanded:** full list via **Show more (+N)**; **Show less** restores collapsed.
- Toggle is a **button** with **stopPropagation** — must not trigger row click / open voucher.
- Desktop status badge stack + bill-wise narration detail + mobile bill-wise parity.

### Do not

- Revert to showing all linked PUR/PYMT nos at once on long Partial rows while fixing unrelated bill-wise or status work.
- Change collapsed count or button copy casually; remove collapsible wrapper without explicit request.

### If the human explicitly asks to change linked-voucher show more

- Keep the diff minimal and scoped to that request.
- Preserve row-click isolation unless they ask to change that too.

## Freeze: Entity ledger txn table — unified H-scroll / width (hard)

**Oct 2026:** Party/bank/staff/tax/expense/item **desktop** entity ledgers: one unified horizontal scroll (ribbon + split thead/body + closing summary + footer pagination), **longest-band width win**, V-scroll must not reset H-scroll, split thead must stay column-aligned with body. **Do not edit unless the human explicitly asks to change entity ledger txn table scroll / width / header–footer alignment in that same message.**

### Frozen paths (do not touch casually)

- `src/lib/ledgerUnifiedContentWidth.ts` — natural band measure, footer row sum, stabilize px, `computeLedgerUnifiedTableMinPx`
- `src/components/vouchers/LedgerTxnScrollColumn.tsx` — unified scroll column shell (header / table / footer)
- `src/components/vouchers/LedgerDesktopFooter.tsx` — footer measure row (`data-pl-ledger-footer-measure-row`), shell width behavior
- `src/lib/ledgerHeaderChrome.ts` — `LEDGER_TXN_SCROLL_*`, scroll host / inner / table-host class strings used by entity ledgers
- `src/components/vouchers/TransactionsTable.tsx` — **unified-scroll / split-scroll only:** `syncDashboardRecentHorizontalScroll`, `ledgerUnifiedHScrollActive`, `applyUnifiedTableWidthVar`, `ledgerHostClientWidth`, `effectiveSplitScrollColWidths`, split thead/body/fixed-summary/footer H-scroll gates (not approve, mobile card title, bill-wise collapsible — those have their own freezes)
- `src/app/globals.css` — blocks tagged **`data-pl-ledger-txn-unified-scroll`**, **`data-pl-ledger-txn-page`** unified full-bleed, master-detail `25-75` under `main:has([data-pl-ledger-txn-page])` (search file; do not drive-by edit unrelated globals)

### Stabilized behavior to preserve

- **Single H-scroll owner:** `[data-pl-ledger-txn-unified-scroll]`; hide separate `[data-pl-ledger-txn-hscroll]` bar when unified is active.
- **Width win:** max(natural ribbon, footer pagination row, closing balance card, column sum, optional `[data-pl-ledger-unified-width-band]`) → `--pl-ledger-txn-table-min-px` + proportional column scale; measure footer via child sum, not stretched shell width.
- **V vs H scroll:** body vertical scroll must **not** push `scrollLeft=0` onto the unified host; preserve `scrollLeft` across width remeasure when only v-scrollbar gutter changes.
- **Alignment:** unified host scroll moves inner as one piece — **do not** mirror unified `scrollLeft` onto nested thead scrollport (double shift); thead `overflow-x: hidden` in unified mode.
- **Layout:** detail pane full bleed with unified scroll; left master list `25-75` grid intact (`min-w-0`, no broken `display:flex` on grid root).

### Do not

- Refactor, rename, or drive-by edit frozen paths while fixing unrelated voucher rows, search, print, or themes.
- Re-enable per-body or per-footer horizontal scroll syncing that resets unified H position on vertical scroll.
- Re-enable nested thead horizontal sync on unified host scroll (breaks header/body column alignment).
- Remove natural footer width measure or re-measure stretched table/shell widths (ResizeObserver / stall loops).

### If the human explicitly asks to change unified txn scroll / width

- Keep the diff minimal and scoped to that request.
- Preserve: one H-scroll, width win, V-scroll safe H position, header/body/footer same min width.
- Test at minimum: narrow detail pane + H scroll right + V scroll (H stays); wide pane col fill; bank account with long footer pagination; party group ledger.

### Same file note

`TransactionsTable.tsx` is shared with **Ledger Approve / Approve All** — only edit the half the human asked for; never mix approve changes with unified-scroll changes in one casual diff.

## Freeze: Dashboard boot — SQLite-first, no UI freeze (hard)

**Sep 2026:** App start, company switch, and navigate to `/dashboard` (web, EXE, APK): show dashboard **immediately** from SQLite; full voucher merge and sync run **in background** without blocking clicks or full-page skeleton. **Do not edit unless the human explicitly asks to change dashboard boot / voucher load UX in that same message.**

### Frozen paths (do not touch casually)

- `src/hooks/useVouchers.tsx` — `loadVouchersFromSqliteFastFirst`, `scheduleIdleWork`, `isDashboardVouchersOnlyPrefetch`, `runSqlitePrefetchSplit` / dashboard lite `markSqliteBootReady`, `makeVouchersSqliteLoader`, `commitVouchersSetter` (`startTransition`)
- `src/components/dashboard/DashboardPageClient.tsx` — no full-page voucher skeleton; `initialVoucherBootSettled` loading gate (background merge must not re-block dashboard)

### Stabilized behavior to preserve

- **SQLite first:** `listVoucherSummaryProjectionFromBrowserDb` → paint lite rows → `setLoading(false)` on dashboard when lite applies (not empty critical-path shortcut).
- **Full merge deferred:** `listCompanyDocsFromBrowserDb("vouchers")` via `requestIdleCallback` + `startTransition` — main thread stays interactive.
- **Dashboard UI:** Footer tabs + shell always clickable after first paint; no blocking skeleton while vouchers hydrate.
- **Background sync:** Firestore/delta voucher updates via `commitVouchersSetter` in `startTransition` — data updates without freezing UI.
- **Other routes:** Same fast-first voucher SQLite loader; non-dashboard routes keep critical/secondary master prefetch split.

### Do not

- Revert to blocking full-page dashboard skeleton while `vouchersLoading`.
- Await full voucher JSON parse before clearing `loading` on `/dashboard`.
- Run heavy voucher merge synchronously on main thread during boot/tab switch.
- Remove `startTransition` from `commitVouchersSetter` for “simplicity” while doing unrelated voucher work.

### If the human explicitly asks to change dashboard boot UX

- Keep the diff minimal and scoped to that request.
- Preserve: instant SQLite paint, background full merge, clickable dashboard during update.

## Admin Panel Company (hard — every AI)

**Any agent working on Admin Panel Company / Admin “Company” menu / admin subscription ledger / future PL Server Gold admin accounting must read this section (and `docs/ADMIN_PANEL_COMPANY_AGENT_RULES.md`, plus `.cursor/rules/admin-panel-company.mdc` when present) before editing.**

### Product intent

- One **Admin Panel Company** ledger for Pocket Ledger’s own books (subscribers as parties, subscription payments as sales, agents/commission, bank/staff/tax/expense).
- **Zero edits** to normal company product code: copy UI into an isolated folder, then edit only the copy.
- Data root: Firestore/Storage **`admin_panel_companies/{tenantId}/…`**, never normal `companies/{id}/…`.
- Future **PL Server Gold**: local host gets its own Admin Panel + Admin Panel Company; platform SuperAdmin email remains the cloud owner. Reserve `tenantId`/`licenseId` shape; do not build Gold install/license unless asked.

### Allowed paths (create / edit here)

- `src/adminPanelCompany/**`
- `src/lib/adminPanelCompany/**`
- `src/lib/adminPanelAccounting/**`
- `src/app/(admin)/admin/company/**` (and Agents→Company entry wiring in admin shell **only as needed**)
- `src/app/api/admin/company/**`
- `.cursor/rules/admin-panel-company.mdc` (this rule)

### Do not

- Edit normal company ledger UI, `useCompany` company flows, or normal `companies/` write paths to “support” Admin Panel Company — **copy instead**.
- Put Admin Panel Company documents under `companies/`.
- Touch frozen Backup / **Attachment preview (portal + full open)** / Online sync / PL Server paths for this feature unless the human explicitly asks for that area.
- Weaken this rule by “sharing” helpers that force changes to normal company modules.

### If the human explicitly asks to change normal company code for Admin Panel Company

- Prefer copy-isolate first; only edit normal company paths if that same message clearly overrides this rule.

## Ledger mode isolation (Online / Local·Drive / PL Server)

**Read `docs/LEDGER_MODE_ARCHITECTURE.md` and `.cursor/rules/ledger-mode-isolation.mdc` before voucher sync, attachment, master save, or write-gateway work.**

- **UI shared** (`src/components/**`) — one Dashboard, one Party ledger, one voucher form per type.
- **Logic split** into `src/lib/ledgerModes/online/`, `localDrive/`, `plServer/` (+ `shared/` for neutral types only).
- **Online companies:** SQLite-first save → outbox flush to Firestore when online; queue when offline; timestamp merge; **delete wins**; attachments promote `local:` → Storage HTTPS before cloud doc write.
- **PL Server / pure local:** frozen product paths stay as-is; new code uses `ledgerModes/plServer/` or `localDrive/` adapters only.
- **Migration rule:** copy mode-specific code out of shared files before editing; never fix online by changing PL Server or Drive internals in the same diff.

Human explicitly requested online attachment/sync fixes (Aug 2026) — that overrides the casual “do not touch online sync” freeze for **attachment pipeline + outbox hydrate + form parity** only, scoped to `ledgerModes/online/` and minimal wiring.

## Pocket Main + Sub server (together)

Owner **Main** (`main-server`, `:8099`) and customer **Sub** (`sub-server`, `:8090`) are two processes. Reuse sub `pb_public` for chrome + `languages.js` + lazy `i18n/*.js`; Main APIs and license/ads keys stay in `main-server`. Rule: `.cursor/rules/pl-main-sub-together.mdc`.

## Parked: Tauri 2 desktop EXE (do not start)

Low-end Electron RAM — later **Tauri 2** (same React UI **inside** the app window / WebView2). See `docs/PARKED_TAURI2_DESKTOP.md` and `.cursor/rules/parked-tauri2-desktop.mdc`. **Do not migrate** unless the human asks in that message. Long chats (~2–3 hours of work): **one short reminder**, not every reply.

## Cursor note

Cursor rules under `.cursor/rules/` should stay aligned with this `AGENTS.md`.
