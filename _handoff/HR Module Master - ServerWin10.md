# HR Module Master — ServerWin10 (Payroll + Salary slip)

> यह फ़ाइल ServerWin10 वाले agent ने बनाई है। Laptop वाली `_handoff/HR Module Master.md` को छुआ नहीं गया।
> Branch: `feature/hr-module` (worktree `D:\Touri-HR`)। इस PC पर कोई npm / tsc / dev server / build / git-write नहीं चलाया गया।

## 1. बनाई गई नई फ़ाइलें

| फ़ाइल | काम |
|---|---|
| `src/modules/hr/payroll/utils/payrollCalc.ts` | Payable days / gross / net की गणना, deterministic app_id `pay_<employee>_<YYYY-MM>`, `data` JSON helpers |
| `src/modules/hr/payroll/hooks/useHrPayroll.ts` | महीने की payroll list, draft upsert, post (voucher + `hrApi.postPayroll`) |
| `src/modules/hr/payroll/pages/PayrollPage.tsx` | Month picker + employees table, Generate drafts / Save / Post (row + bulk, confirm dialog) |
| `src/modules/hr/payroll/pages/SalarySlipPage.tsx` | Printable salary slip, Print (scoped @media print) + Download PDF (html2pdf.js) |
| `src/modules/hr/payroll/index.ts` | Payroll barrel |
| `src/app/(dashboard)/hr/payroll/page.tsx` | Route `/hr/payroll` (HrGate + next/dynamic ssr:false) |
| `src/app/(dashboard)/hr/payroll/slip/[id]/page.tsx` | Static export shell (`generateStaticParams` → `__placeholder__`) |
| `src/app/(dashboard)/hr/payroll/slip/[id]/SlipIdRouteClient.tsx` | `useParams` से id, HrGate + dynamic SalarySlipPage |

## 2. Voucher function

- `saveVoucher(companyId, user.uid, submissionData, null)` — `@/lib/voucherActionsClient` (वही जो `SalaryForm` / Add Salary इस्तेमाल करता है)।
- Voucher number: `getNextVoucherNumberForCompany` (`@/lib/nextVoucherNumber`), prefix = `company.voucherPrefixes.add_salary[0]` या `"ADSAL-"`।
- Payload: `type: "journal"`, `subType: "add_salary"`, `date` = महीने का आखिरी दिन, `total` = Net, `narration` = `HR Payroll YYYY-MM — <नाम> (payable X days)`, `...voucherAttachmentFieldsForSave([])`, `unassignedFile: null`।
- Entries: Staff (`employee.staff_app_id`) **Credit** = Net; चुना गया Salary expense account **Debit** = Net।
- Save के बाद `dispatchVoucherLivePatch(...)` (ledger cache तुरंत अपडेट)।
- Permission: `assertCan(can, "create_records")` + `assertCanPerformBackdated(..., "create", date)` — SalaryForm जैसा।
- फिर `hrApi.postPayroll(companyId, payroll.app_id, voucherId)`।

## 3. Calculation नियम

- Payable days = Present + 0.5 × Half day + Holiday + Paid leave। Unpaid leave, Absent, Unmarked = 0। Joining से पहले के दिन गिने नहीं जाते।
- Attendance record को प्राथमिकता; attendance "leave" → approved unpaid leave हो तो unpaid, वरना paid। Attendance न हो और approved leave हो → leave_type `unpaid` छोड़कर paid।
- Monthly: Gross = Base × Payable ÷ महीने के दिन। Daily: Gross = Base × Payable। 2 decimal rounding।
- Net = Gross + Addition − Deductions (0 से कम नहीं)।
- `present_days` field में **payable days** रखे जाते हैं; breakdown `data` में: `addition`, `counts`, `days_in_month`, `salary_type`, `base_salary`, `payable_days`, `pending_voucher_app_id`, `voucher_number`।
- Double-post रोक: module-level lock + post से पहले server से ताज़ा record; posted मिला तो रुकता है। Voucher बनने के बाद post fail हो तो `data.pending_voucher_app_id` से retry पर वही voucher reuse।
- Posted record UI में read-only; केवल `canPayroll` वाले edit/post कर सकते हैं।

## 4. Shared files के लिए प्रस्तावित diff (laptop करे)

```diff
--- src/modules/hr/pages/HrHomePage.tsx
-  { id: "payroll", label: "Payroll", hint: "वेतन", href: "/hr/payroll", icon: Wallet, active: false },
+  { id: "payroll", label: "Payroll", hint: "वेतन", href: "/hr/payroll", icon: Wallet, active: true },
```

```diff
--- src/modules/hr/index.ts
+export * from "./payroll";
```

types.ts / hrApi.ts में कोई बदलाव ज़रूरी नहीं।

## 5. Progress log (NPT, UTC+5:45)

- 2026-11-03 ~15:45 NPT — मौजूदा HR code, SalaryForm, voucher helpers, routes पढ़े (read-only)।
- 2026-11-03 ~16:15 NPT — payrollCalc, useHrPayroll, PayrollPage, SalarySlipPage, barrel, routes लिखे।
- 2026-11-03 ~16:35 NPT — फ़ाइलें `D:\Touri-HR` में कॉपी, UTF-8 (no BOM) + CRLF verify। Testing laptop पर Git Master sync के बाद।
