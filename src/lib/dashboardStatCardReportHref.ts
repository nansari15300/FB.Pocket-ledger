import { appNavHref } from "@/lib/appNavHref";

/**
 * Dashboard voucher summary card → Reports deep-link (`/reports?report=…&allVouchers=1`).
 * `voucherScope` Payment report me subset filter (Pay Salary vs baaki Payment).
 * Static export (`trailingSlash`): `appNavHref` — bina slash ke `/reports?…` par SW/host full reload / 404 fallback ho sakta tha.
 */
export function dashboardStatCardReportHref(statType: string): string | null {
  const q = new URLSearchParams();
  q.set("allVouchers", "1");

  switch (statType) {
    case "sale":
      q.set("report", "sale");
      break;
    case "purchase":
      q.set("report", "purchase");
      break;
    case "journal":
      q.set("report", "journal");
      break;
    case "add_salary":
      q.set("report", "add-salary");
      break;
    case "contra":
      q.set("report", "contra");
      break;
    // Payment In report merges both types; dashboard cards count each separately — scope matches card filter.
    case "direct_income":
      q.set("report", "payment-in");
      q.set("voucherScope", "directIncomeOnly");
      break;
    case "payment_in":
      q.set("report", "payment-in");
      q.set("voucherScope", "paymentInOnly");
      break;
    // Direct Expense card = only `direct_expense` vouchers, not all Payment family.
    case "direct_expense":
      q.set("report", "payment-out");
      q.set("voucherScope", "directExpenseOnly");
      break;
    case "payment_out_excl_pay_salary":
      q.set("report", "payment-out");
      q.set("voucherScope", "paymentOutExclPaySalary");
      break;
    case "pay_salary":
      q.set("report", "payment-out");
      q.set("voucherScope", "paySalary");
      break;
    case "note":
      q.set("report", "notes");
      break;
    case "production":
      return appNavHref("/production");
    default:
      return null;
  }
  return appNavHref(`/reports?${q.toString()}`);
}
