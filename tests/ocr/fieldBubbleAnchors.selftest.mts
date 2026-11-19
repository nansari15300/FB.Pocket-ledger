/** OCR suggestion bubble field anchors. Run: npx tsx tests/ocr/fieldBubbleAnchors.selftest.mts */
import { OCR_FIELD_KEYS_BY_VOUCHER_TYPE, ocrFieldForSuggestion, ocrSuggestionFieldAnchor } from "../../src/modules/ocr/ocrFieldAnchors";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};

eq("create-account-from points at Bank/Cash (account), not lines", ocrFieldForSuggestion("create-account-from"), "account");
eq("create-account-from has account-from anchor", ocrSuggestionFieldAnchor("create-account-from"), "account-from");
eq("no-payment-account points at Bank/Cash (account)", ocrFieldForSuggestion("no-payment-account"), "account");
eq("no-payment-account has account-from anchor", ocrSuggestionFieldAnchor("no-payment-account"), "account-from");
eq("no-payment-account-to points at Contra To", ocrFieldForSuggestion("no-payment-account-to"), "account-to");
eq("no-payment-account-to has account-to anchor", ocrSuggestionFieldAnchor("no-payment-account-to"), "account-to");
eq("create-account-to points at Contra To (account-to), not lines or account", ocrFieldForSuggestion("create-account-to"), "account-to");
eq("create-account-to has account-to anchor", ocrSuggestionFieldAnchor("create-account-to"), "account-to");
eq("account (confirm From) stays on account", ocrFieldForSuggestion("account"), "account");
eq("account-<id> From candidate stays on account", ocrFieldForSuggestion("account-abc"), "account");
eq("account-to-<id> To candidate stays on account-to", ocrFieldForSuggestion("account-to-abc"), "account-to");
eq("account-to id stays on account-to", ocrFieldForSuggestion("account-to"), "account-to");
eq("account-payee-* is the payee/party field, not Bank/Cash", ocrFieldForSuggestion("account-payee-xyz"), "party");
eq("account-payee has no bank anchor", ocrSuggestionFieldAnchor("account-payee-xyz"), undefined);
eq("create-expense-account (Direct Expense To) stays on party", ocrFieldForSuggestion("create-expense-account"), "party");
eq("use-expense-account-* stays on party", ocrFieldForSuggestion("use-expense-account-1"), "party");
eq("choose-vat points at tax, not lines", ocrFieldForSuggestion("choose-vat"), "tax");
eq("create-vat stays on tax", ocrFieldForSuggestion("create-vat"), "tax");
eq("create-party stays on party", ocrFieldForSuggestion("create-party"), "party");
eq("switch stays on voucher-type", ocrFieldForSuggestion("switch"), "voucher-type");
eq("create-item falls through to lines", ocrFieldForSuggestion("create-item-0"), "lines");
eq("lines stays on lines", ocrFieldForSuggestion("lines"), "lines");
eq("ocr-language attaches to the OCR bar key", ocrFieldForSuggestion("ocr-translate-default"), "ocr-language");

const types = [
  "sale", "purchase", "payment_in", "payment_out", "direct_income", "direct_expense",
  "contra", "journal", "adjustment", "note", "add_salary", "production",
];
eq("all listed voucher types have a field-key catalog", types.every((t) => (OCR_FIELD_KEYS_BY_VOUCHER_TYPE[t] ?? []).length > 0), true);
eq("Direct Expense registers From Bank/Cash (account) and To Expense (party)", (OCR_FIELD_KEYS_BY_VOUCHER_TYPE.direct_expense as string[]).includes("account") && OCR_FIELD_KEYS_BY_VOUCHER_TYPE.direct_expense.includes("party"), true);
eq("Contra registers From (account) and To (account-to)", OCR_FIELD_KEYS_BY_VOUCHER_TYPE.contra.includes("account") && OCR_FIELD_KEYS_BY_VOUCHER_TYPE.contra.includes("account-to"), true);

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
