# HR Module Master

HR module (Employees / Attendance / Leaves / Payroll) — Pocket Ledger के अंदर अलग, plan-gated module।
Worktree: `C:\Project ERP\Refference apps\Touri-HR` (branch `feature/hr-module`)। (पुराना नाम `C:\Project xxx` था — folder rename हो गया, अब हर जगह `C:\Project ERP`।)

> **ज़रूरी (2026-11-03 17:34 NPT से):** user ने आदेश दिया कि **HR का सारा काम सिर्फ़ laptop (DESKTOP-M4HAJE9) पर** होगा। **`D:\Touri-HR` (ServerWin10) को edit नहीं करना है।** नीचे का पुराना "PC बँटवारा" अब रद्द है — सिर्फ़ इतिहास के लिए रखा है।

## डेटा मॉडल (2026-11-03 rework)

- **Employee = staff ledger।** HR की अलग employees table नहीं। `useHrEmployees` सीधे company के `staff` से list बनाता है; employee का id = staff id (`app_id` = `staff_app_id`)।
- HR fields staff document में **`staff.hr`** (type `StaffHrFields`: `designation`, `department`, `joining_date`, `status` `active|left`, `salary_type` `monthly|daily`, `base_salary`, `updatedAtMs`) में रहते हैं। `src/components/staff/types.ts` में सिर्फ़ एक optional field `hr?: StaffHrFields` जोड़ा।
- HR fields लिखना: `writeStaffHrFields` (`src/modules/hr/services/hrStaffWrite.ts`) — सिर्फ़ `staff.hr` बदलता है (नाम/phone/email नहीं)। Local SQLite mirror हो तो `upsertCompanyDocInBrowserDb` + `enqueueCompanyDocOutbox("update")`; वरना `persistMasterEntityUpdate` (`{ hr, updatedAt }`)। फिर `patchMasterEntity("staff", id, { hr })` + HR overlay event (क्योंकि vouchers context का fingerprint `hr` को नहीं देखता)।
- "Remove" = `staff.hr.status = "left"` (staff delete नहीं होता)।
- **"Type not set" नियम:** staff जो loan liability नहीं है (`isLoanLiabilityStaff` false), जिसका `isLoanAccount` boolean नहीं है, और जिसकी group chain `staff_system` तक नहीं पहुँचती — वह "Type not set" में दिखता है (Employees page पर collapsible section, हर row पर "Edit staff" बटन)। ऐसे staff attendance / leaves / payroll में नहीं आते। Loan staff कभी employee नहीं।
- **Attendance / Leaves / Payroll** PocketBase `pl_docs` में, collections `hr_attendance` / `hr_leaves` / `hr_payroll` (`pbTargetForAppCollection` इन्हें `pl_docs` पर map करता है)। Loans module वाला pattern (`writeLoanEntity` जैसा): browser DB (`listCompanyDocsFromBrowserDb`, `getCompanyDocFromBrowserDb`, `upsertCompanyDocInBrowserDb`) + outbox (`enqueueCompanyDocOutbox`) + `assertPlServerStaffWriteAllowed`। Wrapper: `src/modules/hr/services/hrDocs.ts` → `listHrDocs`, `getHrDoc`, `writeHrDocs`, `subscribeHrDocs`, `newHrDocId`।
- IDs: attendance `att_<staffId>_<YYYY-MM-DD>`, payroll `pay_<staffId>_<YYYY-MM>`, leave `lv_…` (`newHrDocId("lv")`)।
- Leave decide client पर: `status`, `decided_by` (displayName / email / uid), `decided_at` (ms)।
- Payroll post: पहले `saveVoucher` (Add Salary, Dr चुना हुआ salary expense, **Cr = staff id**), फिर `pl_docs` record update → `status: "posted"`, `voucher_app_id`, `voucher_number`, `posted_at`।
- `hrApi.ts` (`/api/pl/hr/*`) अब **FUTURE** — HR UI इसे call नहीं करता।

## Privacy caveat (2026-11-03 को user ने स्वीकार किया)

- `pl_docs` में HR records (salary, attendance, leaves) company के उन सभी users को sync हो सकते हैं जिनके पास company data है — अलग permission-based server filtering अभी नहीं। UI में `HrGate` + HR permissions से ही छिपाया जाता है।
- यह जोखिम user ने 3 Nov 2026 को स्वीकार किया। बाद में **`pl_hr` server routes** (Server Master) से सख़्त access बनेगा।

## User के नियम (rework brief, 2026-11-03)

