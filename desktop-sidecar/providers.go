// Server-data bridge providers — electron/main.js runInServerAppRenderer & co ka port.
// Webview kaam Rust karta hai (rpc: candidates / eval / bridgeOpen / broadcast).
package main

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	toVouchers   = 120 * time.Second
	toCollection = 45 * time.Second
	toBundle     = 90 * time.Second
	toBridgeFn   = 12 * time.Second
)

const bridgeNotReadyMsg = "Server data bridge is not ready. On the server PC keep Pocket Ledger open (or wait ~10s after starting sharing), then try again."

type candidate struct {
	ID      string `json:"id"`
	URL     string `json:"url"`
	Loading bool   `json:"loading"`
	Bridge  bool   `json:"bridge"`
}

var appOriginRe = regexp.MustCompile(`(?i)^https?://(localhost|127\.0\.0\.1)(:|/|$)`)

func (c candidate) ready() bool {
	u := strings.TrimSpace(c.URL)
	return !c.Loading && u != "" && u != "about:blank" && appOriginRe.MatchString(u)
}

func (c candidate) label() string {
	if c.Bridge {
		return "bridge"
	}
	if appOriginRe.MatchString(c.URL) {
		return "main-window"
	}
	return "wc-" + c.ID
}

func (a *App) providersEnabled() bool { return a.rpc != nil && a.rpc.enabled }

