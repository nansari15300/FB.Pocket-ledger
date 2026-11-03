# Animation Master — Pocket Ledger

> यह फ़ाइल handoff के लिए है। कोई भी दूसरा bot (अलग id वाला) इसे पढ़कर Animation का काम वहीं से आगे बढ़ा सकता है।
> Project root: `C:\Project xxx\Refference apps\Touri + React`
> आख़िरी update: 2026-11-02 14:05 (Asia/Kathmandu, NPT)

---

## 1. काम (role)

- **Animation Master** — Pocket Ledger के सारे animations की ज़िम्मेदारी इसी की है।
- सारे animations मौजूदा global animation setting को ही follow करते हैं:
  - UI: **Settings → Animation Settings** (`src/components/settings/AnimationSettings.tsx`)
  - Hook: `src/hooks/useAnimationSettings.tsx`
  - "Off" का मतलब: `settings.rows.enabled === false` (या settings अभी load हो रही हैं)।
- Account list और trxn rows के लिए नियम:
  - **Page बदलने पर (next/prev, rows-per-page) — कोई animation नहीं।**
  - **Sort करने पर — rows slide होकर नई जगह जाएँ।**
  - **Data update (add/edit) पर — row slide होकर नई sorted जगह पर जाए।**
- कोई भी extra suggestion (जैसे नए animation) सिर्फ़ user की "हाँ" के बाद ही लागू करना है।

---

## 2. नियम

1. User से हमेशा **हिंदी देवनागरी** में बात करनी है, **स्त्रीलिंग (feminine) आवाज़** में — जैसे "मैंने कर दिया है", "मैं देख लूँगी"।
2. किसी भी फ़ाइल में बदलाव से पहले user को plan दिखाना है और उनकी **"हाँ"** लेनी है।
3. हर edit से पहले backup लेना है → `.animation-backups\<YYYY-MM-DD>\<वही relative path>`।
4. **कभी commit या push नहीं करना** (git sync अभी hold पर है)। stash / checkout / reset भी नहीं।
5. Folders का नाम नहीं बदलना — गलत spelling वाले नाम (जैसे `Refference apps`) वैसे ही रहेंगे।
6. **Cloudflare, Android, Capacitor, electron, src-tauri** — इनसे जुड़ी किसी फ़ाइल को नहीं छूना।
7. **Trxn Table Master** की फ़ाइलें (बिना पूछे नहीं छूनी):
   - `src/components/vouchers/TransactionsTable.tsx`
   - `src/components/vouchers/transactionTableShared.tsx`
   - `ledgerUnifiedContentWidth.ts`
   - `ledgerHeaderChrome.ts`
   - `transactionColumnVisibility.ts`
   - `globals.css` की lines ~8891–8959
8. **Theme Master** की फ़ाइलें (बिना पूछे नहीं छूनी):
   - `appThemes.ts`, `proTheme.ts`, `useTheme.tsx`, `ThemeSettings.tsx`
   - root `src/app/layout.tsx` का theme script
   - `globals.css` के theme / card वाले हिस्से
9. किसी दूसरे Master की फ़ाइल छूने से पहले user से पूछना ज़रूरी है।
10. Conflict से बचने के लिए `TAURI-MIGRATION.md` पढ़ लेना।
11. सबके लिए common नियम: `_handoff\NIYAM.md`।
12. Approval के बिना कुछ भी install नहीं करना (कोई package नहीं)।
13. **Firebase app से हटाया जा रहा है (सिर्फ़ PocketBase रहेगा)।** कोई नया Firebase code नहीं जोड़ना; Firebase से जुड़ी कोई भी बात **Firebase Master** को report करनी है।
14. git: `C:\Program Files\Git\cmd\git.exe` — सिर्फ़ read-only commands, हमेशा `--no-optional-locks` के साथ।
15. हर बदलाव के बाद यह `.md` फ़ाइल update करनी है।

