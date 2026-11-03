# HR Module Master

HR module (Employees / Attendance / Leaves / Payroll) — Pocket Ledger के अंदर अलग, plan-gated module।
Worktree: `C:\Project xxx\Refference apps\Touri-HR` (branch `feature/hr-module`)।

## नियम

1. काम सिर्फ़ **Touri-HR** worktree में। `Touri + React` (main, auto-synced) को कभी न छुएँ।
2. किसी भी मौजूदा file को बदलने से **पहले backup**: `C:\PocketLedger-Backups\HR\<yyyyMMdd-HHmmss>\` में, relative path वैसा ही रखें। नई files का backup ज़रूरी नहीं, पर सूची log में लिखें।
3. **Git मैं नहीं चलाता** — add / commit / push / checkout / stash / branch सब **Git Master** करेगा। सिर्फ़ read-only `git --no-optional-locks status` / `diff` चल सकता है।
4. **Firebase नहीं** — HR में कोई Firebase import नहीं। सिर्फ़ PocketBase data layer (`src/lib/pocketbaseData/pbClient.ts` का `pbRequest`, `/api/pl/data/batch` वाला pattern)।
5. **Server हिस्सा** (`/api/pl/hr/*` routes, collections, plan check) **Server Master** बनाएगा — user की "हाँ" के बाद ही। ServerWin10 को हम नहीं छूते।
6. **Sidebar** (`src/components/layout/AppSidebar.tsx`) हम edit नहीं करते — proposed diff **Theme Master** देखेगा और लगाएगा। `globals.css` भी नहीं छूते; styles module के अंदर Tailwind / theme variables से।
7. User के हाथ से किए गए बदलाव **overwrite न करें** — edit से पहले file पढ़ें, सिर्फ़ ज़रूरी हिस्सा बदलें।
8. Folder के नाम **वैसे ही** रहें (कोई rename / move नहीं)।
9. Files UTF-8 (बिना BOM), CRLF line endings (repo जैसा)।
10. npm install / ci नहीं; dev server (HR preview :2100) start/stop नहीं।
11. दूसरे bots की files नहीं: TransactionsTable/transaction*, theme files, AnimationSettings, firebase files, `src/app/api/**`, `src-tauri`।

## नक्शा (files map)

| File | काम |
|---|---|
| `src/modules/hr/types.ts` | HrEmployee / HrAttendance / HrLeave / HrPayroll types (server spec जैसे) |
| `src/modules/hr/services/hrApi.ts` | `/api/pl/hr/*` typed client; 403 `hr_disabled` → `HrDisabledError` |
| `src/modules/hr/hooks/useHrEmployees.ts` | active company के employees list + reload |
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
| `src/modules/hr/pages/HrHomePage.tsx` | HR home (Employees active, बाक़ी "जल्द आ रहा है") |
| `src/modules/hr/pages/EmployeesPage.tsx` | Employees list |
| `src/modules/hr/pages/EmployeeDetailsPage.tsx` | Employee add (`new`) / view / edit / remove |
| `src/modules/hr/pages/index.ts`, `src/modules/hr/index.ts` | barrel exports |
| `src/hooks/useHrModuleFeature.ts` | company override → plan `hrModuleEnabled` → AND `can('hr_view')`; SuperAdmin pass |
| `src/app/(dashboard)/hr/page.tsx` | route `/hr` |
| `src/app/(dashboard)/hr/employees/page.tsx` | route `/hr/employees` |
| `src/app/(dashboard)/hr/employees/[id]/page.tsx` + `EmployeeIdRouteClient.tsx` | route `/hr/employees/<id>` (static export: `__placeholder__` + `new`) |
| `src/config/plans.ts` (shared) | `hrModuleEnabled` entitlement — basic=false, advance/pro/pro-plus=true |
| `src/lib/permissions.ts` (shared) | `hr_view`, `hr_manage`, `hr_attendance`, `hr_leave_approve`, `hr_payroll` + "HR" group (सबसे आख़िर में) |
| `src/hooks/useCachedFeatureConfig.ts` (shared) | offline default `hr: true` |
| `src/components/layout/AppSidebar.tsx` (shared) | `hr` menu item (Briefcase, `permission: "hr_view"`) — Theme Master की मंज़ूरी से लगाया; plan-based hiding अभी नहीं |

## Checklist — v1 features

- [x] Foundation: types, hrApi, useHrModuleFeature, HrGate, plan entitlement, permissions, feature config
- [ ] (a) Employee profile — UI बन गया (list / add / edit / remove); **server routes बाक़ी** (Server Master)
- [ ] (b) Attendance — UI बन गया (daily mark + bulk save, monthly grid); **server routes बाक़ी** (Server Master)
- [ ] (c) Leaves — UI बन गया (request form, Pending/All, approve/reject, attendance में approved leave prefill); **server routes बाक़ी** (Server Master)
- [ ] (d) Payroll — महीने का हिसाब (present_days, gross, deductions, net) + voucher post (`/payroll/post`)
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

## अगला कदम

1. User की "हाँ" के बाद **Server Master**: `/api/pl/hr/status`, `{employees|attendance|leaves|payroll}/{list|upsert|delete}`, `leaves/decide`, `payroll/post` + 403 `{code:'hr_disabled'}`।
2. ~~Theme Master: sidebar diff~~ — लग गया (15:40)।
3. **Role defaults** (`usePermissions.tsx`): user ने तय किया — **जैसा है वैसा रहे** (54वाँ `true` → accountant / editor / manager को default `hr_view`)। इसे न बदलें।
4. Admin `PlanDetails` में `hrModuleEnabled` का label/toggle (अभी नहीं है)।
5. Server बनने के बाद Employees + Attendance का end-to-end test, फिर (c) Leaves। Attendance server note: `attendance/list` को `from`/`to`/`employee` filter और `attendance/upsert` को `app_id` पर upsert चाहिए (client deterministic `att_<employee>_<date>` भेजता है)।
6. **Git Master**: ऊपर की files commit करे (मैं git नहीं चलाता)।
7. **Server Master (Leaves)**: `leaves/list` पर `employee` filter (और `from`/`to` का अर्थ तय करें — overlap बेहतर), `leaves/decide` server पर `decided_by` (current user) + `decided_at` set करे, और decide सिर्फ़ `hr_leave_approve`/owner/admin को।