func jsq(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func (a *App) candidates() []candidate {
	raw, err := a.rpc.call("candidates", nil, 5*time.Second)
	if err != nil {
		return nil
	}
	var list []candidate
	_ = json.Unmarshal(raw, &list)
	sort.SliceStable(list, func(i, j int) bool {
		si, sj := 1, 1
		if appOriginRe.MatchString(list[i].URL) {
			si = 0
		}
		if appOriginRe.MatchString(list[j].URL) {
			sj = 0
		}
		if si != sj {
			return si < sj
		}
		return !list[i].Bridge && list[j].Bridge
	})
	return list
}

func (a *App) candidateByID(id string) (candidate, bool) {
	for _, c := range a.candidates() {
		if c.ID == id {
			return c, true
		}
	}
	return candidate{}, false
}

type evalRes struct {
	OK    bool            `json:"ok"`
	Value json.RawMessage `json:"value"`
	Undef bool            `json:"undef"`
}

// executeJavaScriptWithTimeout: nil = undefined / timeout / not ready.
func (a *App) execJS(c candidate, script string, timeout time.Duration, checkReady bool) json.RawMessage {
	if checkReady {
		cur, ok := a.candidateByID(c.ID)
		if !ok || !cur.ready() {
			return nil
		}
	}
	raw, err := a.rpc.call("eval", map[string]any{"id": c.ID, "script": script, "timeoutMs": timeout.Milliseconds()}, timeout+2*time.Second)
	if err != nil {
		return nil
	}
	var r evalRes
	if json.Unmarshal(raw, &r) != nil || !r.OK || r.Undef {
		return nil
	}
	return r.Value
}

func isNullish(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return s == "" || s == "null"
}

func rawIsTrue(raw json.RawMessage) bool { return strings.TrimSpace(string(raw)) == "true" }

func rawIsArray(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return strings.HasPrefix(s, "[")
}

func rawIsObject(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return strings.HasPrefix(s, "{") || strings.HasPrefix(s, "[")
}

func rawObj(raw json.RawMessage) map[string]any {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

func fnCheck(name string) string { return "typeof window[" + jsq(name) + "] === \"function\"" }

func (a *App) waitForFn(c candidate, fn string, timeout time.Duration) bool {
	start := time.Now()
	for time.Since(start) < timeout {
		cur, ok := a.candidateByID(c.ID)
		if !ok {
			return false
		}
		if !cur.ready() {
			time.Sleep(300 * time.Millisecond)
			continue
		}
		if rawIsTrue(a.execJS(cur, fnCheck(fn), toBridgeFn, false)) {
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

// ---- hidden bridge (Electron ka serverDataBridgeWindow) ----

func (a *App) ensureBridge() (candidate, bool) {
	a.bridgeMu.Lock()
	if a.bridgeWait != nil {
		ch := a.bridgeWait
		a.bridgeMu.Unlock()
		<-ch
		a.bridgeMu.Lock()
		c, ok := a.bridgeLast, a.bridgeLastOK
		a.bridgeMu.Unlock()
		return c, ok
	}
	ch := make(chan struct{})
	a.bridgeWait = ch
	a.bridgeMu.Unlock()
	c, ok := a.ensureBridgeInner()
	a.bridgeMu.Lock()
	a.bridgeLast, a.bridgeLastOK, a.bridgeWait = c, ok, nil
	a.bridgeMu.Unlock()
	close(ch)
	return c, ok
}

func (a *App) ensureBridgeInner() (candidate, bool) {
	if !a.providersEnabled() {
		return candidate{}, false
	}
	cfg := a.loadConfig()
	if !shouldHost(cfg) || !cfgBool(cfg, "userWantsRunning") {
		return candidate{}, false
	}
	port := a.appUIPort()
	if port == 0 {
		return candidate{}, false
	}
	bridgeURL := "http://localhost:" + strconv.Itoa(port) + "/?pl_server_data_bridge=1"
	raw, err := a.rpc.call("bridgeOpen", map[string]any{"url": bridgeURL, "navigate": false}, 35*time.Second)
	if err != nil {
		return candidate{}, false
	}
	var c candidate
	if json.Unmarshal(raw, &c) != nil || c.ID == "" {
		return candidate{}, false
	}
	onLocal, canonical := false, false
	if u, err := parseURL(c.URL); err == nil {
		h := u.Hostname()
		q := u.Query()
		onLocal = (h == "localhost" || h == "127.0.0.1") && u.Port() == strconv.Itoa(port) && q.Get("pl_remote_client") != "1"
		canonical = onLocal && q.Get("pl_server_data_bridge") == "1"
	}
	if !canonical && onLocal && !c.Loading {
		if rawIsTrue(a.execJS(c, `typeof window.__plListShareableLocalCompanies === "function" && typeof window.__plExportCompanyDeltaCollection === "function"`, toBridgeFn, true)) {
			return c, true
		}
	}
	if !canonical {
		raw, err = a.rpc.call("bridgeOpen", map[string]any{"url": bridgeURL, "navigate": true}, 35*time.Second)
		if err == nil {
			_ = json.Unmarshal(raw, &c)
		}
	}
	a.waitForFn(c, "__plListShareableLocalCompanies", 25*time.Second)
	a.waitForFn(c, "__plExportCompanyDeltaCollection", toBridgeFn)
	return c, true
}

const warmBridgeScript = `(async () => {
  try {
    if (typeof window.__plWarmServerDataBridge !== "function") return { ok: false, error: "no_warm_fn" };
    return await window.__plWarmServerDataBridge();
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : "warm_failed" };
  }
})()`

func (a *App) warmBridgeBestEffort() {
	go func() {
		c, ok := a.ensureBridge()
		if !ok {
			return
		}
		a.execJS(c, warmBridgeScript, toBundle, true)
	}()
}

func (a *App) orderExportCandidates(list []candidate, companyID string) []candidate {
	cid := jsq(strings.TrimSpace(companyID))
	probe := `(async () => {
    try {
      if (typeof window.__plProbeDeltaExportCompany !== "function") return { ok: false, reason: "no_probe" };
      return await window.__plProbeDeltaExportCompany(` + cid + `);
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : "probe_error" };
    }
  })()`
	type sc struct {
		c     candidate
		score int
	}
	scored := []sc{}
	for _, c := range list {
		if !c.ready() {
			scored = append(scored, sc{c, -1})
			continue
		}
		res := rawObj(a.execJS(c, probe, toBridgeFn, true))
		if res != nil && res["ok"] == true {
			scored = append(scored, sc{c, 2})
		} else {
			scored = append(scored, sc{c, 1})
		}
	}
	sort.SliceStable(scored, func(i, j int) bool { return scored[i].score > scored[j].score })
	out := make([]candidate, len(scored))
	for i, s := range scored {
		out[i] = s.c
	}
	return out
}

func readyOnly(list []candidate) []candidate {
	out := []candidate{}
	for _, c := range list {
		if c.ready() {
			out = append(out, c)
		}
	}
	return out
}

type runOpts struct {
	requireFn string
	accept    func(json.RawMessage) bool
	companyID string
	timeout   time.Duration
}

func (a *App) runInServerAppRenderer(script string, o runOpts) json.RawMessage {
	if !a.providersEnabled() {
		return nil
	}
	if o.timeout <= 0 {
		o.timeout = toCollection
	}
	accept := o.accept
	if accept == nil {
		accept = func(r json.RawMessage) bool { return !isNullish(r) }
	}
	go a.ensureBridge()
	cands := readyOnly(a.candidates())
	if strings.TrimSpace(o.companyID) != "" {
		cands = a.orderExportCandidates(cands, o.companyID)
	}
	for _, c := range cands {
		if o.requireFn != "" && !rawIsTrue(a.execJS(c, fnCheck(o.requireFn), toBridgeFn, true)) {
			continue
		}
		if res := a.execJS(c, script, o.timeout, true); accept(res) {
			return res
		}
	}
	if o.requireFn != "" {
		if b, ok := a.ensureBridge(); ok {
			a.waitForFn(b, o.requireFn, toBridgeFn)
			if res := a.execJS(b, script, o.timeout, true); accept(res) {
				return res
			}
		}
	}
	return nil
}

func (a *App) broadcastScript(script string) {
	if !a.providersEnabled() {
		return
	}
	_, _ = a.rpc.call("broadcast", map[string]any{"script": script}, 10*time.Second)
}

func (a *App) broadcastDbBump(companyID, collection string) {
	script := `(function(){
    try {
      if (typeof window.__plInvalidateBrowserDbCache === "function") window.__plInvalidateBrowserDbCache();
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("pocket-ledger-browser-db-bump", {
        detail: {
          companyId: ` + jsq(companyID) + `,
          collection: ` + jsq(collection) + `,
          immediate: true,
          source: "pl_host_remote_write"
        }
      }));
    } catch (e) {}
  })()`
	a.broadcastScript(script)
}

func (a *App) broadcastGateSnapshot(snapshot map[string]any) {
	if snapshot == nil {
		return
	}
	if _, ok := snapshot["gates"].([]any); !ok {
		return
	}
	a.broadcastScript(`(function(){
    try {
      const snap = ` + jsq(snapshot) + `;
      if (typeof window.__plApplyGateStoreSnapshot === "function") {
        window.__plApplyGateStoreSnapshot(snap);
      } else {
        window.dispatchEvent(new Event("pl-gate-changed"));
      }
    } catch (e) {}
  })()`)
}

// ---- mirror metrics ----

func (a *App) noteMirror(companyID, key string) {
	cid := strings.TrimSpace(companyID)
	if cid == "" {
		return
	}
	a.mmMu.Lock()
	defer a.mmMu.Unlock()
	row := a.mirrorSync[cid]
	if row == nil {
		row = map[string]int64{}
		a.mirrorSync[cid] = row
	}
	row[key] = time.Now().UnixMilli()
}

func (a *App) mirrorMsAgo(companyID, key string) any {
	a.mmMu.Lock()
	defer a.mmMu.Unlock()
	row := a.mirrorSync[strings.TrimSpace(companyID)]
	if row == nil || row[key] == 0 {
		return nil
	}
	d := time.Now().UnixMilli() - row[key]
	if d < 0 {
		d = 0
	}
	return d
}

func (a *App) mirrorHealthEnvelope(companyID string, extra map[string]any) map[string]any {
	out := map[string]any{
		"mirrorProtocol":                mirrorProtocolVersion,
		"serverBuild":                   a.serverBuild(),
		"lastSuccessfulMirrorPushMsAgo": a.mirrorMsAgo(companyID, "lastPushAt"),
		"lastSuccessfulMirrorPullMsAgo": a.mirrorMsAgo(companyID, "lastExportAt"),
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func (a *App) serverBuild() string {
	if a.version != "" {
		return a.version
	}
	return "unknown"
}

func docTimeMs(d map[string]any) float64 {
	raw := d["updatedAt"]
	if raw == nil {
		raw = d["lastEditedAt"]
	}
	if raw == nil {
		raw = d["createdAt"]
	}
	switch t := raw.(type) {
	case float64:
		return t
	case string:
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z07:00", "2006-01-02"} {
			if p, err := time.Parse(layout, t); err == nil {
				return float64(p.UnixMilli())
			}
		}
	case map[string]any:
		if s, ok := t["seconds"].(float64); ok {
			n, _ := t["nanoseconds"].(float64)
			return s*1000 + math.Floor(n/1e6)
		}
	}
	return 0
}

func mirrorFingerprint(docs []map[string]any) string {
	type e struct{ id, line string }
	list := make([]e, 0, len(docs))
	for _, d := range docs {
		id := jsString(orEmpty(d["id"]))
		upd := d["updatedAt"]
		if upd == nil {
			upd = d["lastEditedAt"]
		}
		del := "0"
		if d["isDeleted"] == true || d["deleted"] == true {
			del = "1"
		}
		list = append(list, e{id, id + "|" + jsString(orEmpty(upd)) + "|" + del})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].id < list[j].id })
	lines := make([]string, len(list))
	for i, x := range list {
		lines[i] = x.line
	}
	h := sha1.Sum([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(h[:])[:8]
}

func orEmpty(v any) any {
	if v == nil {
		return ""
	}
	return v
}

type exportScore struct {
	Count            int     `json:"count"`
	MaxUpdatedAt     float64 `json:"maxUpdatedAt"`
	RendererPriority int     `json:"rendererPriority"`
}

func scoreBetter(c exportScore, cur *exportScore) bool {
	if cur == nil {
		return true
	}
	if c.Count != cur.Count {
		return c.Count > cur.Count
	}
	if c.MaxUpdatedAt != cur.MaxUpdatedAt {
		return c.MaxUpdatedAt > cur.MaxUpdatedAt
	}
	return c.RendererPriority > cur.RendererPriority
}

func scoreDocs(raw json.RawMessage, label string) (exportScore, []map[string]any) {
	var docs []map[string]any
	_ = json.Unmarshal(raw, &docs)
	var mx float64
	for _, d := range docs {
		if ms := docTimeMs(d); ms > mx {
			mx = ms
		}
	}
	p := 2
	if label == "bridge" {
		p = 1
	}
	return exportScore{len(docs), mx, p}, docs
}

type exportMeta struct {
	suspicious  bool
	renderer    string
	fingerprint string
	score       exportScore
	exportMs    int64
	count       int
	best        candidate
}

func rawArrayLen(raw json.RawMessage) int {
	var a []json.RawMessage
	if json.Unmarshal(raw, &a) != nil {
		return -1
	}
	return len(a)
}

func (a *App) mirrorCollectionExport(companyID, collection string, timeout time.Duration) (json.RawMessage, *exportMeta) {
	started := time.Now()
	cid, col := strings.TrimSpace(companyID), strings.TrimSpace(collection)
	if cid == "" || col == "" || !a.providersEnabled() {
		return nil, nil
	}
	exportScript := `(async () => {
    try {
      if (typeof window.__plExportCompanyDeltaCollection !== "function") return null;
      return await window.__plExportCompanyDeltaCollection(` + jsq(cid) + `, ` + jsq(col) + `);
    } catch (_) {
      return null;
    }
  })()`
	partiesScript := ""
	if col == "vouchers" {
		partiesScript = `(async () => {
    try {
      if (typeof window.__plExportCompanyDeltaCollection !== "function") return null;
      return await window.__plExportCompanyDeltaCollection(` + jsq(cid) + `, "parties");
    } catch (_) {
      return null;
    }
  })()`
	}
	go a.ensureBridge()
	cands := a.orderExportCandidates(readyOnly(a.candidates()), cid)
	suspicious := false
	var bestRaw json.RawMessage
	var bestScore *exportScore
	var bestDocs []map[string]any
	var bestC candidate
	bestLabel := ""
	for _, c := range cands {
		if !rawIsTrue(a.execJS(c, `typeof window.__plExportCompanyDeltaCollection === "function"`, toBridgeFn, true)) {
			continue
		}
		label := c.label()
		res := a.execJS(c, exportScript, timeout, true)
		if !rawIsArray(res) {
			continue
		}
		if col == "vouchers" && rawArrayLen(res) == 0 && partiesScript != "" {
			if p := a.execJS(c, partiesScript, timeout, true); rawIsArray(p) && rawArrayLen(p) > 0 {
				suspicious = true
				continue
			}
		}
		sc, docs := scoreDocs(res, label)
		if scoreBetter(sc, bestScore) {
			s := sc
			bestScore, bestRaw, bestDocs, bestC, bestLabel = &s, res, docs, c, label
		}
	}
	if bestRaw == nil {
		if b, ok := a.ensureBridge(); ok {
			a.waitForFn(b, "__plExportCompanyDeltaCollection", toBridgeFn)
			label := b.label()
			if res := a.execJS(b, exportScript, timeout, true); rawIsArray(res) {
				if col == "vouchers" && rawArrayLen(res) == 0 && partiesScript != "" {
					if p := a.execJS(b, partiesScript, timeout, true); rawIsArray(p) && rawArrayLen(p) > 0 {
						suspicious = true
					}
				}
				if !suspicious {
					sc, docs := scoreDocs(res, label)
					bestScore, bestRaw, bestDocs, bestC, bestLabel = &sc, res, docs, b, label
				}
			}
		}
	}
	if bestRaw != nil {
		return bestRaw, &exportMeta{renderer: bestLabel, fingerprint: mirrorFingerprint(bestDocs), score: *bestScore,
			exportMs: time.Since(started).Milliseconds(), count: len(bestDocs), best: bestC}
	}
	if suspicious {
		return nil, &exportMeta{suspicious: true}
	}
	return nil, nil
}

func collectionTimeout(col string) time.Duration {
	if strings.TrimSpace(col) == "vouchers" {
		return toVouchers
	}
	return toCollection
}

// Ek waqt me ek export (renderer SQLite deadlock se bachao).
func (a *App) enqueueExport(f func() any) any {
	a.exportMu.Lock()
	defer a.exportMu.Unlock()
	return f()
}

func bundleScript(cid string) string {
	return `(async () => {
      try {
        if (typeof window.__plExportCompanyDeltaBundle !== "function") return null;
        return await window.__plExportCompanyDeltaBundle(` + jsq(cid) + `);
      } catch (_) {
        return null;
      }
    })()`
}

// ---- providers (localAppServer set*Provider ke barabar) ----

func (a *App) provideHealth(companyID string) map[string]any {
	cid := strings.TrimSpace(companyID)
	if cid == "" {
		return a.mirrorHealthEnvelope(cid, map[string]any{"ok": false, "error": "missing_company_id"})
	}
	docs, meta := a.mirrorCollectionExport(cid, "vouchers", toVouchers)
	a.mmMu.Lock()
	fb := a.bundleFallbackCount
	a.mmMu.Unlock()
	if meta == nil || docs == nil || meta.suspicious {
		e := "export_unavailable"
		if meta != nil && meta.suspicious {
			e = "suspicious_empty_vouchers"
		}
		return a.mirrorHealthEnvelope(cid, map[string]any{"ok": false, "error": e, "mirror_bundle_fallback_count": fb})
	}
	a.noteMirror(cid, "lastExportAt")
	var dbOpen any = nil
	if rawIsTrue(a.execJS(meta.best, `typeof window.__plDeltaHealthDbOpenMs === "function"`, toBridgeFn, false)) {
		var n float64
		if v := a.execJS(meta.best, `window.__plDeltaHealthDbOpenMs()`, toBridgeFn, false); json.Unmarshal(v, &n) == nil {
			dbOpen = n
		}
	}
	return a.mirrorHealthEnvelope(cid, map[string]any{"ok": true, "companyId": cid, "renderer": meta.renderer,
		"fingerprint": meta.fingerprint, "voucherCount": meta.count, "cacheReload": true, "dbOpenMs": dbOpen,
		"exportMs": meta.exportMs, "score": meta.score, "mirror_bundle_fallback_count": fb})
}

func (a *App) loadSnapshot() []Row {
	m, err := readJSONFile(filepath.Join(a.userData, snapshotFile))
	if err != nil {
		return []Row{}
	}
	out := []Row{}
	for _, x := range arr(m["companies"]) {
		row := asRow(x)
		id := strings.TrimSpace(jsStr(row["id"]))
		if row == nil || id == "" {
			continue
		}
		name := strings.TrimSpace(jsStr(row["name"]))
		if !truthy(row["name"]) || name == "" {
			name = id
		}
		r := Row{"id": id, "name": name, "storageOption": "local", "ownerEmail": row["ownerEmail"]}
		if v, ok := row["accessEmails"].([]any); ok {
			r["accessEmails"] = v
		}
		if v, ok := row["localCompanyUsers"].([]any); ok {
			r["localCompanyUsers"] = v
		}
		if row["planId"] != nil && strings.TrimSpace(jsString(row["planId"])) != "" {
			r["planId"] = strings.TrimSpace(jsString(row["planId"]))
		}
		if v, ok := row["planExpiryMs"].(float64); ok {
			r["planExpiryMs"] = v
		}
		if v, ok := row["offlineLicenseValidUntilMs"].(float64); ok {
			r["offlineLicenseValidUntilMs"] = v
		}
		if v, ok := row["requiresLogin"].(bool); ok {
			r["requiresLogin"] = v
		}
		if row["usernameHint"] != nil {
			if s := strings.TrimSpace(jsString(row["usernameHint"])); s != "" {
				r["usernameHint"] = s
			} else {
				r["usernameHint"] = nil
			}
		}
		out = append(out, r)
	}
	return out
}

func (a *App) saveSnapshot(rows []any) {
	if rows == nil {
		rows = []any{}
	}
	b, err := json.MarshalIndent(map[string]any{"updatedAt": nowISO(), "companies": rows}, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(a.userData, snapshotFile), b, 0o600)
}

func (a *App) provideShareableCompanies() []Row {
	snap := a.loadSnapshot()
	res := a.runInServerAppRenderer(`(async () => {
      try {
        if (typeof window.__plListShareableLocalCompanies !== "function") return [];
        return await window.__plListShareableLocalCompanies();
      } catch (_) {
        return [];
      }
    })()`, runOpts{requireFn: "__plListShareableLocalCompanies", accept: rawIsArray})
	var rows []any
	if rawIsArray(res) && json.Unmarshal(res, &rows) == nil && len(rows) > 0 {
		a.saveSnapshot(rows)
		return toRows(rows)
	}
	return snap
}

func loginScript(cid, user, pass string) string {
	return `(async () => {
      try {
        if (typeof window.__plValidateLocalCompanyLogin !== "function") {
          return { ok: false, error: "bridge_missing" };
        }
        return await window.__plValidateLocalCompanyLogin(` + jsq(cid) + `, ` + jsq(user) + `, ` + jsq(pass) + `);
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "Login failed" };
      }
    })()`
}

func hasKey(raw json.RawMessage, k string) bool {
	m := rawObj(raw)
	if m == nil {
		return false
	}
	_, ok := m[k]
	return ok
}

func (a *App) provideLogin(cid, user, pass string) map[string]any {
	script := loginScript(cid, user, pass)
	from := rawObj(a.runInServerAppRenderer(script, runOpts{requireFn: "__plValidateLocalCompanyLogin",
		accept: func(r json.RawMessage) bool { return hasKey(r, "ok") }}))
	if from != nil {
		if from["ok"] == true {
			return from
		}
		if truthy(from["error"]) && from["error"] != "bridge_missing" {
			return map[string]any{"ok": false, "error": jsString(from["error"])}
		}
	}
	last := "Invalid username or password"
	b, ok := a.ensureBridge()
	if !ok {
		return map[string]any{"ok": false, "error": bridgeNotReadyMsg}
	}
	a.waitForFn(b, "__plValidateLocalCompanyLogin", 12*time.Second)
	if res := rawObj(a.execJS(b, script, 60*time.Second, false)); res != nil {
		if res["ok"] == true {
			return res
		}
		if truthy(res["error"]) {
			last = jsString(res["error"])
		}
	}
	if last == "bridge_missing" {
		return map[string]any{"ok": false, "error": bridgeNotReadyMsg}
	}
	return map[string]any{"ok": false, "error": last}
}

func (a *App) provideLoginMeta(cid string, appEmail string) json.RawMessage {
	var em any = nil
	if appEmail != "" {
		em = appEmail
	}
	script := `(async () => {
      try {
        if (typeof window.__plGetCompanyLoginMeta !== "function") {
          return { requiresLogin: true, usernameHint: null };
        }
        return await window.__plGetCompanyLoginMeta(` + jsq(cid) + `, ` + jsq(em) + `);
      } catch (_) {
        return { requiresLogin: true, usernameHint: null };
      }
    })()`
	def := json.RawMessage(`{"requiresLogin":true,"usernameHint":null}`)
	if r := a.runInServerAppRenderer(script, runOpts{requireFn: "__plGetCompanyLoginMeta",
		accept: func(r json.RawMessage) bool { return hasKey(r, "requiresLogin") }}); r != nil {
		return r
	}
	b, ok := a.ensureBridge()
	if !ok {
		return def
	}
	a.waitForFn(b, "__plGetCompanyLoginMeta", 12*time.Second)
	if r := a.execJS(b, script, 60*time.Second, false); r != nil && strings.HasPrefix(strings.TrimSpace(string(r)), "{") {
		return r
	}
	return def
}

func (a *App) provideBundle(cid string) json.RawMessage {
	out := a.enqueueExport(func() any {
		r := a.runInServerAppRenderer(bundleScript(cid), runOpts{requireFn: "__plExportCompanyDeltaBundle", timeout: toBundle, companyID: cid})
		if r != nil && strings.HasPrefix(strings.TrimSpace(string(r)), "{") || rawIsArray(r) {
			return r
		}
		return json.RawMessage(nil)
	})
	return out.(json.RawMessage)
}

func (a *App) provideCollection(cid, col string) json.RawMessage {
	out := a.enqueueExport(func() any {
		col := strings.TrimSpace(col)
		if rows, _ := a.mirrorCollectionExport(cid, col, collectionTimeout(col)); rows != nil {
			a.noteMirror(cid, "lastExportAt")
			return rows
		}
		b := a.runInServerAppRenderer(bundleScript(cid), runOpts{requireFn: "__plExportCompanyDeltaBundle", timeout: toBundle, companyID: cid})
		var bundle struct {
			Collections map[string]json.RawMessage `json:"collections"`
		}
		if b != nil && json.Unmarshal(b, &bundle) == nil {
			if v, ok := bundle.Collections[col]; ok && rawIsArray(v) {
				a.mmMu.Lock()
				a.bundleFallbackCount++
				a.mmMu.Unlock()
				a.noteMirror(cid, "lastExportAt")
				return v
			}
		}
		return json.RawMessage(nil)
	})
	return out.(json.RawMessage)
}

type blob struct {
	data        []byte
	contentType string
}

func (a *App) provideAttachmentRead(cid, ref string) *blob {
	p := rawObj(a.runInServerAppRenderer(`(async () => {
      try {
        if (typeof window.__plReadAttachmentBlob !== "function") return null;
        return await window.__plReadAttachmentBlob(`+jsq(cid)+`, `+jsq(ref)+`);
      } catch (_) {
        return null;
      }
    })()`, runOpts{requireFn: "__plReadAttachmentBlob"}))
	if p == nil {
		return nil
	}
	ct := "application/octet-stream"
	if truthy(p["contentType"]) {
		ct = jsString(p["contentType"])
	}
	relRaw := p["relativePath"]
	if !truthy(relRaw) {
		relRaw = p["filePath"]
	}
	rel := strings.ReplaceAll(jsString(orEmpty(relRaw)), "\\", "/")
	rel = strings.TrimSpace(strings.TrimLeft(rel, "/"))
	if rel != "" && !strings.Contains(rel, "..") && !strings.Contains(rel, ":") {
		primary := filepath.Join(a.userData, "PocketLedgerData", filepath.FromSlash(rel))
		legacy := filepath.Join(a.userData, "pl-attachments", filepath.FromSlash(rel))
		full := legacy
		if _, err := os.Stat(primary); err == nil {
			full = primary
		}
		if b, err := os.ReadFile(full); err == nil && len(b) > 0 {
			return &blob{b, ct}
		}
	}
	if !truthy(p["base64"]) {
		return nil
	}
	b, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(jsString(p["base64"])), ""))
	if err != nil {
		b, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(jsString(p["base64"]), "="))
	}
	if err != nil || len(b) == 0 {
		return nil
	}
	return &blob{b, ct}
}

func (a *App) provideAttachmentWrite(cid string, body map[string]any) map[string]any {
	r := rawObj(a.runInServerAppRenderer(`(async () => {
      try {
        if (typeof window.__plPutPendingAttachmentFromRemote !== "function") {
          return { ok: false, error: "bridge_missing" };
        }
        return await window.__plPutPendingAttachmentFromRemote(`+jsq(cid)+`, `+jsq(body)+`);
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "write_failed" };
      }
    })()`, runOpts{requireFn: "__plPutPendingAttachmentFromRemote"}))
	if r == nil {
		return map[string]any{"ok": false, "error": "write_failed"}
	}
	return r
}

func (a *App) providePush(cid, col string, docs []any, hostSelfPublish bool) map[string]any {
	if hostSelfPublish {
		a.noteMirror(cid, "lastPushAt")
		a.broadcastDbBump(cid, col)
		return map[string]any{"ok": true, "applied": 0, "skipped": len(docs), "received": len(docs), "hostSelfPublish": true,
			"mirrorProtocol": mirrorProtocolVersion, "serverBuild": a.serverBuild()}
	}
	r := rawObj(a.runInServerAppRenderer(`(async () => {
      try {
        if (typeof window.__plUpsertCompanyDeltaDocs !== "function") return { ok: false, error: "bridge_missing" };
        return await window.__plUpsertCompanyDeltaDocs(`+jsq(cid)+`, `+jsq(col)+`, `+jsq(docs)+`);
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "push_failed" };
      }
    })()`, runOpts{requireFn: "__plUpsertCompanyDeltaDocs"}))
	if r == nil {
		r = map[string]any{"ok": false, "error": "push_failed"}
	}
	if truthy(r["ok"]) {
		a.noteMirror(cid, "lastPushAt")
		a.broadcastDbBump(cid, col)
	}
	r["mirrorProtocol"] = mirrorProtocolVersion
	r["serverBuild"] = a.serverBuild()
	return r
}

func (a *App) provideAuthoritativeUpsert(payload map[string]any) map[string]any {
	cid := strings.TrimSpace(jsString(orEmpty(payload["companyId"])))
	col := strings.TrimSpace(jsString(orEmpty(payload["collectionName"])))
	r := rawObj(a.runInServerAppRenderer(`(async () => {
      try {
        if (typeof window.__plHostBridgeCompanyDocUpsert !== "function") return { ok: false, error: "bridge_missing" };
        return await window.__plHostBridgeCompanyDocUpsert(`+jsq(payload)+`);
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "bridge_upsert_failed" };
      }
    })()`, runOpts{requireFn: "__plHostBridgeCompanyDocUpsert"}))
	if r == nil {
		return map[string]any{"ok": false, "error": "bridge_upsert_failed"}
	}
	if truthy(r["ok"]) && r["written"] != false && payload["notify"] != false && cid != "" && col != "" {
		a.broadcastDbBump(cid, col)
	}
	return r
}