### काम करने के tips (इस machine पर)
- Node PATH पर नहीं है → `C:\Program Files\nodejs\node.exe` पूरा path इस्तेमाल करें।
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json`
- `rg` installed नहीं है → PowerShell `Select-String` इस्तेमाल करें।
- फ़ाइलें LF line endings और UTF-8 (बिना BOM) में हैं। लिखने के लिए:
  `[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))`
- Edit से ठीक पहले फ़ाइल दोबारा पढ़ें (दूसरों के uncommitted बदलाव बचाने के लिए)।

---

## 3. नई/बदली फ़ाइलें (Phase 2, 2026-11-01)

### नई फ़ाइलें
| फ़ाइल | काम |
|---|---|
| `src/components/providers/AnimationSettingsProvider.tsx` | Settings एक बार load करके `AnimationSettingsContext` देता है; `MotionConfig reducedMotion` लगाता है; `<html data-pl-animations="on/off">` set करता है; `animation-gate.css` import करता है। |
| `src/styles/animation-gate.css` | Off होने पर सारे CSS animations/transitions 0.01ms (`.animate-spin` छोड़कर); 1s row highlight (`.pl-row-change-highlight`) की keyframes। |
| `src/hooks/useLedgerRowMotionGate.ts` | Ledger में page बदलने पर layout animation रोकता है (`{suppress}`), rows render होने के 2 rAF बाद (या 1500ms safety timeout पर) छोड़ देता है। Refs नहीं। |
| `src/hooks/useRowChangeHighlight.ts` | Add/edit हुई rows को ~1s tint देता है; first load, reset, disabled और bulk changes (> max(3, 25%)) पर skip। |

### बदली फ़ाइलें
| फ़ाइल | बदलाव |
|---|---|
| `src/hooks/useAnimationSettings.tsx` | `AnimationSettings` / `AnimationSettingsState` types, `AnimationSettingsContext`, `useAnimationSettingsSource({disabled})` जोड़ा; `useAnimationSettings()` अब context हो तो उसी से पढ़ता है। |
| `src/app/(dashboard)/layout.tsx` | `<AnimationSettingsProvider>` mount (DashboardProvider के अंदर, FileHoverPreviewProvider के बाहर)। Root layout नहीं छुआ। |
| `src/components/bank-cash/AccountDetails.tsx` | Ledger row gate; हमेशा-on `disableLayoutAnimation` हटाकर `disableLayoutAnimation={ledgerRowGate.suppress}` — अब sort और add/edit पर slide होता है, page change पर नहीं। |
| `src/components/account/AccountDetails.tsx` | Ledger row gate (`currentPage|rowsPerPage`), `disableLayoutAnimation` prop दोनों tables पर। |
| `src/components/bank-cash/AccountGroupDetails.tsx` | Ledger row gate; `disableTableLayoutAnimation \|\| ledgerRowGate.suppress`। |
| `src/components/dashboard/DashboardPage.tsx` | BankCashSummary की rows अब `useMasterListRowMotion()` से global setting/duration follow करती हैं। |
| `src/components/dashboard/DashboardWelcomeFooterBanner.tsx` | Setting off होने पर banner animation नहीं (`initial=false`, duration 0)। |
| `src/components/bank-cash/AccountList.tsx` | `useRowChangeHighlight` — add/edit पर 1s highlight। |
| `src/components/party/PartyList.tsx` | वही 1s highlight। |
| `src/components/expenses/ExpenseAccountList.tsx` | वही 1s highlight। |
| `src/components/items/ItemList.tsx` | वही 1s highlight। |
| `src/components/staff/StaffList.tsx` | वही 1s highlight। |
| `src/components/tax/TaxList.tsx` | वही 1s highlight। |
| `src/components/payee/PayeeList.tsx` | वही 1s highlight (id = `${type}-${id}`)। |
| `src/modules/loans/components/LoanAccountList.tsx` | वही 1s highlight। |

### नहीं बदली (जानबूझकर)
- `src/hooks/useMasterListRowMotion.ts` — इसके पास row data नहीं है।
- `src/app/(dashboard)/reports/accounts-statement/page.tsx` — `rowAnimationDuration` (lines 252–253) off होने पर पहले से 0 है।

### फ़ैसला: `reducedMotion="never"`
- `MotionConfig reducedMotion={animationsOn ? "never" : "always"}`।
- मतलब: app की अपनी Animation Setting ही अंतिम है। Setting **on** हो तो OS का "reduce motion" ignore होता है; **off** (या loading) हो तो सब framer-motion animations instant।
- User ने "OS reduced-motion को default मानो" वाला suggestion **approve नहीं** किया, इसलिए यही रखा गया।

---

## 4. Backups

- Folder: `C:\Project xxx\Refference apps\Touri + React\.animation-backups\2026-11-01\`
- हर फ़ाइल वहीं उसी relative path पर है (hash से verify किया गया)। कुल 15 फ़ाइलें:
  1. `src/hooks/useAnimationSettings.tsx`
  2. `src/app/(dashboard)/layout.tsx`
  3. `src/components/bank-cash/AccountDetails.tsx`
  4. `src/components/account/AccountDetails.tsx`
  5. `src/components/bank-cash/AccountGroupDetails.tsx`
  6. `src/components/dashboard/DashboardPage.tsx`
  7. `src/components/dashboard/DashboardWelcomeFooterBanner.tsx`
  8. `src/components/bank-cash/AccountList.tsx`
  9. `src/components/party/PartyList.tsx`
  10. `src/components/expenses/ExpenseAccountList.tsx`
  11. `src/components/items/ItemList.tsx`
  12. `src/components/staff/StaffList.tsx`
  13. `src/components/tax/TaxList.tsx`
  14. `src/components/payee/PayeeList.tsx`
  15. `src/modules/loans/components/LoanAccountList.tsx`
- नई 4 फ़ाइलों का backup नहीं है (वे पहले थीं ही नहीं) — rollback = उन्हें हटाना + ऊपर की 15 फ़ाइलें restore करना।
- Trxn Table Master का अपना backup: `C:\Project xxx\backup-trxn-anim-20261101-1735\`

---

## 5. Checklist

- [x] Audit (read-only)
- [x] Steps 1–4 (global provider + CSS gate, ledger page-change gate, dashboard summary/banner setting follow)
- [x] Master lists पर 1s highlight (8 lists)
- [x] Trxn Table Master ने 6 में से 5 trxn fixes किए: exit 0, fallback 2.5, spend-wise layout gate, key से `tableTransactions.length` हटाया, mobile keys ID से। (उनका backup: `C:\Project xxx\backup-trxn-anim-20261101-1735\`)
- [x] FY divider transition — **rejected, user ने खुद किया** (2026-11-02)
- [x] Ledger transaction rows का highlight — **rejected, user ने खुद किया** (2026-11-02)। पुराना change request (सिर्फ़ record के लिए, अब लागू नहीं):
  1. `MainRow` / `NarrationRow` पर `rowClassName` prop (transactionTableShared.tsx — Trxn Table Master)
  2. `TransactionsTable` पर `highlightRowIds` prop (TransactionsTable.tsx — Trxn Table Master)
  3. फिर 3 ledger फ़ाइलों (bank-cash/AccountDetails, account/AccountDetails, bank-cash/AccountGroupDetails) में `useRowChangeHighlight` — Animation Master
- [x] Manual browser testing — **rejected, user ने खुद किया** (2026-11-02)

---

## 6. Progress log (Asia/Kathmandu)

| समय | क्या हुआ |
|---|---|
| 2026-11-01 17:16 | काम शुरू / audit |
| 2026-11-01 17:23 | Audit पूरा, plan भेजा |
| 2026-11-01 17:31 | User ने steps 1–4 + सिर्फ़ row highlight approve किया (reduced-motion default, sort-arrow, expand/collapse नहीं); 6 trxn fixes Trxn Table Master करेंगे |
| 2026-11-01 ~17:48 | Steps 1–4 + highlight पूरे, tsc pass, eslint में कोई नई problem नहीं |
| 2026-11-01 18:12 | यह handoff फ़ाइल बनाई; `useAnimationSettings` का backend (Firebase/PocketBase) read-only जाँचा — नीचे section 9 |
| 2026-11-02 14:05 | user ने सभी रुके हुए काम reject करवाए और खुद manually कर दिए, कोई नया बदलाव नहीं। Read-only जाँच: 4 नई + 15 बदली फ़ाइलें ठीक (कोई आधा edit नहीं, backup से diff सिर्फ़ intended edits, 2026-11-01 के बाद कोई बदलाव नहीं); `tsc --noEmit --incremental false -p tsconfig.typecheck.json` exit 0, कोई error नहीं। |

---

## 7. Test steps (manual, browser में)

1. **Setting off** (Settings → Animation Settings → rows off): कुछ भी हिलना नहीं चाहिए, overlays तुरंत खुलें, कोई highlight नहीं, और DevTools में `<html data-pl-animations="off">` दिखे।
2. **Page next/prev और rows-per-page बदलना:** कोई slide नहीं।
3. **Sort:** rows slide होकर नई जगह जाएँ।
4. **Add/edit:** row slide होकर sorted जगह पर जाए + master lists पर 1s tint। First load, search या sort पर tint **नहीं** आना चाहिए।
5. **Bank/cash ledger:** अब sort और add/edit पर slide होता है, लेकिन page change या Spend-wise toggle पर नहीं।
6. **दूसरे tab में setting बदलें:** इस tab में live लागू हो।
7. **Dashboard bank/cash summary:** setting (on/off) और duration follow करे।

---

## 8. अगला कदम

कोई काम बाकी नहीं, नया काम user की हाँ से ही।

---

## 9. Backend जाँच: `useAnimationSettings` users doc (read-only, 2026-11-01 18:12)

**नतीजा: Hybrid / seam के ज़रिए।** Hook सीधे Firebase call नहीं करता, पर अभी भी Firebase SDK पर टिका है:
- **PocketBase app session active हो** (Pocket Ledger Server login) → `users/{id}` का read और write दोनों **PocketBase server** पर जाते हैं।
- **PocketBase session न हो** (Firebase login) → read और write सीधे **Firestore** पर जाते हैं।

### Read — `src/hooks/useAnimationSettings.tsx`
- L4: `import { doc } from "@/lib/pbCompat/firestore";`
- L5: `import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";`
- L6: `import { firestore } from "@/lib/firebase";`
- L105: `const userDocRef = doc(firestore, "users", userDocId);`
- L106–133: `onSnapshot(userDocRef, …)` → `animationSettings` field पढ़ता है; error/missing पर localStorage fallback।
- L75–77, L89–96: `useLocalAnimationOnly` (shared user जिसके पास company settings permission नहीं) → सिर्फ़ localStorage (`pocket-ledger-animation-local:<userDocId>`, L30–32), कोई server नहीं।
- Hook खुद कुछ write नहीं करता।

