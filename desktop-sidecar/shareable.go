// Shareable companies cache + remote auth (electron/localAppServer.js ke barabar).
package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Row = map[string]any

const shareableCacheMs = 4000
const shareableProviderTimeout = 8 * time.Second

func normalizeAccountEmail(v any) string {
	e := strings.ToLower(strings.TrimSpace(jsStr(v)))
	if strings.Contains(e, "@") {
		return e
	}
	return ""
}

func accountEmailMatchesLoginUsername(appEmail string, usernameRaw any) bool {
	email := normalizeAccountEmail(appEmail)
	if email == "" {
		return false
	}
	username := strings.ToLower(strings.TrimSpace(jsStr(usernameRaw)))
	if username == "" {
		return false
	}
	if strings.Contains(username, "@") {
		return normalizeAccountEmail(username) == email
	}
	return email == username+"@gmail.com" || email == username+"@googlemail.com"
}

func arr(v any) []any {
	a, _ := v.([]any)
	return a
}

func asRow(v any) Row {
	m, _ := v.(map[string]any)
	return m
}

func rowID(r Row) string {
	if r == nil {
		return ""
	}
	return strings.TrimSpace(jsStr(r["id"]))
}

func companyAllowsAppAccount(c Row, appEmail string) bool {
	if c == nil || appEmail == "" {
		return false
	}
	email := normalizeAccountEmail(appEmail)
	if email == "" {
		return false
	}
	if normalizeAccountEmail(c["ownerEmail"]) == email || normalizeAccountEmail(c["accessAccount"]) == email {
		return true
	}
	for _, v := range arr(c["accessEmails"]) {
		if normalizeAccountEmail(v) == email {
			return true
		}
	}
	for _, u := range arr(c["localCompanyUsers"]) {
		ur := asRow(u)
		if ur == nil {
			continue
		}
		if normalizeAccountEmail(ur["shareEmail"]) == email {
			return true
		}
		if accountEmailMatchesLoginUsername(email, ur["username"]) {
			return true
		}
	}
	return false
}

func shareableRowHasAccessIdentity(c Row) bool {
	if c == nil {
		return false
	}
	if normalizeAccountEmail(c["ownerEmail"]) != "" || normalizeAccountEmail(c["accessAccount"]) != "" {
		return true
	}
	for _, v := range arr(c["accessEmails"]) {
		if normalizeAccountEmail(v) != "" {
			return true
		}
	}
	for _, u := range arr(c["localCompanyUsers"]) {
		ur := asRow(u)
		if normalizeAccountEmail(ur["shareEmail"]) != "" {
			return true
		}
		username := strings.ToLower(strings.TrimSpace(jsStr(ur["username"])))
		if strings.Contains(username, "@") && normalizeAccountEmail(username) != "" {
			return true
		}
		if username != "" && !strings.Contains(username, "@") {
			return true
		}
	}
	return false
}

func publicCompanySummary(c Row, appEmail string) Row {
	out := Row{}
	for k, v := range c {
		if k == "accessEmails" || k == "localCompanyUsers" {
			continue
		}
		out[k] = v
	}
	out["accessAccount"] = appEmail
	return out
}

func companyClientDataDeleteCommands(rows []Row, appEmail string) []any {
	email := normalizeAccountEmail(appEmail)
	out := []any{}
	if email == "" {
		return out
	}
	seen := map[string]bool{}
	for _, c := range rows {
		for _, raw := range arr(c["clientDataDeleteCommands"]) {
			r := asRow(raw)
			if r == nil {
				continue
			}
			target := normalizeAccountEmail(r["targetEmail"])
			cid := strings.TrimSpace(jsStr(r["companyId"]))
			if cid == "" {
				cid = strings.TrimSpace(jsStr(c["id"]))
			}
			id := strings.TrimSpace(jsStr(r["id"]))
			deleteAt, ok := jsNumber(r["deleteAtMs"])
			if r["deleteAtMs"] == nil {
				ok = false
			}
			if id == "" || cid == "" || target != email || !ok {
				continue
			}
			key := cid + ":" + id
			if seen[key] {
				continue
			}
			seen[key] = true
			reqAt := deleteAt
			if n, ok2 := jsNumber(r["requestedAtMs"]); ok2 {
				reqAt = n
			}
			var cname any = nil
			if truthy(r["companyName"]) {
				cname = r["companyName"]
			} else if truthy(c["name"]) {
				cname = c["name"]
			}
			var reqBy any = nil
			if e := normalizeAccountEmail(r["requestedByEmail"]); e != "" {
				reqBy = e
			}
			src := "pl_server"
			if r["source"] == "online" {
				src = "online"
			}
			out = append(out, Row{"id": id, "companyId": cid, "companyName": cname, "targetEmail": target,
				"requestedByEmail": reqBy, "requestedAtMs": reqAt, "deleteAtMs": deleteAt, "source": src, "reason": "unshare"})
		}
	}
	return out
}

