import type admin from "@/lib/server/pbAdminTypes";

export type EmailCompanyEntry = {
  name: string;
  createdAtMs: number | null;
};

export type EmailCompanyProfile = {
  email: string;
  companyCount: number;
  firstCreatedAtMs: number | null;
  companyNames: string[];
  ownedCompanyNames: string[];
  sharedCompanyNames: string[];
  ownedCompanies: EmailCompanyEntry[];
  sharedCompanies: EmailCompanyEntry[];
  ownedCount: number;
  sharedCount: number;
};

function emailVariants(email: string): string[] {
  const raw = String(email || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  if (lower === raw) return [raw];
  return [...new Set([raw, lower])];
}

function readCreatedAtMs(data: Record<string, unknown>): number | null {
  const createdAt = data.createdAt;
  if (createdAt && typeof createdAt === "object" && "toMillis" in createdAt) {
    try {
      const ms = (createdAt as admin.firestore.Timestamp).toMillis();
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) return createdAt;
  return null;
}

function isDeletedCompany(data: Record<string, unknown>): boolean {
  return data.isDeleted === true || data.deleted === true;
}

function sortCompanies(
  rows: Array<{ name: string; createdAtMs: number | null }>
): EmailCompanyEntry[] {
  return rows
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ name: row.name, createdAtMs: row.createdAtMs }));
}

export async function loadEmailCompanyProfiles(
  db: admin.firestore.Firestore,
  emails: string[]
): Promise<Record<string, EmailCompanyProfile>> {
  const uniqueLower = [
    ...new Set(
      emails
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const out: Record<string, EmailCompanyProfile> = {};

  await Promise.all(
    uniqueLower.map(async (emailLower) => {
      const owned = new Map<string, { name: string; createdAtMs: number | null }>();
      const shared = new Map<string, { name: string; createdAtMs: number | null }>();

      for (const variant of emailVariants(emailLower)) {
        const ownedSnap = await db
          .collection("companies")
          .where("ownerEmail", "==", variant)
          .limit(80)
          .get();
        ownedSnap.docs.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          if (isDeletedCompany(data)) return;
          if (owned.has(docSnap.id)) return;
          owned.set(docSnap.id, {
            name: String(data.name || "Unnamed company").trim() || "Unnamed company",
            createdAtMs: readCreatedAtMs(data),
          });
        });
      }

      const sharedSnap = await db
        .collection("companies")
        .where("sharedWithEmailsLower", "array-contains", emailLower)
        .limit(80)
        .get();
      sharedSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (isDeletedCompany(data)) return;
        if (owned.has(docSnap.id) || shared.has(docSnap.id)) return;
        shared.set(docSnap.id, {
          name: String(data.name || "Unnamed company").trim() || "Unnamed company",
          createdAtMs: readCreatedAtMs(data),
        });
      });

      const ownedRows = [...owned.values()];
      const sharedRows = [...shared.values()];
      const allRows = [...ownedRows, ...sharedRows];
      const createdTimes = allRows
        .map((row) => row.createdAtMs)
        .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms))
        .sort((a, b) => a - b);

      const ownedCompanies = sortCompanies(ownedRows);
      const sharedCompanies = sortCompanies(sharedRows);
      const ownedCompanyNames = ownedCompanies.map((row) => row.name);
      const sharedCompanyNames = sharedCompanies.map((row) => row.name);

      out[emailLower] = {
        email: emailLower,
        companyCount: allRows.length,
        firstCreatedAtMs: createdTimes[0] ?? null,
        companyNames: [...ownedCompanyNames, ...sharedCompanyNames],
        ownedCompanyNames,
        sharedCompanyNames,
        ownedCompanies,
        sharedCompanies,
        ownedCount: ownedCompanyNames.length,
        sharedCount: sharedCompanyNames.length,
      };
    })
  );

  return out;
}