### Write — `src/components/settings/AnimationSettings.tsx`
- L4: `import { updateDoc } from "@/lib/writeGateway/pbWrites";`
- L15–17: `doc` (pbCompat/firestore), `getDoc` (pbReadSeam), `firestore` (lib/firebase)
- L109–110: `getDoc(doc(firestore, "users", userDocId))` — initial load
- L187–189: `updateDoc(doc(firestore, "users", userDocId), { animationSettings: data })`

### Routing कहाँ होती है
- `src/lib/pbCompat/firestore.ts` L6: `export * from "firebase/firestore";` → `doc` और `firestore` ref **Firebase SDK** के हैं।
- `src/lib/firebase.ts` L7–13: `getFirestore` / `initializeFirestore` उसी pbCompat/firestore (Firebase SDK) से।
- `src/lib/pocketbaseData/pbReadSeam.ts`:
  - L1–16: header — "Firebase companies (and every non-company path): the call goes straight to Firestore"।
  - L1067–1075: `onSnapshot` — `users/...` company path नहीं है, तो `adminTargetOf()` (L657) देखा जाता है; mode मिला तो `onAdminSnapshot` (L896, server), वरना L1075 `fsOnSnapshot` (Firestore)।
  - L606–614: `globalModeFor()` — `isPocketBaseAppSessionActive()` false हो तो `null` (→ Firestore); true हो और root `USER_GLOBAL_ROOTS` में हो तो `"user"` (→ server)।