func toRows(v any) []Row {
	a := arr(v)
	out := make([]Row, 0, len(a))
	for _, x := range a {
		out = append(out, asRow(x))
	}
	return out
}

func (a *App) rememberGood(rows []Row) {
	usable := []Row{}
	for _, r := range rows {
		if r != nil && truthy(r["id"]) && shareableRowHasAccessIdentity(r) {
			usable = append(usable, r)
		}
	}
	if len(usable) > 0 {
		a.lastGood = usable
	}
}

func filterByHostIDs(all []Row, hostIDs any) []Row {
	ids, isArr := sharedIDsList(hostIDs)
	if !isArr {
		return all
	}
	if len(ids) == 0 {
		return []Row{}
	}
	set := map[string]bool{}
	for _, id := range ids {
		set[id] = true
	}
	out := []Row{}
	for _, c := range all {
		if c != nil && truthy(c["id"]) && set[strings.TrimSpace(jsString(c["id"]))] {
			out = append(out, c)
		}
	}
	return out
}

func cacheKeyFor(cfg map[string]any) string {
	b, _ := json.Marshal(normalizeSharedIDs(cfg["sharedLocalCompanyIds"]))
	return string(b)
}

func (a *App) invokeShareableProvider() []Row {
	type res struct{ rows []Row }
	ch := make(chan res, 1)
	go func() { ch <- res{a.provideShareableCompanies()} }()
	select {
	case r := <-ch:
		return r.rows
	case <-time.After(shareableProviderTimeout):
		return nil
	}
}

