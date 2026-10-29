/**
 * `dataSourceMode` (localStorage) + build-time flags — ek jagah taaki
 * DataSourceContext, `isLocalOnlyMode`, aur Firestore network toggle sync rahein.
 */

export type DataSourceMode = "firebase" | "local";

/** localStorage key — `DataSourceContext` ke saath match rakho. */
export const DATA_SOURCE_MODE_STORAGE_KEY = "dataSourceMode";

/** Static APK / explicit local-only web: default local; `npm run dev` par Firebase (localhost web refresh purge avoid). */
export function buildDefaultDataSourceMode(): DataSourceMode {
  if (process.env.NODE_ENV === "development") return "firebase";
  if (process.env.NEXT_PUBLIC_PL_SERVER_PACK === "1") return "firebase";
  if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1") return "local";
  if (process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "1") return "local";
  return "firebase";
}

/** Browser: saved mode ya build default; SSR/build: sirf default (window nahi). */
export function getEffectiveDataSourceModeFromWindow(): DataSourceMode {
  if (typeof window === "undefined") return buildDefaultDataSourceMode();
  const raw = window.localStorage.getItem(DATA_SOURCE_MODE_STORAGE_KEY);
  if (raw === "firebase" || raw === "local") return raw;
  return buildDefaultDataSourceMode();
}

/**
 * Local-only paths: SQLite-first company load, fast local auth, mirrored getDocs loop, etc.
 * Static/APK + `NEXT_PUBLIC_LOCAL_ONLY_MODE` hamesha local; web par missing key ab Firebase treat.
 */
export function computeIsLocalOnlyMode(): boolean {
  // Dev (`localhost:3000`): `.env.local` STATIC_BUILD=1 se APK jaisa local-only mat banao — Firestore + SQLite merge sahi rahe.
  if (process.env.NODE_ENV === "development") {
    if (process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "1") return true;
    if (typeof window !== "undefined") {
      return getEffectiveDataSourceModeFromWindow() === "local";
    }
    return buildDefaultDataSourceMode() === "local";
  }
  if (process.env.NEXT_PUBLIC_PL_SERVER_PACK === "1") {
    if (typeof window !== "undefined") {
      return getEffectiveDataSourceModeFromWindow() === "local";
    }
    return false;
  }
  if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1") return true;
  if (process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "1") return true;
  if (typeof window !== "undefined") {
    return getEffectiveDataSourceModeFromWindow() === "local";
  }
  return buildDefaultDataSourceMode() === "local";
}