- सिर्फ़ worktree `C:\Project ERP\Refference apps\Touri-HR` में edit; main `Touri + React`, `C:\Project xxx`, ServerWin10 / `D:\Touri-HR`, किसी server को नहीं छूना।
- Git state बदलने वाली कोई command नहीं; सिर्फ़ `git --no-optional-locks status/diff`। npm install नहीं। Dev preview :2100 start/stop नहीं।
- हर मौजूदा file बदलने से पहले backup `C:\PocketLedger-Backups\HR\<yyyyMMdd-HHmmss>\` में। Edit से पहले file दोबारा पढ़ें, user के बदलाव overwrite न करें।
- UTF-8 बिना BOM, CRLF। Firebase code नहीं — सिर्फ़ PocketBase (app का data layer)।
- Shared files में सिर्फ़ `src/components/staff/types.ts` (एक field `hr?`)। बाक़ी shared (ui/*, globals.css, tailwind config, staff dialogs, useVouchers, writeGateway, loans, AppSidebar, permissions, plans) नहीं — ज़रूरत हो तो proposal।
- UI strings सिर्फ़ English; help वाक्यों पर `data-pl-intro`। Theme tokens (shared Card, muted empty states, destructive Alert); palette classes (`bg-red-500` आदि) नहीं; lines ज़्यादा से ज़्यादा 1px, theme रंग की।

## PC बँटवारा (PC split) — 2026-11-03 से (**रद्द, 17:34 NPT से** — ऊपर देखें)

| PC | Worktree | काम | कहाँ लिख सकता है |
|---|---|---|---|
| **Laptop** DESKTOP-M4HAJE9 | `C:\Project ERP\Refference apps\Touri-HR` | (c) Leaves + **सारी shared HR files** (types, hrApi, hooks, utils, HrGate, HrHomePage, barrels, routes, plans/permissions, यह handoff file) | पूरा Touri-HR worktree (नियम ऊपर/नीचे वाले), backups `C:\PocketLedger-Backups\HR\` |
| **ServerWin10** | `D:\Touri-HR` | (d) Payroll + (e) Salary slip | **सिर्फ़** `src/modules/hr/payroll/**` और `src/app/(dashboard)/hr/payroll/**` — write-only |

- ServerWin10 पर **dev server / `tsc` नहीं** चलाना। Payroll का test **laptop** पर होगा, Git Master के sync के बाद (preview :2100)।
- ServerWin10 के backups **सिर्फ़ `D:`** पर (जैसे `D:\PocketLedger-Backups\HR\<yyyyMMdd-HHmmss>\`)।
- Laptop bot `src/modules/hr/payroll/**` और `src/app/(dashboard)/hr/payroll/**` को **कभी न बनाए / न बदले**।
- ServerWin10 bot shared files (types.ts, hrApi.ts, index.ts, pages/index.ts, HrHomePage.tsx, यह file) **न बदले** — ज़रूरत हो तो इसी file के "अगला कदम" में note लिखवाए / laptop से माँगे; laptop bot जोड़ेगा (जैसे barrel export, HrHomePage पर Payroll card active करना)।
- दोनों PCs पर git सिर्फ़ **Git Master** चलाएगा।

## नियम

1. काम सिर्फ़ **Touri-HR** worktree में। `Touri + React` (main, auto-synced) को कभी न छुएँ।
2. किसी भी मौजूदा file को बदलने से **पहले backup**: `C:\PocketLedger-Backups\HR\<yyyyMMdd-HHmmss>\` में, relative path वैसा ही रखें। नई files का backup ज़रूरी नहीं, पर सूची log में लिखें।
3. **Git मैं नहीं चलाता** — add / commit / push / checkout / stash / branch सब **Git Master** करेगा। सिर्फ़ read-only `git --no-optional-locks status` / `diff` चल सकता है।
4. **Firebase नहीं** — HR में कोई Firebase import नहीं। सिर्फ़ PocketBase, app के मौजूदा data layer से (staff write path + `pl_docs` browser DB / outbox; ऊपर "डेटा मॉडल")।
5. **Server हिस्सा** (`/api/pl/hr/*` = `pl_hr` routes, plan check) **Server Master** बनाएगा — user की "हाँ" के बाद ही। **2026-11-03 17:34 NPT से user का आदेश: HR का सारा काम सिर्फ़ laptop पर; `D:\Touri-HR` (ServerWin10) को edit नहीं करना।**
6. **Sidebar** (`src/components/layout/AppSidebar.tsx`) हम edit नहीं करते — proposed diff **Theme Master** देखेगा और लगाएगा। `globals.css` भी नहीं छूते; styles module के अंदर Tailwind / theme variables से।
7. User के हाथ से किए गए बदलाव **overwrite न करें** — edit से पहले file पढ़ें, सिर्फ़ ज़रूरी हिस्सा बदलें।
8. Folder के नाम **वैसे ही** रहें (कोई rename / move नहीं)।
9. Files UTF-8 (बिना BOM), CRLF line endings (repo जैसा)।
10. npm install / ci नहीं; dev server (HR preview :2100) start/stop नहीं।
11. दूसरे bots की files नहीं: TransactionsTable/transaction*, theme files, AnimationSettings, firebase files, `src/app/api/**`, `src-tauri`।

## नक्शा (files map)

| File | काम |
|---|---|
| `src/modules/hr/types.ts` | `StaffHrFields` + HrEmployee (name/phone/email सहित) / HrAttendance / HrLeave / HrPayroll (`voucher_number`, `posted_at`) |
| `src/components/staff/types.ts` (shared) | सिर्फ़ `hr?: StaffHrFields` जोड़ा |
| `src/modules/hr/services/hrDocs.ts` | `pl_docs` (`hr_attendance` / `hr_leaves` / `hr_payroll`) read/write: `listHrDocs`, `getHrDoc`, `writeHrDocs`, `subscribeHrDocs`, `newHrDocId` |
| `src/modules/hr/services/hrStaffWrite.ts` | `writeStaffHrFields` (सिर्फ़ `staff.hr`), HR overlay event |
| `src/modules/hr/services/hrApi.ts` | **FUTURE** — `/api/pl/hr/*` typed client; HR UI इसे call नहीं करता |
| `src/modules/hr/hooks/useHrEmployees.ts` | staff से employees + `typeUnsure` (`classifyStaffForHr`), `upsertEmployee` / `removeEmployee` |
| `src/modules/hr/components/HrTable.tsx` | 1px theme lines वाली table (global काली/3px table CSS को override) |
| `src/modules/hr/components/HrEditStaffDialog.tsx` | shared `EditStaffDialog` का controlled wrapper |
| `src/app/(dashboard)/hr/hrTailwindClasses.ts` | Tailwind anchor — `src/modules/**` scan नहीं होता, इसलिए HR-only classes यहाँ |
| `src/modules/hr/utils/employeeDefaults.ts` | staff.salary / salaryPeriod से prefill, आज की तारीख |
| `src/modules/hr/utils/attendance.ts` | status labels/codes, deterministic `att_<employee>_<date>` app_id, month range, latest-per-day |
| `src/modules/hr/hooks/useHrAttendance.ts` | date range / employee से attendance list + bulk upsert (`saveMarks`) |
| `src/modules/hr/pages/AttendancePage.tsx` | Daily (status buttons + note, mark all present, Save) + Monthly grid (employee × day, counts) |
| `src/app/(dashboard)/hr/attendance/page.tsx` | route `/hr/attendance` (HrGate + next/dynamic) |
| `src/modules/hr/utils/leaves.ts` | leave types/labels, `leaveDayCount` (inclusive), overlap, `approvedLeaveOn(leaves, employee, date)` |
| `src/modules/hr/hooks/useHrLeaves.ts` | leaves list (server पर सिर्फ़ `employee` filter; from/to overlap + status client-side) + `createRequest` (pending) + `decide` (`/leaves/decide`) |
| `src/modules/hr/pages/LeavesPage.tsx` | Pending / All tabs, "New leave request" form (validation, दिन गिनती, overlap रोक), Approve/Reject (सिर्फ़ `canApproveLeave`) |
| `src/app/(dashboard)/hr/leaves/page.tsx` | route `/hr/leaves` (HrGate + next/dynamic) |
| `src/modules/hr/components/HrGate.tsx` | plan + permission gate ("HR आपके plan में उपलब्ध नहीं है") |
| `src/modules/hr/pages/HrHomePage.tsx` | HR home (Employees / Attendance / Leaves active; Payroll "जल्द आ रहा है" — Payroll card laptop bot active करेगा) |
| `src/modules/hr/pages/EmployeesPage.tsx` | Staff-employees list; "Add employee" = shared `CreateStaffDialog` → `/hr/employees/<newId>`; "Type not set" section |
| `src/modules/hr/pages/EmployeeDetailsPage.tsx` | HR fields edit; नाम/contact read-only + "Edit staff details" (`EditStaffDialog`); "Mark as left"; `new` → list पर redirect |
| `src/modules/hr/pages/index.ts`, `src/modules/hr/index.ts` | barrel exports |
| `src/hooks/useHrModuleFeature.ts` | company override → plan `hrModuleEnabled` → AND `can('hr_view')`; SuperAdmin pass |
| `src/app/(dashboard)/hr/page.tsx` | route `/hr` |
| `src/app/(dashboard)/hr/employees/page.tsx` | route `/hr/employees` |
| `src/app/(dashboard)/hr/employees/[id]/page.tsx` + `EmployeeIdRouteClient.tsx` | route `/hr/employees/<id>` (static export: `__placeholder__` + `new`) |
| `src/config/plans.ts` (shared) | `hrModuleEnabled` entitlement — basic=false, advance/pro/pro-plus=true |
| `src/lib/permissions.ts` (shared) | `hr_view`, `hr_manage`, `hr_attendance`, `hr_leave_approve`, `hr_payroll` + "HR" group (सबसे आख़िर में) |
| `src/hooks/useCachedFeatureConfig.ts` (shared) | offline default `hr: true` |
| `src/modules/hr/payroll/**` | (d) Payroll (`useHrPayroll`, `PayrollPage`) + (e) slip (`SalarySlipPage`) — 17:34 NPT से **laptop** पर |
| `src/app/(dashboard)/hr/payroll/**` | routes `/hr/payroll`, `/hr/payroll/slip/<id>` |
| `src/components/layout/AppSidebar.tsx` (shared) | `hr` menu item (Briefcase, `permission: "hr_view"`) — Theme Master की मंज़ूरी से लगाया; plan-based hiding अभी नहीं |

## Checklist — v1 features

- [x] Foundation: types, hrApi, useHrModuleFeature, HrGate, plan entitlement, permissions, feature config
- [ ] (a) Employee profile — UI बन गया (list / add / edit / remove); **server routes बाक़ी** (Server Master)
- [ ] (b) Attendance — UI बन गया (daily mark + bulk save, monthly grid); **server routes बाक़ी** (Server Master)
- [ ] (c) Leaves — UI पूरा (commit `09fa15b5`; 2026-11-03 review ✓: request form, Pending/All, approve/reject, attendance में approved leave prefill + monthly legend); **server routes बाक़ी** (Server Master) — **Laptop**
- [x] (r) 2026-11-03 rework: employees = staff (`staff.hr`), attendance/leaves/payroll `pl_docs` में, English UI, theme tokens, 1px lines — **browser test बाक़ी**
- [ ] (d) Payroll — UI + `pl_docs` + voucher post (laptop) — **browser test बाक़ी**
- [ ] (e) Salary slip — UI + print/PDF (laptop) — **browser test बाक़ी**
- [x] (e1) Sidebar menu item `hr` (2026-11-02, Theme Master approved)
- [ ] (e2) Admin plan editor में HR toggle; sidebar में plan-based hiding (user के फ़ैसले के बाद)

## प्रगति लॉग (progress log)

- **2026-11-02 15:30 (NPT, UTC+5:45)** — Backup: `C:\PocketLedger-Backups\HR\20261102-153001\` → `src\config\plans.ts`, `src\lib\permissions.ts`, `src\hooks\useCachedFeatureConfig.ts`।
- **2026-11-02 15:31 (NPT)** — Shared edits: plans.ts (`hrModuleEnabled`), permissions.ts (5 HR permissions + HR group), useCachedFeatureConfig.ts (`hr: true`)। `public/plans-seed-raw.json` सिर्फ़ `{}` है — बदलाव की ज़रूरत नहीं।
- **2026-11-02 15:32–15:36 (NPT)** — नई files: types, hrApi, useHrModuleFeature, HrGate, useHrEmployees, employeeDefaults, HrHomePage, EmployeesPage, EmployeeDetailsPage, routes `/hr`, `/hr/employees`, `/hr/employees/[id]`।
- **2026-11-02 15:36 (NPT)** — `npx tsc --noEmit -p .` → 0 errors। Preview :2100 पर `/app/hr`, `/app/hr/employees`, `/app/hr/employees/new` → HTTP 200।
- **2026-11-02 15:38 (NPT)** — Sidebar proposed diff बनाया (AppSidebar.tsx को छुआ नहीं)।
- **2026-11-02 15:40 (NPT)** — Backup `C:\PocketLedger-Backups\HR\20261102-154003\src\components\layout\AppSidebar.tsx`; Theme Master की मंज़ूरी से sidebar diff लगाया (Briefcase import + `hr` item, `permission: "hr_view"`)। tsc → 0 errors।
- **2026-11-02 15:42 (NPT)** — जाँच: `useCompany().companyId` = `pl_companies.app_id` (PB record id नहीं)। Server `sub-server/pb_hooks/lib/data_api.js`: `findFirstRecordByFilter("pl_companies", "app_id = {:a}", { a: body.company })`; app `ensurePocketBaseCompany(appCompanyId)` भी `app_id = …` से ढूँढता है। HR routes को भी यही करना है।
- **2026-11-02 15:46 (NPT)** — Backup `C:\PocketLedger-Backups\HR\20261102-154605\` → `src\modules\hr\pages\HrHomePage.tsx`, `src\modules\hr\pages\index.ts`, `src\modules\hr\index.ts`, `_handoff\HR Module Master.md`।
- **2026-11-02 15:43–15:47 (NPT)** — (b) Attendance: नई files `utils/attendance.ts`, `hooks/useHrAttendance.ts`, `pages/AttendancePage.tsx`, route `/hr/attendance`; HrHomePage पर Attendance card active; barrels में exports। `usePermissions.tsx` role defaults **नहीं** बदले (user का फ़ैसला)। tsc → 0 errors; preview `/app/hr/attendance` → 200।
- **2026-11-02 15:49 (NPT)** — Backup `C:\PocketLedger-Backups\HR\20261102-154937\` → `src\modules\hr\pages\AttendancePage.tsx`, `src\modules\hr\pages\HrHomePage.tsx`, `src\modules\hr\pages\index.ts`, `src\modules\hr\index.ts`, `_handoff\HR Module Master.md`।
- **2026-11-02 15:50–16:05 (NPT)** — (c) Leaves: नई files `utils/leaves.ts`, `hooks/useHrLeaves.ts`, `pages/LeavesPage.tsx`, route `/hr/leaves`; HrHomePage पर Leaves card active; barrels में exports। Request बनाना सिर्फ़ `canManage || canAttendance`, Approve/Reject सिर्फ़ `canApproveLeave`; बाक़ी read-only। v1 में request edit/cancel नहीं; `decided_by` raw id दिखता है।
- **2026-11-02 16:05 (NPT)** — Attendance integration: Daily view में approved leave + कोई saved record नहीं → status `leave` prefill (नीले italic note के साथ, Save ज़रूरी; save पर `data.leave_app_id`); "Mark all present" ऐसी rows छोड़ देता है। Monthly grid में ऐसे दिन हल्का italic "L" (counts में नहीं) + legend। tsc → 0 errors।
- **2026-11-03 16:21 (NPT)** — Git Master ने `09fa15b5` ("HR module: employees + attendance") commit किया; इसमें (a)+(b)+(c) Leaves की सारी files पहले से हैं (`utils/leaves.ts`, `hooks/useHrLeaves.ts`, `pages/LeavesPage.tsx`, route `/hr/leaves`, attendance integration, HrHomePage Leaves card, barrels)। Working tree clean।
- **2026-11-03 16:22 (NPT)** — (c) Leaves review (laptop): दोबारा नहीं बनाया, spec से मिलाया — सब मौजूद, कोई code बदलाव ज़रूरी नहीं। Backup `C:\PocketLedger-Backups\HR\20261103-162224\` → `_handoff\HR Module Master.md`।
- **2026-11-03 16:23 (NPT)** — `npx tsc --noEmit -p .` → 0 errors। Preview `/app/hr/leaves/` → 308 → `/app/hr/leaves` → **200**।
- **2026-11-03 16:25 (NPT)** — यह file: path `C:\Project xxx` → `C:\Project ERP`; PC बँटवारा section (laptop: (c) + shared; ServerWin10 `D:\Touri-HR`: (d)+(e) सिर्फ़ payroll folders में); file map में payroll paths; checklist में (e) slip।

- **2026-11-03 17:34 (NPT)** — User का आदेश: HR का सारा काम सिर्फ़ laptop पर; `D:\Touri-HR` edit नहीं करना।
- **2026-11-03 17:59 (NPT)** — Backup `C:\PocketLedger-Backups\HR\20261103-175903\` → `_handoff\HR Module Master.md`, `_handoff\HR Module Master - ServerWin10.md`, `src\components\staff\types.ts`, `src\modules\hr\types.ts`, `src\modules\hr\index.ts`, `src\modules\hr\services\hrApi.ts`, `src\modules\hr\components\HrGate.tsx`, `src\modules\hr\hooks\{useHrEmployees,useHrAttendance,useHrLeaves}.ts`, `src\modules\hr\pages\{HrHomePage,EmployeesPage,EmployeeDetailsPage,AttendancePage,LeavesPage}.tsx`, `src\modules\hr\payroll\hooks\useHrPayroll.ts`, `src\modules\hr\payroll\pages\{PayrollPage,SalarySlipPage}.tsx` (18 files)। Laptop files edit से पहले के orig से मिलाईं — कोई manual बदलाव नहीं था।
- **2026-11-03 ~18:00 (NPT)** — Rework लगाया: नई files `services/hrDocs.ts`, `services/hrStaffWrite.ts`, `components/HrTable.tsx`, `components/HrEditStaffDialog.tsx`, `src/app/(dashboard)/hr/hrTailwindClasses.ts`; ऊपर की सारी files बदलीं (English UI, `data-pl-intro`, theme tokens, `ui/select`, Payroll card active, `export * from "./payroll"`)। Verification नतीजे नीचे वाली entry में।
- **2026-11-03 18:05 (NPT)** — Verification: सभी 23 files laptop worktree में लिखी गईं (UTF-8 बिना BOM, CRLF, 0 bare LF)। `tsc --noEmit` = 0 errors (~48s)। ESLint (HR files + `staff/types.ts`): 14 errors, सभी पहले से मौजूद (backup baseline में 15) — `react-hooks/set-state-in-effect` / `preserve-manual-memoization` / `staff/types.ts` का पुराना `any`; कोई नई error नहीं। HTTP 200: `/app/hr`, `/app/hr/employees`, `/app/hr/attendance`, `/app/hr/leaves`, `/app/hr/payroll`। HR UI में Devanagari grep = 0; palette grep = 0; Firebase = सिर्फ़ एक पुरानी comment ("Firebase ka koi use nahi")। git: 18 modified + 5 untracked, कोई commit नहीं।
- **2026-11-03 18:22 (NPT)** - Sync lists updated: `hr_attendance`, `hr_leaves`, `hr_payroll` (pl_docs) added after `loan_documents` in `src/lib/companyBackupCollections.ts` (`COLLECTIONS_TO_BACKUP`), `src/lib/companyDeltaCache.ts` (`COMPANY_COLLECTION_PATHS`), `src/lib/firestoreToLocalCompanyPull.ts` (`COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS`), `src/lib/writeGateway/legacy/deleteCompanyFirestoreClient.ts` (`COMPANY_SUBCOLLECTIONS`). Backup `C:\PocketLedger-Backups\HR\20261103-182105-sync\`. `tsc --noEmit` = 0 errors. Not committed.
- **2026-11-03 18:16–18:25 (NPT)** — Backup `C:\PocketLedger-Backups\HR\20261103-181621\` (41 files: `src\modules\hr\**`, `src\app\(dashboard)\hr\**`, `src\components\staff\{CreateStaffDialog,CreateStaffForm,EditStaffDialog,types}`, `useHrModuleFeature.ts`, यह handoff)। लिखने से पहले laptop files के hash backup से मिलाए — कोई manual बदलाव नहीं था।
- **2026-11-03 18:25 (NPT)** — Theme/look fix: मोटी/काली lines की वजह — Pro में `--border` काला, HR table frame का border + आख़िरी row का `!border-b` (दोहरी नीचे की line), सादा Input पर Pro का `main input` काला rule, Badge default = `bg-primary` (slate)। नई `components/HrChrome.tsx` (Dashboard ribbon card `pl-dashboard-tone-card pl-dashboard-ribbon-*`, Staff list वाला search `mlc` + `Input listChrome listChromeSearch`, `chromePillBtn` status pills); `HrTable.tsx` में आख़िरी tbody/tfoot row `!border-b-0`, frame = app Card (`pl-card-3d rounded-lg border bg-card`) + `data-theme-table="transactions"` + `data-txn-stripe` stripes। Home, Employees, Attendance, Leaves, Payroll, Salary slip — सब पर लगाया।
- **2026-11-03 18:25 (NPT)** — Employees: Balance column (Staff list जैसा `formatCurrency(balance, { showDrCr: true, context: "list" })` + `masterDetailBalanceToneClass`), Salary `noSuffix`, Joining `useFormatLoanIso`, Department = HR department या staff group। Row double-click → `HrEditStaffDialog` (shared EditStaffDialog)। `/hr/employees/[id]` अब `/hr/employees` पर redirect (generateStaticParams रखा); `EmployeeDetailsPage.tsx` हटाया, `pages/index.ts` से export हटाया।
- **2026-11-03 18:25 (NPT)** — Staff form (user मंज़ूरी 18:13): नया `components/StaffHrDetailsSection.tsx`; Create + Edit form में "HR details" (Designation, Joining date = `LoanSystemDateField` BS/AD, Status) — सिर्फ़ HR on + Account Type = Staff होने पर; `staff.hr` में save (ISO date)। Department/Salary/Salary period पहले से form में हैं — दोबारा नहीं जोड़े। `hrStaffWrite.ts` में `rememberStaffHr`। `hrTailwindClasses.ts` में नई classes।
- **2026-11-03 18:25 (NPT)** — Verification: 16 files लिखी + 1 हटाई (UTF-8 बिना BOM, CRLF, 0 bare LF)। `tsc --noEmit` = 0 errors (~39s)। ESLint: HR में 12 पुरानी errors (कोई नई नहीं); staff forms की `any` errors पुरानी हैं, नई lines में कोई नहीं। HTTP 200: `/app/hr`, `/employees`, `/attendance`, `/leaves`, `/payroll`, `/employees/__placeholder__`। Devanagari = 0, palette = 0 (सिर्फ़ Salary slip का पुराना print CSS), 2px+ border = 0। Compiled CSS में नई classes मौजूद। Commit नहीं।
- **2026-11-03 18:35 (NPT)** — Description styled like narration (user: "dicription ko narration kitaraha dikhao"): new `HR_NARRATION_TEXT` in `components/HrChrome.tsx` = `text-[11px] italic leading-tight font-normal text-foreground whitespace-normal break-words` (source: `src/components/vouchers/transactionTableShared.tsx` NarrationRow; `text-black` → theme `text-foreground`). Applied (data-pl-intro kept): EmployeesPage intro + "Type not set" CardDescription, AttendancePage unmarked note, PayrollPage post note + formula note, HrHomePage card hints. Leaves/SalarySlip: no description line to change. Anchor classes added to `src/app/(dashboard)/hr/hrTailwindClasses.ts`. Backup `C:\PocketLedger-Backups\HR\20261103-183309-narration\`.
- **2026-11-03 18:55 (NPT)** - HR home cards as tabs (user: "card same rahe usko as a tab banado, click se page change"): on md+ (768px, matchMedia) the 4 cards stay the same but act as tabs; click shows that section below the cards (`?tab=employees|attendance|leaves|payroll` via `router.replace`, default Employees, active card = `ring-1 ring-primary shadow-md` + chevron rotated); below md a card still opens its own page. Pages got `embedded?: boolean` (hides back arrow + title; toolbars, dialogs, double-click edit, HrGate unchanged). Files: `modules/hr/pages/HrHomePage.tsx`, `EmployeesPage.tsx`, `AttendancePage.tsx`, `LeavesPage.tsx`, `payroll/pages/PayrollPage.tsx`, `app/(dashboard)/hr/hrTailwindClasses.ts`. Backup `C:\PocketLedger-Backups\HR\20261103-185452-tabs\`. `tsc --noEmit` = 0 errors; `/app/hr`, `/app/hr?tab=attendance`, `/app/hr/employees|attendance|leaves|payroll` = 200. Browser check pending.
- **2026-11-03 19:09 (NPT)** - Sticky table header + Total row, and Salary slip popup (user: only the rows scroll; slip opens as a popup). `components/HrTable.tsx`: new `HrTable stickyHeaderFooter` prop (`HR_TABLE_STICKY`: sticky thead top-0 / tfoot bottom-0, z-20, opaque bg-card, 1px header/Total lines as inset box-shadow in `--border`) + `HR_FILL_COLUMN` / `HR_FILL_TABS` / `HR_FILL_TAB_CONTENT` / `HR_TABLE_FRAME_FILL` (frame as tall as its rows, max the space left; the ui/table wrapper `scrollbar-slim-dim` is the only scroller, both directions). Used in Payroll (header + Total), Employees (header + Total/Balance; nested 'Type not set' table unchanged), Attendance Daily (header) + Monthly (header + Total), Leaves (header). New `payroll/components/SalarySlipView.tsx` (`useSalarySlip`, `SalarySlipView`, `SalarySlipActions`, `SalarySlipStatusPill`; Print = hidden iframe with only the slip + app CSS + black-on-white print CSS; PDF = same html2pdf call on the slip element) + `SalarySlipDialog.tsx` (shared ui/dialog: title, Draft/Posted, Refresh, Print, Download PDF, Close; body scrolls); `SalarySlipPage.tsx` now uses the shared view (route `/hr/payroll/slip/[id]` kept); Payroll `Slip` button opens the popup. `hrTailwindClasses.ts` updated. Backup `C:\PocketLedger-Backups\HR\20261103-190312-sticky\`. `tsc --noEmit` = 0 errors; /app/hr, ?tab=payroll, /payroll, /attendance, /leaves, /employees, /payroll/slip/<id> = 200. Browser check by user pending.
- **2026-11-03 19:20 (NPT)** - HR fields blue 1px border, HR-wide (user: "black border ko blue karo pill jaisa border only" / "globally sare ko blue kardo hr me"). `components/HrChrome.tsx`: new `HR_FIELD_SCOPE` (Tailwind descendant arbitrary variants: every `input` except checkbox/radio, `textarea`, `button[role=combobox]` (SelectTrigger), skipping `.border-0`; `!border` + `!border-blue-300` = same token as chromeProPillCn pill buttons; `:focus-visible` = `!border-primary`; three `:not(#pl-hr-*)` parts so it beats the theme rules `body[class*=theme-] main .rounded-md.border` (#000, [0,21,2]) and the light-theme search rule ([2,3,1])) and `HR_FIELD_PILL` (`h-9 rounded-full px-3`). Scope on every `data-pl-hr-root` page root (Payroll, Attendance, Leaves, Employees, HR home, Salary slip page), the SalarySlipDialog content and the StaffHrDetailsSection box; pill shape on Payroll month + Salary expense (debit) select, Attendance date + month pickers. Border only: backgrounds stay theme-driven. Other app pages untouched (classes exist only in HR). Classes listed in `hrTailwindClasses.ts`; verified in compiled globals CSS (Pro, PL light, Soft blue, Colorfull). Backup `C:\PocketLedger-Backups\HR\20261103-191550-monthpill\`.
- **2026-11-03 19:25 (NPT)** - Fix: slip showed 0 payable / 0 gross while the Payroll row showed live figures (user: "slip me payable kyo nahi aata?"). Root cause: the slip only read the saved `hr_payroll` record; a draft generated before attendance was marked keeps present_days 0 / gross 0 / counts all unmarked, while the table recomputes live ("Draft *"). New `payrollFigures(saved, calc, edit)` in `payroll/utils/payrollCalc.ts` (posted = saved values; draft = `computeEmployeePayroll` live + saved or edited deductions/addition) is now used by BOTH the Payroll row and `useSalarySlip` (which loads month attendance + approved leaves like the page); the popup also gets the row's unsaved Deductions / Addition (`SalarySlipDialog edit`). Slip header shows "Draft *" when live figures differ from the saved draft. Backup `C:\PocketLedger-Backups\HR\20261103-192151-slipcalc\`.
- **2026-11-03 19:40 (NPT)** - Left date + S.No. (user: "bana ho to hat jaye"). Staff form HR details: Status = Left shows a required **Left date** (LoanSystemDateField BS/AD; prefilled today, cannot be cleared; saved as `staff.hr.left_date`, removed when Status goes back to Active; `StaffHrFields.left_date`, `HrEmployee.left_date`). New `utils/leftDate.ts` (`employeeLeftDate`, `isAfterLeftDate`, `isEmployeeWorkingOn`). Saving Left + date (`announceStaffHrSaved` / `writeStaffHrFields`) runs `services/hrLeftDateCleanup.ts`: that employee's `hr_attendance` with date > left date are soft-deleted via new `hrDocs.deleteHrDocs` (tombstone isDeleted/deleted, SQLite upsert + outbox "update", data kept); JSON copy kept in localStorage `pl_hr_left_cleanup_v1:<company>:<employee>:<time>`, count in toast + console. Attendance: Daily hides left employees after the left date; Monthly shows them while left date >= month start, cells after it blank (bg-muted/40, not counted), Left pill. Payroll: Left employee shown if left date >= month start or has attendance that month; `computeEmployeePayroll` skips days after the left date (attendance + leaves ignored, `counts.after_left`), same calc for row and slip; Left pill. S.No. first column on Payroll, Employees, Attendance daily/monthly, Leaves (`HR_SNO_HEAD`/`HR_SNO_CELL` in HrTable; Total row cell blank); Employees shows the left date next to the Left pill. Classes added: left-12, min-w-[3rem], ml-2. Backup `C:\PocketLedger-Backups\HR\20261103-193204-leftdate\`. tsc 0, ESLint 8 (baseline), routes 200. No commit.

## अगला कदम

0. **User browser test** (preview :2100): Employees (Add employee → नया staff → details page; Type not set section; Edit staff details; Mark as left), Attendance (daily save, monthly grid), Leaves (request, approve/reject, decided by/at), Payroll (draft, post → Add Salary voucher, Posted badge), Slip (screen, Print, PDF), dark/दूसरी themes में lines 1px।
0a. **Proposals (मंज़ूरी चाहिए):** Tailwind `content` में `./src/modules/**/*.{ts,tsx}`; Theme Master: `globals.css` का global table rule (`border-color:#000 !important`, ~7453) और 4K block (~3142, `border-width:3px`); `hr_*` collections को company backup / delta cache / pull / delete / webAppBasePath lists में जोड़ना; vouchers context fingerprint में `hr`; कुछ themes में `--pl-pos` / `--pl-warn` नहीं हैं।
1. User की "हाँ" के बाद **Server Master** (`pl_hr` routes, privacy के लिए): `/api/pl/hr/status`, `{employees|attendance|leaves|payroll}/{list|upsert|delete}`, `leaves/decide`, `payroll/post` + 403 `{code:'hr_disabled'}`।
2. ~~Theme Master: sidebar diff~~ — लग गया (15:40)।
3. **Role defaults** (`usePermissions.tsx`): user ने तय किया — **जैसा है वैसा रहे** (54वाँ `true` → accountant / editor / manager को default `hr_view`)। इसे न बदलें।
4. Admin `PlanDetails` में `hrModuleEnabled` का label/toggle (अभी नहीं है)।
5. Server बनने के बाद Employees + Attendance का end-to-end test, फिर (c) Leaves। Attendance server note: `attendance/list` को `from`/`to`/`employee` filter और `attendance/upsert` को `app_id` पर upsert चाहिए (client deterministic `att_<employee>_<date>` भेजता है)।
6. **Git Master**: ऊपर की files commit करे (मैं git नहीं चलाता)।
7. **Server Master (Leaves)**: `leaves/list` पर `employee` filter (और `from`/`to` का अर्थ तय करें — overlap बेहतर), `leaves/decide` server पर `decided_by` (current user) + `decided_at` set करे, और decide सिर्फ़ `hr_leave_approve`/owner/admin को।
8. ~~ServerWin10 (Payroll)~~ — रद्द (17:34 NPT आदेश)। Payroll export + Payroll card active laptop पर हो गए (2026-11-03)।