// shareableCompaniesForToken(allowedIds, cfg, {forceFresh}).
func (a *App) shareableCompanies(allowedIDs []string, cfg map[string]any, forceFresh bool) []Row {
	hostIDs := normalizeSharedIDs(cfg["sharedLocalCompanyIds"])
	hostList, hostIsArr := sharedIDsList(hostIDs)
	var idSet map[string]bool
	if len(allowedIDs) > 0 {
		idSet = map[string]bool{}
		for _, x := range allowedIDs {
			if s := strings.TrimSpace(x); s != "" {
				idSet[s] = true
			}
		}
	}
	key := cacheKeyFor(cfg)
	now := time.Now().UnixMilli()
	a.shMu.Lock()
	cacheRows, cacheKey, cacheAt := a.cacheRows, a.cacheKey, a.cacheAt
	a.shMu.Unlock()
	var all []Row
	if !forceFresh && cacheRows != nil && cacheKey == key && now-cacheAt < shareableCacheMs {
		all = cacheRows
	} else if a.providersEnabled() {
		if !forceFresh && idSet == nil && hostIsArr && len(hostList) > 0 {
			a.shMu.Lock()
			if a.cacheRows != nil && a.cacheKey == key {
				all = a.cacheRows
			} else if len(a.lastGood) > 0 {
				all = a.lastGood
			}
			a.shMu.Unlock()
			go func() {
				rows := a.invokeShareableProvider()
				if len(rows) > 0 {
					a.shMu.Lock()
					a.rememberGood(rows)
					a.cacheRows, a.cacheKey, a.cacheAt = rows, key, time.Now().UnixMilli()
					a.shMu.Unlock()
				}
			}()
		} else {
			rows := a.invokeShareableProvider()
			a.shMu.Lock()
			if len(rows) > 0 {
				all = rows
				a.rememberGood(rows)
				a.cacheRows, a.cacheKey, a.cacheAt = all, key, now
			} else if len(a.cacheRows) > 0 {
				all = a.cacheRows
			} else if len(a.lastGood) > 0 {
				all = a.lastGood
			} else {
				all = []Row{}
			}
			a.shMu.Unlock()
		}
	}
	a.shMu.Lock()
	defer a.shMu.Unlock()
	if len(all) == 0 && len(a.lastGood) > 0 {
		all = a.lastGood
	}
	a.rememberGood(all)
	all = filterByHostIDs(all, hostIDs)
	filtered := []Row{}
	for _, c := range all {
		if c == nil || !truthy(c["id"]) {
			continue
		}
		if idSet == nil || idSet[strings.TrimSpace(jsString(c["id"]))] {
			filtered = append(filtered, c)
		}
	}
	if len(filtered) > 0 {
		a.rememberGood(filtered)
		return filtered
	}
	var fallback []string
	if idSet == nil && hostIsArr && len(hostList) > 0 {
		fallback = hostList
	} else if len(idSet) > 0 {
		for k := range idSet {
			fallback = append(fallback, k)
		}
	}
	if len(fallback) > 0 {
		fb := make([]any, 0, len(fallback))
		for _, f := range fallback {
			fb = append(fb, f)
		}
		fromLast := []Row{}
		for _, c := range filterByHostIDs(a.lastGood, fb) {
			id := rowID(c)
			if id != "" && (idSet == nil || idSet[id]) {
				fromLast = append(fromLast, c)
			}
		}
		if len(fromLast) > 0 {
			return fromLast
		}
		known := map[string]Row{}
		for _, list := range [][]Row{a.cacheRows, a.lastGood} {
			for _, r := range list {
				if id := rowID(r); id != "" {
					known[id] = r
				}
			}
		}
		enriched := []Row{}
		for _, id := range fallback {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			row := Row{"id": id, "name": id, "storageOption": "local", "ownerEmail": nil}
			if hit := known[id]; hit != nil {
				for k, v := range hit {
					row[k] = v
				}
				row["id"] = id
				name := strings.TrimSpace(jsStr(hit["name"]))
				if name == "" {
					name = id
				}
				row["name"] = name
				row["storageOption"] = "local"
			}
			if shareableRowHasAccessIdentity(row) {
				enriched = append(enriched, row)
			}
		}
		if len(enriched) > 0 {
			a.rememberGood(enriched)
			return enriched
		}
		return []Row{}
	}
	return filtered
}

func matchShareableCompanyRow(reqID string, rows []Row) Row {
	id := strings.TrimSpace(reqID)
	if id == "" {
		return nil
	}
	for _, r := range rows {
		if rowID(r) == id {
			return r
		}
	}
	if i := strings.LastIndex(id, "_"); i > 0 {
		slug := id[:i]
		for _, r := range rows {
			if rowID(r) == slug {
				return r
			}
		}
		for _, r := range rows {
			if strings.HasPrefix(rowID(r), slug+"_") {
				return r
			}
		}
		for _, r := range rows {
			n := strings.TrimSpace(jsStr(r["name"]))
			if n == slug || n == id {
				return r
			}
		}
	}
	for _, r := range rows {
		if r != nil && strings.TrimSpace(jsStr(r["name"])) == id {
			return r
		}
	}
	return nil
}

type authResult struct {
	ok       bool
	open     bool
	ids      []string
	label    any
	resolved string
	err      string
}

func requestAppAccountEmail(r *http.Request) string {
	if e := normalizeAccountEmail(r.Header.Get(hdrAppAccount)); e != "" {
		return e
	}
	return normalizeAccountEmail(r.URL.Query().Get("appAccount"))
}