- `src/lib/pocketbaseData/pbGlobalDocs.ts`:
  - L13–14: `USER_GLOBAL_ROOTS = new Set(["users", "app_settings", "config", "payments", …])`
  - L40–49: `udocDocPath()` — PocketBase session न हो तो `null`।
  - L80: `udocCommit()` (server write)।
- `src/lib/writeGateway/pbWrites.ts` L8: `updateDoc` → `./firestoreMutationsInternal`।
- `src/lib/writeGateway/firestoreMutationsInternal.ts` L249–271: `updateDoc` — L250–253 `udocDocPath` मिला तो `udocCommit` (PocketBase); `users/...` के लिए बाकी branches लागू नहीं, तो L266 `firestoreUpdateDoc` (Firestore)।

### Firebase Master के लिए (report करना है, Animation Master कुछ नहीं बदलेगी)
- Firebase हटाने पर ये बचे हुए Firebase हिस्से migrate करने होंगे: `doc(firestore, "users", …)` ref बनाना (Firebase SDK), non-PocketBase session में `fsOnSnapshot` / `firestoreUpdateDoc` fallback।
- यह shared seam (`pbReadSeam`, `firestoreMutationsInternal`, `pbGlobalDocs`) का मामला है — Animation की फ़ाइलों में कोई नया Firebase code नहीं जोड़ा गया।
