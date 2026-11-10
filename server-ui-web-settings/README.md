# Web Settings for the Server UI

This folder has the website admin panel, moved off the public website, for the Server UI Hosting page ("Web Settings" tab).

- `web-settings.js`: plain browser JS with no build step and no Firebase. It defines `window.WebSettings` and the alias `window.PLWebSettings`.
- `web-settings.css`: all styles sit under the root class `.plws`. Element ids start with `plws-<view>-`. Colours use the Server UI theme variables (`--surface`, `--border`, `--text`, `--accent`, `--ok`, `--bad`, ...), so Light, Gray, Medium and Dark themes follow automatically.

Both files are UTF-8 without BOM. They are new files, so no existing Server UI file is replaced.

## 1. Add to `pb_public/index.html`

```html
<link rel="stylesheet" href="/web-settings.css?v=20261110-7">
...
<script src="/app.js?v=..."></script>
<script src="/web-settings.js?v=20261110-7"></script>   <!-- after app.js -->
```

Inside `#view-web-hosting`, add an empty container for the Web Settings tab, for example:

```html
<div id="wh-web-settings" class="hidden"></div>
```

## 2. Mount it from `app.js` when the "Web Settings" pill or `#/web-hosting/settings` opens

```js
var wsCtl = null;
function openWebSettings() {
  var box = $("wh-web-settings");
  if (!wsCtl) {
    wsCtl = window.WebSettings.mount(box, {
      api: api,          // api(method, path, body) -> Promise<JSON>; throws err.status
      token: token,      // function; used only for the raw EXE/APK chunk upload
      t: t,              // i18n; missing keys fall back to English
      me: { role: "main_admin" /* or "web_admin" */, web_perms: { releases: "edit", videos: "view", notice: "none", downloads: "view", users: "none" } }
    });
  }
}
```

- `mount()` returns `{ show(tabKey), reload(tabKey?), destroy() }`. The tab keys are `releases`, `videos`, `downloads`, `notice` and `users`.
- After a logout, or when the user changes, call `wsCtl.destroy(); wsCtl = null;` so the next mount uses the new `me`.
- Each section loads once, the first time its tab opens. `wsCtl.reload()` reloads the current section. The last open tab is kept in sessionStorage under `plws_active_tab`.
- The container itself needs no padding. Inside it there are pill sub-tabs, then a status line, then cards. Cards are 40px apart and each one scrolls inside at 70vh.

## 3. What it assumes about `ctx`

| field | used as |
|---|---|
| `api(method, path, body)` | Every JSON call. It must add `Authorization` itself and throw an Error with `.status` on a non-2xx response, as `app.js` `api()` already does. Error text comes from `err.message`, which is `data.message`. |
| `token()` | Raw token (no "Bearer"), set as `Authorization` on the XHR for `upload-chunk`, the only non-JSON call. If it is missing, sessionStorage `pl_server_admin_token` is used. |
| `t(key)` | When `t(key)` returns the key itself, the English default is shown. Keys you can add to `i18n.js`: `ws_tab_releases`, `ws_tab_videos`, `ws_tab_downloads`, `ws_tab_notice`, `ws_tab_users`, `ws_tabs_label`, `ws_view_only`, `ws_no_access`. The ported page content is English, as it was on the website. |
| `me.role` / `me.web_perms` | `main_admin` gets edit on everything. Otherwise each section's tab shows only when its perm is not `none`, and `view` hides every save, upload, delete and remove control and disables those inputs. Users shows only for `main_admin`, whatever `web_perms` says. |
| `window.plDialog.confirm` | Used for every delete or remove confirmation. If it is missing, a scoped fallback modal is used. The file never calls `alert`, `confirm` or `prompt`. |

**The server must enforce the same perms.** Hiding a button in the UI is not security, so the hooks must check `view`/`edit` per section on the POST routes.

## 4. Endpoints called (the existing ones are unchanged)