// Electron: sirf Host header dekhta tha. Yahan Host + asli TCP peer dono loopback hone chahiye
// (LAN client `Host: localhost` bhej kar "open" access na le sake). Legit clients par koi farak nahi.
func isRequestFromLocalhost(r *http.Request) bool {
	h := r.Host
	if i := strings.Index(h, ":"); i >= 0 && !strings.HasPrefix(h, "[") {
		h = h[:i]
	}
	h = strings.ToLower(h)
	if !(h == "localhost" || h == "127.0.0.1") {
		return false
	}
	return remoteIsLoopback(r)
}

func (a *App) authorize(r *http.Request, companyID string) authResult {
	if isRequestFromLocalhost(r) {
		return authResult{ok: true, open: true, resolved: strings.TrimSpace(companyID)}
	}
	email := requestAppAccountEmail(r)
	if email == "" {
		return authResult{err: "missing_app_account"}
	}
	if companyID == "" {
		return authResult{ok: true, label: email}
	}
	a.shMu.Lock()
	rows := a.cacheRows
	a.shMu.Unlock()
	c := matchShareableCompanyRow(companyID, rows)
	if c == nil || !companyAllowsAppAccount(c, email) {
		return authResult{err: "company_not_shared_with_account"}
	}
	id := rowID(c)
	return authResult{ok: true, ids: []string{id}, label: email, resolved: id}
}

func (a *App) authorizeFresh(r *http.Request, cfg map[string]any, companyID string) authResult {
	au := a.authorize(r, companyID)
	if au.ok || au.err == "missing_app_account" {
		return au
	}
	a.shareableCompanies(nil, cfg, true)
	au = a.authorize(r, companyID)
	if au.ok {
		return au
	}
	email := requestAppAccountEmail(r)
	if email == "" || companyID == "" {
		return au
	}
	a.shMu.Lock()
	rows := a.cacheRows
	a.shMu.Unlock()
	if c := matchShareableCompanyRow(companyID, rows); c != nil && companyAllowsAppAccount(c, email) {
		id := rowID(c)
		return authResult{ok: true, ids: []string{id}, label: email, resolved: id}
	}
	return au
}

func sendAuthFailure(w http.ResponseWriter, au authResult, okEnvelope bool) {
	e := au.err
	if e == "" {
		e = "invalid_or_missing_token"
	}
	if okEnvelope {
		writeJSON(w, 403, Row{"ok": false, "error": e}, false)
	} else {
		writeJSON(w, 403, Row{"error": e}, false)
	}
}

// ---- access token (pl_access) helpers ----

var plAccessCookieRe = regexp.MustCompile(`(?:^|;\s*)pl_access=([^;]*)`)

func tokenFromRequest(r *http.Request) string {
	if t := strings.TrimSpace(r.Header.Get(hdrAccess)); t != "" {
		return t
	}
	if t := strings.TrimSpace(r.URL.Query().Get("pl_access")); t != "" {
		return t
	}
	if c := r.Header.Get("Cookie"); c != "" {
		if m := plAccessCookieRe.FindStringSubmatch(c); m != nil && m[1] != "" {
			v := strings.TrimSpace(m[1])
			if d, err := url.QueryUnescape(strings.ReplaceAll(v, "+", "%2B")); err == nil {
				return d
			}
			return v
		}
	}
	return ""
}

func (a *App) attachAccessTokenCookie(w http.ResponseWriter, r *http.Request) {
	tok := tokenFromRequest(r)
	if tok == "" || !a.validateAccessToken(tok) {
		return
	}
	w.Header().Add("Set-Cookie", "pl_access="+encodeURIComponent(tok)+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
}

func encodeURIComponent(s string) string {
	e := url.QueryEscape(s)
	e = strings.ReplaceAll(e, "+", "%20")
	for _, c := range []string{"!", "'", "(", ")", "*"} {
		e = strings.ReplaceAll(e, url.QueryEscape(c), c)
	}
	e = strings.ReplaceAll(e, "%7E", "~")
	return e
}

func isElectronAppRequest(r *http.Request) bool {
	if r.Header.Get(hdrMarker) == markerValue {
		return true
	}
	return len(r.Header.Get(hdrClient)) >= 8
}
