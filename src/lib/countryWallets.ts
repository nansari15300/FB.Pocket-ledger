/** Extra country wallets on `app_settings/payment_gateways.wallets` — template rows, not new engines. */

export type CountryWalletEngine = "webhook" | "manual";

export type CountryWallet = {
  id: string;
  name: string;
  country: string;
  engine: CountryWalletEngine;
  merchant: string;
  apiKey: string;
  secret: string;
  payUrl: string;
  instructions: string;
  showOnPlan: boolean;
};

export type CountryWalletPublic = Omit<CountryWallet, "secret" | "apiKey">;

export function emptyCountryWallet(): CountryWallet {
  return {
    id: newCountryWalletId(),
    name: "",
    country: "",
    engine: "webhook",
    merchant: "",
    apiKey: "",
    secret: "",
    payUrl: "",
    instructions: "",
    showOnPlan: true,
  };
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function newCountryWalletId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseCountryWallets(raw: unknown): CountryWallet[] {
  if (!Array.isArray(raw)) return [];
  const out: CountryWallet[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) continue;
    const engine: CountryWalletEngine = r.engine === "webhook" ? "webhook" : "manual";
    out.push({
      id,
      name,
      country: str(r.country) || "All",
      engine,
      merchant: str(r.merchant),
      apiKey: str(r.apiKey),
      secret: str(r.secret),
      payUrl: str(r.payUrl),
      instructions: str(r.instructions),
      showOnPlan: r.showOnPlan !== false,
    });
  }
  return out;
}

export function publicCountryWallets(rows: CountryWallet[]): CountryWalletPublic[] {
  return rows
    .filter((w) => w.showOnPlan)
    .map(({ secret: _s, apiKey: _k, ...rest }) => rest);
}

export function findCountryWallet(rows: CountryWallet[], id: string): CountryWallet | null {
  const k = str(id);
  return rows.find((w) => w.id === k) || null;
}
