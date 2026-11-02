# Firebase Master — Pocket Ledger से Firebase हटाकर PocketBase पर ले जाना

अंतिम अपडेट: 2026-11-02 12:30 (Asia/Kathmandu, UTC+5:45)

## 1) उद्देश्य
Pocket Ledger app (`C:\Project xxx\Refference apps\Touri + React`) से Firebase (Firestore, Storage, firebase-admin, बचा हुआ Auth code) पूरी तरह हटाना और सब कुछ PocketBase (Pocket Ledger Server) पर चलाना। Firebase Hosting (marketing website) अभी रहेगी।

## 2) नियम
- कोई भी बदलाव करने से पहले plan + user की हाँ ज़रूरी। पहले backup (`C:\PocketLedger-Backups\`)।
- user की हाँ के बिना git commit/push नहीं।
- Folder names नहीं बदलने।
- Cloudflare/cloudflared files नहीं छूना।
- दूसरी bots की files छूने से पहले user से पूछना:
  - Trxn Table Master: `src\components\vouchers\TransactionsTable.tsx`, `transactionTableShared.tsx`, `src\lib\ledgerUnifiedContentWidth.ts`, `src\lib\ledgerHeaderChrome.ts`, `src\app\globals.css`
  - Theme Master: `appThemes.ts`, `proTheme.ts`, `useTheme.tsx`, `layout.tsx`, `ThemeSettings.tsx`
  - Animation Master: `useAnimationSettings.tsx`, `AnimationSettings.tsx` — AnimationSettingsProvider का सम्मान करें (देखें `_handoff\Animation Master.md` भाग 9)
  - AccountDetails files: `src\components\account\AccountDetails.tsx`, `src\components\bank-cash\AccountDetails.tsx`
- `android\` और `electron\` अभी बंद (TAURI-MIGRATION.md के अनुसार)। android `google-services.json`/gradle plugin अभी नहीं छूना।
- Firebase Hosting अभी रहेगी (`firebase.json` का hosting हिस्सा)।
- काम शुरू करने से पहले `TAURI-MIGRATION.md` और `_handoff\NIYAM.md` पढ़ें।

## 3) Firebase का पूरा नक्शा (हर item के साथ PocketBase विकल्प)
| हिस्सा | अभी कहाँ | PocketBase विकल्प |
|---|---|---|
| Dependencies | `package.json`: `firebase` ^12.8.0, `firebase-admin` ^13.6.0, `@codetrix-studio/capacitor-google-auth` ^3.4.0-rc.4; `pocketbase` npm package **नहीं** है (अपना client `src\lib\pocketbaseData\pbClient.ts`) | अंत में `firebase`, `firebase-admin` हटाना; Google auth plugin का फ़ैसला android के साथ |
| Init/config | `src\lib\firebase.ts` (initializeApp ~46, Firestore ~305-332, getStorage ~337), `src\firebase\*`, `firebaseProjectId.ts`, `FirebaseErrorListener.tsx` | `pbClient.ts` / `pbAppSession.ts` |
| Choke point | `src\lib\pbCompat\{app,firestore,storage}.ts` = `export * from "firebase/..."` (firestore 317 imports, auth 13, app 4, storage 2) | यहीं एक जगह PB implementation लगाना |
| Auth | Firebase Auth पहले से हटा: `pbCompat\auth.ts` stub; Email/password `LoginForm.tsx` ~423/454 → `pocketBaseSignIn`; Google `LoginForm.tsx` ~559-602, `googleFirebaseSignIn.ts` → `pocketBaseGoogleSignIn`। Phone auth नहीं। बचा dead code: `useAuth.tsx`, `firebaseAuthForApi.ts`, `ensureFreshIdToken.ts`, `plFirebaseAuthHandoff.ts`, `PlFirebaseAuthHandoffBootstrap.tsx`, `api\auth\pl-firebase-handoff` | `authWithPassword` / `authWithOAuth2` (server पर Google OAuth provider चाहिए) |
| Firestore | ~500 files, `onSnapshot` 364; बड़े: `voucherActionsClient.ts`, `firestoreMutationsInternal.ts`, `useCompany.tsx`, `useVouchers.tsx`, `localVoucherOutbox.ts`, `recurringVouchers.ts`, `writeGateway\legacy\*`, `interCompany\*`, `fiscalSplit\*Firestore.ts` | `getList/getFullList/getOne`, `create/update/delete`, realtime `subscribe` (`pbRealtime.ts`, `pbReadSeam.ts`), transactions के लिए `/api/pl/data/batch` / server hooks |
| Storage | 125 hits (`uploadBytes/getDownloadURL/deleteObject`): `firebaseStorageDownloadUrl.ts`, `firebaseStoragePaths.ts`, `storage.ts`, `storageClient.ts`, `voucherFormAttachmentSave.ts`, `voucherLocalAttachmentUpload.ts`, `offlineAttachmentUrlCache.ts` आदि | `pl_attachments` / `pl_stored_files` file fields (`pbAttachments.ts`, `pbStorage.ts`) |
| firebase-admin | ~78 files: `src\lib\firebaseAdmin.ts`, ~37 `src\app\api\**` routes (admin, company plan/billing, payments eSewa/Khalti/Stripe, webhooks), `src\lib\server\*`, `payments\*`, `adminPanelAccounting\*`, `adminPanelCompany\*`, `fyPagination\server\*` | PB superuser token / `pb_hooks` custom routes (`pbBillingDb.ts` शुरू) |
| Messaging/Analytics/Functions | इस्तेमाल नहीं | — |
| Config files | `firebase.json` (Hosting रहेगी), `.firebaserc`, `src\firestore.rules`, `src\firestore.indexes.json`, `src\types\firestore.indexes.json`, `src\storage.rules`, `cors.json`, `apphosting.yaml`, `cloudbuild.yaml` | Firestore/Storage हिस्से बाद में हटाना |
| Env (सिर्फ़ नाम) | `NEXT_PUBLIC_FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID/STORAGE_BUCKET/MESSAGING_SENDER_ID/APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_API_KEY`, `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` | PB: `NEXT_PUBLIC_POCKETBASE_URL`, `PL_POCKETBASE_URL` |
| Android | `google-services.json` (root + `android\app`), `android\build.gradle:11` google-services classpath, `android\app\build.gradle:69-74`, `capacitor.config.ts:46-48` GoogleAuth | अभी नहीं छूना (pending) |
| Electron | `/__firebase_blob_proxy` (`localAppServer.js`, `staticAppServer.js`), allowlist `main.js:113-122`; `googleAuthExternal.js` dead code | electron बंद; Tauri sidecar में proxy port न करना पड़े (PB files) |
| Tauri | CSP में Firebase domain नहीं; सिर्फ़ comments/trace | — |
| Scripts | `scripts\pl-migrate-firebase.mjs` (Firestore→PB migration पहले से), `apply-firebase-storage-cors.cjs`, `assert-no-firestore-mutations-outside-gateway.cjs` | migration script दोबारा इस्तेमाल |

## 4) चरण-वार प्लान + checklist
- **चरण 0 — backup + handoff**
  - [x] `_handoff\Firebase Master.md` बनाई (2026-11-01 18:30)
  - [ ] code बदलने से पहले backup `C:\PocketLedger-Backups\`
  - [ ] Server master से PB collections की पुष्टि (Appendix A)
- **चरण 1 — dead Firebase auth code हटाना**
  - [ ] `pbCompat\auth.ts` के callers को PB session पर
  - [ ] `firebaseAuthForApi.ts`, `ensureFreshIdToken.ts`, `plFirebaseAuthHandoff.ts`, `PlFirebaseAuthHandoffBootstrap.tsx`, `api\auth\pl-firebase-handoff` हटाना
  - [ ] `useAuth.tsx` साफ़ करना
- **चरण 2 — Storage**
  - [ ] upload/download/delete → `pl_attachments`/`pl_stored_files`
  - [ ] पुराने Firebase URLs का migration/rewrite
  - [ ] `firebaseStorage*` files हटाना
- **चरण 3 — Firestore (हर collection, `pbCompat\firestore.ts` से)**
  - [ ] companies + members
  - [ ] masters (parties, bank_accounts, staff, items, taxes, expense_accounts, groups)
  - [ ] vouchers + `_pl_change_log` + `_pl_ledger_idem`
  - [ ] बाकी company subcollections (pl_docs)
  - [ ] top-level: users, app_settings, admin_notifications, conversations, inter_company_*, reconciliation_shares, activity_logs, distributor_applications, payments, config
- **चरण 4 — firebase-admin routes**
  - [ ] billing/payments/plan routes → PB superuser / pb_hooks
  - [ ] admin routes
- **चरण 5 — deps/config/env हटाना**
  - [ ] `firebase`, `firebase-admin` packages
  - [ ] Firestore/Storage config (Hosting रखें)
  - [ ] Firebase env names
  - [ ] (user की हाँ पर) android google-services

## 5) बदली/हटाई फ़ाइलें
- `src\lib\plServerFirebaseHitTrace.ts` — header migrate के लिए एक URL का one-shot fetch allowlist
- `src\lib\pocketbaseData\pbAttachments.ts` — `uploadBlobAsPocketBaseAttachment`
- `src\lib\localCompanyDocMirror.ts` — `listCompanyDocRawRowsWithFirebaseUrlHint`
- `src\lib\migrateFirebaseVoucherAttachmentsToPb.ts` — नया (txn Firebase URL → `pbatt:`)
- `src\components\layout\HeaderFirebaseToPbButton.tsx` — नया (header button, auto नहीं)
- `src\components\layout\DesktopAppHeader.tsx` — Sync के पास button

## 6) Backups
- `C:\PocketLedger-Backups\firebase-cut-20261102-1224\`

## 7) Progress log (Asia/Kathmandu, UTC+5:45)
- 2026-11-01 18:11 — read-only scan शुरू।
- 2026-11-01 ~18:20 — scan पूरा, कोई file नहीं बदली (read-only)।
- 2026-11-01 18:30 — user: चरण 0-1 का code काम अभी नहीं; Firebase Hosting रहेगी; schema list Server master को जाएगी; दूसरी bots की files और android का फ़ैसला pending।
- 2026-11-01 18:30 — यह handoff file बनाई (laptop घड़ी 18:30:43)।
- 2026-11-02 12:30 — leftover Firebase Storage URLs on transactions: auto नहीं। Header button (Sync के पास, HardDriveUpload): file एक बार fetch → `pl_attachments` / `pbatt:` → voucher से Firebase URL हटा। सिर्फ़ Firebase URL। PocketBase login + PB company पर दिखे।

## 8) अगला कदम
- Server master से PB collections (Appendix A) बनने + user की हाँ का इंतज़ार।
- Pending सवाल:
  1. दूसरी bots की files (TransactionsTable.tsx, transactionTableShared.tsx, useAnimationSettings.tsx, AccountDetails आदि) में Firebase/pbCompat imports कब और कौन बदलेगा?
  2. android `google-services.json` + gradle plugin + capacitor GoogleAuth — कब हटाना?

---

## Appendix A — PocketBase schema request (Server master के लिए)

Notation: **EXISTS** = PB code में पहले से इस्तेमाल; **NEW** = नया चाहिए। `M(c)` = company member rule:
`@request.auth.id != '' && (c.owner = @request.auth.id || (@collection.pl_company_members.company ?= c && @collection.pl_company_members.user ?= @request.auth.id))`
`SA` = `@request.auth.role = 'SuperAdmin'` (या superuser)। Fields अनुमानित हैं (code usage से)।

### A1. Company data (Firestore `companies/{id}/...` → company relation के साथ)
| Firestore | PB collection | Status | मुख्य fields | Rules (list/view/create/update/delete) | Indexes | Realtime |
|---|---|---|---|---|---|---|
| companies | pl_companies | EXISTS | app_id(text,unique), owner(rel users), ownerEmail, name, data(json), planId, isDeleted(bool), deletedAt, storageLayout, storageRootPrefix, sharedWithEmailsLower(json), handoverTo, icConnectInvitedEmailsLower(json), interCompanyCompanyCode | list/view: M(id) or SA; create: owner=@request.auth.id; update: owner/SA (members सिर्फ़ profile fields — hook); delete: owner/SA | (owner,isDeleted) | हाँ (plc_companies) |
| (sharedWith) | pl_company_members | EXISTS (pbSync में ज़िक्र) | company(rel), user(rel), email, role, permissions(json) | owner/SA लिखे; member पढ़े | (company,user) unique | — |
| vouchers | pl_vouchers | EXISTS | company(rel), app_id, type, date(ms), userId, isDeleted, voucherNumber, data(json) | सब: M(company) or SA | (company,date desc),(company,type,date),(company,isDeleted,date),(company,userId,date),(type,date) | हाँ |
| parties / bank_accounts / staff / items / taxes / expense_accounts | pl_parties / pl_bank_accounts / pl_staff / pl_items / pl_taxes / pl_expense_accounts | EXISTS | company, app_id, name (bank: accountName), groupId, isDeleted, data(json) | M(company) or SA | (company,isDeleted,name) | हाँ |
| groups, account_groups, staff_groups, item_groups, tax_groups, expense_groups | pl_groups (kind) | EXISTS | company, app_id, kind, name, isDeleted, data | M(company) or SA | (company,kind,isDeleted,name) | हाँ |
| unassigned_documents | pl_unassigned_documents | EXISTS | company, app_id, data, file? | M(company) | (company) | हाँ |
| _pl_change_log | pl_change_log | EXISTS | company, coll, docId, op, seq/created, device | list/view/create: M(company); update/delete: none | (company,created) | हाँ (delta topic) |
| _pl_ledger_idem | pl_docs(coll) या NEW pl_ledger_idem | ? | company, key(unique per company) | M(company) | (company,key) unique | नहीं |
| recurring_voucher_templates, recurring_voucher_generation_locks, ledger_statement_checks, inter_company_config, reconciliation_shares (company mirror), quotations, alarms, meta (fyVoucherIndex), fySnapshots, payments (company), ic_connect_invites | pl_docs (coll=<name>) | EXISTS (generic) | company, coll, app_id, data(json), updated | M(company) or SA; ic_connect_invites: invited email भी view; payments: SA list | (company,coll,app_id) unique; alarms: (notified,notifyAt) | हाँ (plc_docs) |
| presence | NEW pl_presence (या PB hook) | NEW | company, user, online, lastSeen | view: M(company); write: user=@request.auth.id | (company,user) | हाँ |
| devices, device_commands, device_history | NEW pl_devices / pl_device_commands / pl_device_history | NEW (migration SKIP करता है) | company, user, deviceId, deviceLabel, lastSeen; command(json) | devices: create/update self, delete owner/SA/self; device_commands: owner/SA या device का user; history: no update | (company,user) | हाँ (kick-out) |
| attachment_registry | NEW pl_attachment_registry (या pl_attachments में refcount) | ? (migration SKIP) | company, fileKey, refCount, voucherIds(json) | M(company) | (company,fileKey) | नहीं |

### A2. Files (Firebase Storage → PB file fields)
| Storage path | PB | Status | नोट |
|---|---|---|---|
| `pocket-ledger/{companyId}/vouchers/{type}/…`, `unassigned/…`, `avatar/{master}/…`, `opening/{master}/…`, `company-logo/…` (+ legacy `{master}/avatar|documents`, `logo`) | pl_attachments (company rel, file field, size, kind/path text) | EXISTS | rules: M(company); अभी Firebase में read public (`true`) है — PB में token-protected (`?token=`) |
| `voucher-files/{companyId}/{type}/…`, `companies/{companyId}/{seg}-files/{avatar|documents}/…`, `companies/{id}/logo`, `restored-files`, `attachments` (legacy) | pl_attachments / pl_stored_files | EXISTS | migration में पुराने URL rewrite |
| path-keyed generic | pl_stored_files (one row per storage path) | EXISTS | — |
| `company-logos/{userId}/…` | pl_stored_files | ? | legacy |
| `public-releases/**` (installers, max 400 MB) | Hosting/website — **अभी Firebase में रहेगा?** | ? | user से पूछना; PB में ले जाएँ तो maxSize ≥ 400 MB |
| size limit | rules में सिर्फ़ public-releases < 400 MB; बाकी कोई limit नहीं | — | सुझाव: attachments maxSize ~25 MB (app compression करती है) — Server master तय करे |

### A3. Top-level collections
| Firestore | PB | Status | fields | Rules | Indexes | Realtime |
|---|---|---|---|---|---|---|
| users | PB `users` auth collection + profile fields (role, displayName, animationSettings(json), online, lastSeen) | EXISTS (auth) / fields ? | — | view/list: signed-in (app display names के लिए); update: self (id/uid बदले नहीं), SA सिर्फ़ role | email unique | हाँ (presence) |
| users/{uid}/transactions, categories | — | पुराना template, शायद dead | — | — | — | — |
| app_settings (plans, features, payment_gateways, admin_config, website_videos …) | pl_udoc / admin docs (`/api/pl/admin/get|set|list`, `/api/pl/udoc/*`) | EXISTS (hooks) | path, data(json) | view: plans/website_videos public, बाकी signed-in; write: SA | path unique | हाँ (pl_udoc topic) |
| config/recycleBin | pl_udoc | EXISTS? | — | signed-in read; write SA (अभी Firebase में सब signed-in) | — | — |
| admin_notifications | NEW pl_notifications | NEW | recipient(rel users), companyId, kind, type, isRead, timestamp, data | create: signed-in; list/view/update/delete: recipient = @request.auth.id | (recipient,timestamp desc),(recipient,companyId,timestamp),(recipient,companyId,isRead),(recipient,companyId,type,isRead),(recipient,kind,isRead) | हाँ |
| conversations + messages | NEW pl_conversations, pl_messages | NEW | conv: participants(rel users multi); msg: conversation(rel), sender, receiver, text, read, deletedFor(json) | conv: participants ?= @request.auth.id; msg create: sender=@request.auth.id; update: receiver या deletedFor; delete: sender | (conversation,created) | हाँ (chat) |
| inter_company_system_names | NEW | NEW | nameKey(unique), systemId, name, ownerUser | list/view signed-in; create owner=self & unique; delete owner; update none | nameKey unique | — |
| inter_company_groups | NEW | NEW | ownerUser, nameKey, name, visibility, companyIds(json), companyOwners(json) | view: owner or visibility='public'; update: owner (public join/leave → hook) | (visibility,nameKey),(visibility,name) | हाँ |
| inter_company_system_join_requests | NEW | NEW | systemId, requesterUser, requesterCompanyId, targetCompanyId, targetOwnerUser, systemOwnerUser, status, requesterLinkApplied | view: requester/systemOwner/targetOwner; create: requester & status=pending; update: status transitions (hook); delete none | (systemId,status),(systemId,requester,status),(targetOwner,status),(requester,status),(requesterCompanyId,status),(targetCompanyId,status) | हाँ |
| inter_company_public_profiles | NEW | NEW | company(rel), code, pan, phone, name | view signed-in; write company owner; delete owner/admin | company unique | — |
| inter_company_public_system_links | NEW | NEW | user, systemId, systemName, ownerUser | view/create/delete: user=self; update none | (user) | — |
| reconciliation_shares (top) | NEW pl_reconciliation_shares | NEW | senderUser, targetUser, receiverUser, senderCompanyId, receiverCompanyId, senderAccountId, rowComments(json), data, createdAt | view: participant या किसी company का member; create sender=self; update participant (company staff सिर्फ़ rowComments); delete sender | (senderUser,created desc),(targetUser,created desc),(receiverUser,created desc) | हाँ |
| activity_logs | NEW | NEW | user, companyId, action, data | create/list signed-in (सुझाव: SA only list); update/delete none | (created) | — |
| distributor_applications | NEW | NEW | user, email, data, status | create signed-in; view own; list SA | (user) | — |
| payments (top, webhook fallback) | billing (server only) | ? | — | सुझाव: superuser only (अभी Firebase में सब signed-in — असुरक्षित) | — | — |
| download_events, ad_wallets | NEW (server-only) | NEW | — | client none; सिर्फ़ superuser/hooks | — | — |

### A4. firebase-admin server routes को क्या चाहिए
- Next.js API routes (~37) और `src\lib\server\*` के लिए PB **superuser token** (env नाम Server master तय करे) या उनकी जगह `pb_hooks` custom routes।
- Billing/plan: plan catalog (app_settings/plans), company planId/expiry/add-ons, owner canonical plan, `pbBillingDb.ts` (शुरू हो चुका)।
- Payments: Stripe (checkout, webhook, sync session), eSewa, Khalti (initiate/complete/webhook), subscription payments, agent commission, addon purchase mirror → NEW `pl_payments` / `pl_subscriptions` (server-only)।
- Admin: company list/details/ledger snapshot/vouchers patch, recycle-bin delete company (+ files), download stats, reward-sync (ad_wallets), plan grant/reconcile।
- FY: fy-closing-snapshot, opening-snapshots-invalidate, paginate vouchers (server-side query over pl_vouchers)।
- MultiServer plan के अनुसार payment webhooks "main" server पर।

### A5. अनिश्चितताएँ
- `pl_company_members` का नाम/fields सिर्फ़ comment से — Server master पुष्टि करे।
- `_pl_ledger_idem`, `attachment_registry`, devices/presence: pl_docs में जाएँ या अलग collection — तय करना।
- Firestore rules में hard-coded super admin emails और `admin_config.superAdminEmails` हैं — PB में role field/superuser से बदलना।
- `users/{uid}/transactions|categories` शायद dead (शुरुआती template)।
- Storage read अभी public है; PB में token-based होगा — पुराने public links टूटेंगे।
- Collection गिनती regex से — variable से बने नाम छूट सकते हैं।