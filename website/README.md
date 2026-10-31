# Marketing website (separate from the Pocket Ledger app)

Static site under `website/`. **Does not use `src/`.**

## Local development (`npm run dev`)

| URL | What |
|-----|------|
| `http://localhost:3000/` | Country picker |
| `http://localhost:3000/home/?c=np` | Country marketing site (Nepal example) |
| `http://localhost:3000/terms/` | Terms (per country site; main is not responsible for a subdomain) |
| `http://localhost:3000/downloads/` | Downloads (local `/releases/…` if staged) |
| `http://localhost:3000/company/` | Company profile |
| `http://localhost:3000/app` | Pocket Ledger app |
| `http://localhost:3000/admin-release/` | Hidden Firebase EXE/APK upload |

## Stage installers (not every build)

After you build EXE / APK **once**, copy into a date folder:

```bash
npm run website:stage-releases
```

Creates:

```text
releases/2026-08-14/*.exe
releases/2026-08-14/*.apk
releases/latest.json
```

Then `localhost:3000/downloads` buttons use those local paths.

## Live Firebase publish (single domain, same shape as localhost)

| URL | Serves |
|-----|--------|
| `https://pocket-ledger.com/` | Country picker only (`website/dist` via Firebase Hosting) |
| `https://pocket-ledger.com/home/?c=np` | Country marketing site until ISO-2 subdomains (`np.pocket-ledger.com`) have DNS |
| `https://pocket-ledger.com/app` | Next app (Hosting rewrite → App Hosting Cloud Run) |

1. App Hosting keeps `WEB_APP_BASE_PATH=/app` (see `apphosting.yaml`) — git push rebuilds the app under `/app`.
2. Deploy Hosting (website + `/app` rewrite):

```bash
npm run website:build
firebase deploy --only hosting --project studio-5452513410-a3f5b
```

3. Custom domain `pocket-ledger.com` must be connected to **Firebase Hosting** (site `studio-5452513410-a3f5b`), not only App Hosting — otherwise root still shows the app.

4. Open `https://pocket-ledger.com/admin-release/` (or localhost same path).
5. Sign in as owner `nansari15300@gmail.com` (or another release admin).
6. Optional: **Add user** on the page (saved to Storage `public-releases/admins.json`).
7. Enter EXE/APK version → optional Play Store URL → Upload.
8. Files go to **Firebase Storage** (not Firestore): `public-releases/YYYY-MM-DD/` + `latest.json`.

Deploy storage rules: `firebase deploy --only storage`

## EXE / APK update check

Packaged EXE and APK check Firebase `latest.json` at most once per calendar day.
When the published version is higher, the app shows an update banner:

- EXE → installer download
- APK → Play Store URL if set, otherwise APK download

Keep these three versions equal when publishing: `electron/package.json`,
`android/app/build.gradle`, and `src/config/releaseVersion.ts`.

## Website-only build

```bash
npm run website:build
npm run website:serve
```