| View | Method and path | Body |
|---|---|---|
| Release upload | GET `/api/pl/site/admin/releases` | (none) |
| | POST `/api/pl/site/admin/releases/settings` | `{ mode: "downloads"\|"hidden", settings, dryRun? }` (dry run first; a second call only after the delete confirmation) |
| | POST `/api/pl/site/admin/releases/delete` | `{ list: "history"\|"outdated", index, date }` or `{ list: "outdatedAll" }` |
| | POST `/api/pl/site/admin/releases/upload-init` | `{ date, name, size }` returns `{ uploadId, chunkSize, chunks }` |
| | POST `/api/pl/site/admin/releases/upload-chunk?id=<uploadId>&index=<n>` | raw bytes, `Content-Type: application/octet-stream`, via XHR with `Authorization: token()`; 3 retries on a network or 5xx error |
| | POST `/api/pl/site/admin/releases/upload-finish` | `{ uploadId }` returns `{ file }` |
| | POST `/api/pl/site/admin/releases/publish` | `{ date, windows?: {file, version}, android?: {file, version}, playStoreUrl? }` |
| Website Videos | GET / POST `/api/pl/site/admin/videos` | POST `{ videos: [...] }` |
| Download analytics | GET `/api/pl/site/admin/download-stats` | (read only; the view shows New downloads and Updates tabs, charts, By country, Recent clicks and the Duplicate email jump) |
| Notice | GET / POST `/api/pl/site/admin/notice` | POST `{ message, enabled }` |
| Users (main admin) | GET `/api/pl/web-users` | The list may be an array, `{items}`, `{users}` or `{list}`. Each row uses `{id, email, role?, web_perms, disabled, pending?/status?}`. |
| | (list) | The `{users, invites}` response is used. Pending invites are shown as rows with read-only switches, "Pending (expires …)" and a Revoke button. |
| | POST `/api/pl/web-users/revoke-invite` | `{ id }` (the invite id). It asks for confirmation through plDialog with danger styling. |
| | POST `/api/pl/web-users/audit/delete` | `{ id }` for one record, or `{ ids: [...] }` in chunks of 200. Used by the per-row Delete and by "Delete selected" (checkboxes, with a select-all box in the header). Each asks for confirmation through plDialog with danger styling. |
| | POST `/api/pl/web-users/delete` | `{ id }` (the user id). It asks for confirmation through plDialog with danger styling. A 404 shows "Delete not available on the server yet". The main admin row has no Delete button. |
| | GET `/api/pl/web-users/audit` | `{items}` (last 200) are shown in a collapsible "Recent activity" card with the fields time/at/ts, actor/by/email, action/event/type and target/detail. A 404 or 403 hides the card. |
| | POST `/api/pl/web-users/invite` | `{ email, web_perms }` returns `{ link }` (`url` is also accepted). The view shows the link with a Copy button and the note "one-time, valid 24 hours". |
| | POST `/api/pl/web-users/update` | `{ id, web_perms, disabled }`. `web_perms` keeps any keys the user already had. `users` is always sent as `none`. |
| | GET `/api/pl/site/admin/admins` | Old `admins.json` list, shown read only with the note "no longer gives access". POST is never called. |

If a `/api/pl/web-users*` call returns 404, the view shows "Website user management is not available on this server yet". A 403 shows "Only the main admin can manage website users". All other errors appear in red in the status line at the top of the view.

## 5. Users permission switches

The switch copies the app's `src/components/ui/switch.tsx` (Voucher Settings): a 97×19 track (the app's 88px plus 10%), a 32px pill knob and a 400ms stretch animation.

Each section (Release upload, Website Videos, Download analytics, Notice) is one row with two switches: **View**, then **Edit**. A switch is a `<button role="switch" aria-checked>`, so Tab, Space and Enter all work.
- View off means `none`. The Edit switch is dimmed and cannot be turned on.
- View on with Edit off means `view`.
- View and Edit both on means `edit`. Turning View off also turns Edit off.
- `users` is always sent as `none`. The main admin row is locked to all on.
- Under each email, the user row shows `lastLogin` and `created`.

## 6. Not done here

- No Server UI file was edited. The Hosting and Web Settings pills, routing, i18n keys, the host filter and the auth changes are Server master's work.
- Public website cleanup (removing the admin pages and the Admin Panel button) is a separate step on the laptop `website\` folder.
