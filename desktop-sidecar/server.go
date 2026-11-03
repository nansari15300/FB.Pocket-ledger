// HTTP routes — electron/localAppServer.js createRequestHandler ka port.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, v any, noStore bool) {
	b, err := json.Marshal(v)
	if err != nil {
		b = []byte(`{"error":"encode_failed"}`)
	}
	writeRawJSON(w, status, b, noStore)
}

func writeRawJSON(w http.ResponseWriter, status int, b []byte, noStore bool) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	if noStore {
		h.Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

const maxJSONBody = 64 << 20

func readJSONBody(r *http.Request) (map[string]any, error) {
	b, err := io.ReadAll(io.LimitReader(r.Body, maxJSONBody))
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(b)) == 0 {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

func applyCors(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	if o := r.Header.Get("Origin"); o != "" {
		h.Set("Access-Control-Allow-Origin", o)
		h.Add("Vary", "Origin")
	} else {
		h.Set("Access-Control-Allow-Origin", "*")
	}
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Accept, Content-Type, x-pocket-ledger-access, x-pocket-ledger-app, x-pocket-ledger-client, x-pocket-ledger-app-account, x-pocket-ledger-client-ping-ms")
	h.Set("Access-Control-Max-Age", "86400")
}

func urlPathUnescape(s string) (string, error) { return url.PathUnescape(s) }

func (a *App) withTimeout(d time.Duration, f func() any) (any, bool) {
	ch := make(chan any, 1)
	go func() {
		defer func() {
			if p := recover(); p != nil {
				log.Printf("provider panic: %v", p)
				ch <- errProviderPanic
			}
		}()
		ch <- f()
	}()
	select {
	case v := <-ch:
		return v, true
	case <-time.After(d):
		return nil, false
	}
}

var errProviderPanic = errors.New("provider_panic")

var (
	reCollection = regexp.MustCompile(`^/__pl_company_(?:delta|mirror)/([^/]+)/([^/]+)/?$`)
	reBundle     = regexp.MustCompile(`^/__pl_company_(?:delta|mirror)/([^/]+)/?$`)
)

type srvKind int

const (
	kindAppUI srvKind = iota
	kindSharing
)

func (a *App) handler(kind srvKind) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// App UI server: sirf loopback + localhost Host (DNS-rebinding guard). Sharing server: Electron jaisa open.
		if kind == kindAppUI {
			if !remoteIsLoopback(r) || !hostAllowed(r.Host) {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
		}
		defer func() {
			if p := recover(); p != nil {
				log.Printf("handler panic %s: %v", r.URL.Path, p)
				http.Error(w, "Internal Server Error", 500)
			}
		}()
		a.route(w, r)
	})
}

func hostAllowed(host string) bool {
	h := strings.ToLower(host)
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	h = strings.Trim(h, "[]")
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func (a *App) route(w http.ResponseWriter, r *http.Request) {
	cfg := a.loadConfig()
	p := r.URL.EscapedPath()
	if p == "" {
		p = "/"
	}
	q := r.URL.Query()
	if (strings.HasPrefix(p, "/__pl_") || p == "/api/pl-server-http-relay") && p != "/__pl_server_ping" {
		a.recordTraffic(r, 0, trafficOpts{})
	}
	switch {
	case p == "/api/pl-server-http-relay":
		a.handleRelay(w, r)
		return
	case p == "/__firebase_blob_proxy":
		a.handleFirebaseProxy(w, r)
		return
	case p == "/__pl_server_ping":
		a.handlePing(w, r, cfg)
		return
	case p == "/__pl_access_context":
		a.handleAccessContext(w, r, cfg)
		return
	case p == "/__pl_company_delta_events" || p == "/__pl_company_mirror_events":
		a.handleSSE(w, r, cfg)
		return
	case p == "/__pl_delta_health" || p == "/__pl_mirror_health":
		a.handleHealth(w, r, cfg)
		return
	case p == "/__pl_attachment":
		a.handleAttachment(w, r, cfg)
		return
	case p == "/__pl_company_delta_push" || p == "/__pl_company_mirror_push":
		a.handlePush(w, r)
		return
	case p == "/__pl_company_meta_bump":
		a.handleMetaBump(w, r)
		return
	case p == "/__pl_company_registry_patch":
		a.handleRegistryPatch(w, r)
		return
	case p == "/__pl_authoritative_company_doc_upsert":
		a.handleAuthoritativeUpsert(w, r)
		return
	case p == "/__pl_company_login_meta":
		a.handleLoginMeta(w, r, cfg)
		return
	case p == "/__pl_company_login":
		a.handleCompanyLogin(w, r)
		return
	}
	if m := reCollection.FindStringSubmatch(p); m != nil {
		a.handleCollectionExport(w, r, cfg, m[1], m[2])
		return
	}
	if m := reBundle.FindStringSubmatch(p); m != nil {
		a.handleBundleExport(w, r, cfg, m[1])
		return
	}
	_ = q
	a.handleFallthrough(w, r, cfg)
}

func (a *App) handleFallthrough(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	if shouldHost(cfg) && !cfgBool(cfg, "userWantsRunning") && !isRequestFromLocalhost(r) && !isElectronAppRequest(r) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(503)
		_, _ = io.WriteString(w, `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem"><h1>Server stopped</h1><p>The owner turned off remote sharing. Try again later.</p></body></html>`)
		return
	}
	a.attachAccessTokenCookie(w, r)
	if shouldRedirectToRemoteClient(r) { // Electron parity: localhost bhi redirect (renderer flag strip karta hai)
		q := r.URL.Query()
		q.Set("pl_remote_client", "1")
		loc := r.URL.EscapedPath() + "?" + q.Encode()
		if r.URL.Fragment != "" {
			loc += "#" + r.URL.EscapedFragment()
		}
		w.Header().Set("Location", loc)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(302)
		return
	}
	a.serveStatic(w, r)
}

// ---- relay ----

func relayPathAllowed(p string) bool {
	return strings.HasPrefix(p, "/__pl_") || strings.HasPrefix(p, "/__firebase_blob_proxy")
}

func (a *App) handleRelay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"}, false)
		return
	}
	body, err := readJSONBody(r)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "Invalid JSON body"}, false)
		return
	}
	rawURL := strings.TrimSpace(jsStr(body["url"]))
	target, err := url.Parse(rawURL)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || !relayPathAllowed(target.EscapedPath()) {
		writeJSON(w, 400, map[string]any{"error": "Invalid or disallowed PL server URL"}, false)
		return
	}
	method := strings.ToUpper(strings.TrimSpace(jsStr(body["method"])))
	if method == "" {
		method = "GET"
	}
	if method != "GET" && method != "POST" {
		writeJSON(w, 400, map[string]any{"error": "Only GET and POST are supported"}, false)
		return
	}
	headers := http.Header{"Accept": {"application/json"}}
	if hm, ok := body["headers"].(map[string]any); ok {
		for k, v := range hm {
			k = strings.TrimSpace(k)
			if k == "" || strings.EqualFold(k, "host") {
				continue
			}
			sv := ""
			if v != nil {
				sv = jsString(v)
			}
			headers.Set(k, sv)
		}
	}
	var reqBody []byte
	if method == "POST" && body["body"] != nil {
		reqBody = []byte(jsString(body["body"]))
	}
	binary := body["responseMode"] == "binary"
	cands := []string{}
	port := target.Port()
	if port == "" {
		port = "80"
		if target.Scheme == "https" {
			port = "443"
		}
	}
	if port == "3001" || port == "37123" {
		lb := "http://127.0.0.1:" + port + target.EscapedPath() + searchOf(target)
		if lb != rawURL {
			cands = append(cands, lb)
		}
	}
	cands = append(cands, rawURL)
	var lastErr error
	timedOut := false
	for _, c := range cands {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		req, err := http.NewRequestWithContext(ctx, method, c, bytes.NewReader(reqBody))
		if err != nil {
			cancel()
			lastErr = err
			continue
		}
		req.Header = headers.Clone()
		resp, err := relayClient.Do(req)
		if err != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				timedOut = true
			}
			cancel()
			lastErr = err
			continue
		}
		ct := resp.Header.Get("Content-Type")
		if binary {
			data, rerr := io.ReadAll(io.LimitReader(resp.Body, 12*1024*1024+1))
			resp.Body.Close()
			cancel()
			if rerr != nil {
				lastErr = rerr
				continue
			}
			if len(data) > 12*1024*1024 {
				writeJSON(w, 413, map[string]any{"error": "Attachment too large for relay"}, false)
				return
			}
			var ctv any = nil
			if ct != "" {
				ctv = ct
			}
			writeJSON(w, 200, map[string]any{"status": resp.StatusCode, "bodyBase64": base64.StdEncoding.EncodeToString(data), "contentType": ctv}, false)
			return
		}
		data, rerr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBody))
		resp.Body.Close()
		cancel()
		if rerr != nil {
			lastErr = rerr
			continue
		}
		writeJSON(w, 200, map[string]any{"status": resp.StatusCode, "body": string(data)}, false)
		return
	}
	_ = lastErr
	msg := "Cannot reach host server — verify public IP, port forwarding, and firewall."
	if timedOut {
		msg = "Host server timed out — check that sharing is on and the address is reachable from the internet."
	}
	writeJSON(w, 502, map[string]any{"error": msg}, false)
}

func searchOf(u *url.URL) string {
	if u.RawQuery == "" {
		return ""
	}
	return "?" + u.RawQuery
}

var relayClient = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		return nil
	},
}

// ---- firebase proxy: jaan-boojh kar NOT SUPPORTED ----
// Pocket Ledger se Firebase poori tarah hataya ja raha hai (sab PocketBase par; kaam "Firebase Master" bot ka).
// Isliye Electron ka `/__firebase_blob_proxy` yahan port nahi kiya — saaf 501 jawab deta hai.

func (a *App) handleFirebaseProxy(w http.ResponseWriter, r *http.Request) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	writeJSON(w, 501, map[string]any{
		"ok":     false,
		"error":  "firebase-not-supported",
		"detail": "Firebase blob proxy is not available in the Tauri desktop app (Firebase is being removed; use PocketBase).",
	}, false)
}

// ---- ping / access context ----

func (a *App) handlePing(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	ping, ok := requestClientPingMs(r)
	cid := requestCompanyID(r)
	if ok || cid != "" {
		o := trafficOpts{companyID: cid}
		if ok {
			o.pingMs = &ping
		}
		a.recordTraffic(r, 0, o)
	}
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	var sp, au any = nil, nil
	if p := a.sharingPort(); p != 0 {
		sp = p
	} else if p := a.appUIPort(); p != 0 {
		sp = p
	} else if v, ok := validPort(cfg["port"]); ok {
		sp = v
	}
	if p := a.appUIPort(); p != 0 {
		au = p
	} else if v, ok := validPort(cfg["appUiPort"]); ok {
		au = v
	}
	writeJSON(w, 200, map[string]any{"ok": true, "ping": true, "sharingPort": sp, "appUiPort": au, "ts": time.Now().UnixMilli()}, true)
}

func (a *App) handleAccessContext(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"}, false)
		return
	}
	au := a.authorize(r, "")
	if !au.ok {
		sendAuthFailure(w, au, false)
		return
	}
	if au.open {
		rows := a.shareableCompanies(nil, cfg, true)
		writeJSON(w, 200, map[string]any{"unrestricted": true, "allowedCompanyIds": nil, "label": nil, "companies": rowsAny(rows)}, true)
		return
	}
	email := requestAppAccountEmail(r)
	rows := a.shareableCompanies(au.ids, cfg, true)
	allowed := []Row{}
	for _, c := range rows {
		if companyAllowsAppAccount(c, email) {
			allowed = append(allowed, c)
		}
	}
	ids := []any{}
	comps := []any{}
	for _, c := range allowed {
		ids = append(ids, jsString(c["id"]))
		comps = append(comps, publicCompanySummary(c, email))
	}
	var label any = nil
	if truthy(au.label) {
		label = au.label
	}
	writeJSON(w, 200, map[string]any{"label": label, "allowedCompanyIds": ids, "companies": comps,
		"clientDataDeleteCommands": companyClientDataDeleteCommands(rows, email)}, true)
}

func rowsAny(rows []Row) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}

func trimDecode(s string) string {
	if d, err := url.PathUnescape(s); err == nil {
		s = d
	}
	return strings.TrimSpace(s)
}

// ---- SSE ----

type sseClient struct {
	companyID string
	ch        chan []byte
}

func (a *App) handleSSE(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	cid := strings.TrimSpace(r.URL.Query().Get("companyId"))
	if cid == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_company_id"}, false)
		return
	}
	au := a.authorizeFresh(r, cfg, cid)
	if !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	resolved := au.resolved
	if resolved == "" {
		resolved = cid
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", 500)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-store, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)
	now := time.Now().UnixMilli()
	fmt.Fprintf(w, ": connected %d\n\n", now)
	ready, _ := json.Marshal(map[string]any{"companyId": resolved, "at": now})
	fmt.Fprintf(w, "event: ready\ndata: %s\n\n", ready)
	fl.Flush()
	c := &sseClient{companyID: resolved, ch: make(chan []byte, 64)}
	a.sseMu.Lock()
	a.sse[c] = struct{}{}
	a.sseMu.Unlock()
	defer func() {
		a.sseMu.Lock()
		delete(a.sse, c)
		a.sseMu.Unlock()
	}()
	t := time.NewTicker(25 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-a.shutdown:
			return
		case <-t.C:
			if _, err := fmt.Fprintf(w, "event: ping\ndata: %d\n\n", time.Now().UnixMilli()); err != nil {
				return
			}
			fl.Flush()
		case msg := <-c.ch:
			if _, err := w.Write(msg); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func (a *App) broadcastChange(companyID, collection, source string, docs []any, extra map[string]any) {
	cid := strings.TrimSpace(companyID)
	if cid == "" {
		return
	}
	if source == "" {
		source = "pl_server_write"
	}
	payload := map[string]any{"companyId": cid, "collection": collection, "source": source}
	if docs != nil {
		payload["docs"] = docs
	}
	for k, v := range extra {
		payload[k] = v
	}
	payload["at"] = time.Now().UnixMilli()
	b, _ := json.Marshal(payload)
	msg := []byte("event: change\ndata: " + string(b) + "\n\n")
	a.sseMu.Lock()
	defer a.sseMu.Unlock()
	for c := range a.sse {
		if c.companyID != cid {
			continue
		}
		select {
		case c.ch <- msg:
		default:
		}
	}
}

// ---- health / exports ----

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	cid := strings.TrimSpace(r.URL.Query().Get("companyId"))
	if cid == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_company_id"}, false)
		return
	}
	au := a.authorizeFresh(r, cfg, cid)
	if !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"ok": false, "error": "delta_health_unavailable"}, false)
		return
	}
	res := au.resolved
	if res == "" {
		res = cid
	}
	v, _ := a.withTimeout(10*time.Minute, func() any { return a.provideHealth(res) })
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "delta_health_failed"}, false)
		return
	}
	if m, ok := v.(map[string]any); ok && m != nil {
		writeJSON(w, 200, m, true)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": false}, true)
}

func (a *App) handleCollectionExport(w http.ResponseWriter, r *http.Request, cfg map[string]any, rawCid, rawCol string) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"}, false)
		return
	}
	cid, col := trimDecode(rawCid), trimDecode(rawCol)
	if cid == "" || col == "" {
		writeJSON(w, 400, map[string]any{"error": "missing_company_or_collection"}, false)
		return
	}
	au := a.authorizeFresh(r, cfg, cid)
	if !au.ok {
		sendAuthFailure(w, au, false)
		return
	}
	if au.resolved != "" {
		cid = au.resolved
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"error": "delta_collection_export_unavailable"}, false)
		return
	}
	to := 50 * time.Second
	if col == "vouchers" {
		to = 125 * time.Second
	}
	v, done := a.withTimeout(to, func() any { return a.provideCollection(cid, col) })
	if !done {
		writeJSON(w, 504, map[string]any{"error": "delta_collection_export_timeout"}, false)
		return
	}
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"error": "delta_collection_export_failed"}, false)
		return
	}
	docs, _ := v.(json.RawMessage)
	if docs == nil {
		writeJSON(w, 404, map[string]any{"error": "company_or_collection_not_found"}, false)
		return
	}
	colJSON, _ := json.Marshal(col)
	out := append(append(append([]byte(`{"collection":`), colJSON...), []byte(`,"docs":`)...), docs...)
	out = append(out, '}')
	writeRawJSON(w, 200, out, true)
}

func (a *App) handleBundleExport(w http.ResponseWriter, r *http.Request, cfg map[string]any, rawCid string) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"}, false)
		return
	}
	cid := trimDecode(rawCid)
	if cid == "" {
		writeJSON(w, 400, map[string]any{"error": "missing_company_id"}, false)
		return
	}
	au := a.authorizeFresh(r, cfg, cid)
	if !au.ok {
		sendAuthFailure(w, au, false)
		return
	}
	if au.resolved != "" {
		cid = au.resolved
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"error": "delta_export_unavailable"}, false)
		return
	}
	v, done := a.withTimeout(95*time.Second, func() any { return a.provideBundle(cid) })
	if !done {
		writeJSON(w, 504, map[string]any{"error": "delta_export_timeout"}, false)
		return
	}
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"error": "delta_export_failed"}, false)
		return
	}
	b, _ := v.(json.RawMessage)
	if b == nil {
		writeJSON(w, 404, map[string]any{"error": "company_not_found"}, false)
		return
	}
	writeRawJSON(w, 200, b, true)
}

// ---- attachments ----

func (a *App) validateAttachmentAccess(r *http.Request, cfg map[string]any, cid string) authResult {
	au := a.authorize(r, cid)
	if au.ok || au.err != "company_not_shared_with_account" {
		return au
	}
	email := requestAppAccountEmail(r)
	rows := a.shareableCompanies(nil, cfg, true)
	for _, c := range rows {
		if rowID(c) == strings.TrimSpace(cid) && companyAllowsAppAccount(c, email) {
			return authResult{ok: true, ids: []string{rowID(c)}, label: email, resolved: rowID(c)}
		}
	}
	return au
}

func (a *App) handleAttachment(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	q := r.URL.Query()
	if r.Method == http.MethodPost {
		body, err := readJSONBody(r)
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "invalid_json"}, false)
			return
		}
		cid := strings.TrimSpace(firstStr(body["companyId"], q.Get("companyId")))
		id := strings.TrimSpace(firstStr(body["id"], q.Get("ref")))
		action := strings.ToLower(strings.TrimSpace(jsStr(body["action"])))
		b64 := strings.TrimSpace(firstStr(body["base64"], body["blob"]))
		if cid == "" || id == "" || (action != "delete" && b64 == "") {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_fields"}, false)
			return
		}
		if au := a.validateAttachmentAccess(r, cfg, cid); !au.ok {
			sendAuthFailure(w, au, false)
			return
		}
		if !a.providersEnabled() {
			writeJSON(w, 503, map[string]any{"ok": false, "error": "attachment_write_unavailable"}, false)
			return
		}
		pb := map[string]any{"id": id}
		if action == "delete" {
			pb["action"] = "delete"
		} else {
			pb["base64"] = b64
		}
		for k, v := range map[string]any{
			"sha256Hex":   firstAny(body["sha256Hex"], body["sha256"]),
			"contentType": body["contentType"], "fileName": body["fileName"], "storagePathPrefix": body["storagePathPrefix"],
			"docPath": body["docPath"], "field": body["field"],
		} {
			if v != nil {
				pb[k] = v
			}
		}
		v, _ := a.withTimeout(10*time.Minute, func() any { return a.provideAttachmentWrite(cid, pb) })
		out, _ := v.(map[string]any)
		if v == errProviderPanic || out == nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": "attachment_write_failed"}, false)
			return
		}
		if !truthy(out["ok"]) {
			e := "attachment_write_failed"
			if truthy(out["error"]) {
				e = jsString(out["error"])
			}
			writeJSON(w, 500, map[string]any{"ok": false, "error": e}, false)
			return
		}
		if action != "delete" {
			a.recordTraffic(r, 0, trafficOpts{companyID: cid, uploadBytes: float64(base64PayloadByteLength(b64))})
		}
		writeJSON(w, 200, map[string]any{"ok": true, "deduped": out["deduped"] == true, "deleted": action == "delete"}, false)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"}, false)
		return
	}
	cid := strings.TrimSpace(q.Get("companyId"))
	ref := strings.TrimSpace(q.Get("ref"))
	if cid == "" || ref == "" {
		writeJSON(w, 400, map[string]any{"error": "missing_fields"}, false)
		return
	}
	if au := a.validateAttachmentAccess(r, cfg, cid); !au.ok {
		sendAuthFailure(w, au, false)
		return
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"error": "attachment_read_unavailable"}, false)
		return
	}
	v, _ := a.withTimeout(10*time.Minute, func() any { return a.provideAttachmentRead(cid, ref) })
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"error": "attachment_read_failed"}, false)
		return
	}
	bl, _ := v.(*blob)
	if bl == nil || len(bl.data) == 0 {
		writeJSON(w, 404, map[string]any{"error": "attachment_not_found"}, false)
		return
	}
	h := w.Header()
	h.Set("Content-Type", bl.contentType)
	h.Set("Content-Length", strconv.Itoa(len(bl.data)))
	h.Set("Cache-Control", "private, max-age=120")
	if r.Method == http.MethodHead {
		w.WriteHeader(200)
		return
	}
	h.Set("Access-Control-Expose-Headers", "Content-Type, Content-Length")
	w.WriteHeader(200)
	_, _ = w.Write(bl.data)
	a.recordDownload(r, float64(len(bl.data)), cid)
}

func firstStr(vals ...any) string {
	for _, v := range vals {
		if s := jsStr(v); s != "" {
			return s
		}
	}
	return ""
}

func firstAny(vals ...any) any {
	for _, v := range vals {
		if truthy(v) {
			return v
		}
	}
	return nil
}

// ---- push / bump / patch / upsert ----

func (a *App) handlePush(w http.ResponseWriter, r *http.Request) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	body, err := readJSONBody(r)
	if err != nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "delta_push_failed"}, false)
		return
	}
	cid := strings.TrimSpace(jsStr(body["companyId"]))
	col := strings.TrimSpace(jsStr(body["collection"]))
	docs, _ := body["docs"].([]any)
	if cid == "" || col == "" || len(docs) == 0 {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_fields"}, false)
		return
	}
	if au := a.authorize(r, cid); !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	ev := evaluateMirrorProtocol(body["mirrorProtocol"], mirrorProtocolVersion)
	if ev.Action == "reject" {
		// Electron parity: write accept, client queue stuck na ho.
		log.Printf("[DeltaProtocol] accepting legacy push %s %s", ev.Code, ev.Message)
	}
	if ev.Action == "warn" {
		log.Printf("[DeltaProtocol] %s %s", ev.Code, ev.Message)
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"ok": false, "error": "delta_push_unavailable"}, false)
		return
	}
	self := body["hostSelfPublish"] == true
	v, _ := a.withTimeout(10*time.Minute, func() any { return a.providePush(cid, col, docs, self) })
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "delta_push_failed"}, false)
		return
	}
	res, _ := v.(map[string]any)
	if res == nil || res["ok"] != false {
		if self {
			a.broadcastChange(cid, col, "pl_host_self_publish", docs, nil)
		} else {
			a.broadcastChange(cid, col, "pl_client_push", nil, nil)
		}
	}
	if res == nil {
		res = map[string]any{"ok": true}
	}
	writeJSON(w, 200, res, true)
}

func (a *App) handleMetaBump(w http.ResponseWriter, r *http.Request) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	body, err := readJSONBody(r)
	if err != nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "company_meta_bump_failed"}, false)
		return
	}
	cid := strings.TrimSpace(jsStr(body["companyId"]))
	if cid == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_company_id"}, false)
		return
	}
	if au := a.authorize(r, cid); !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	var extra map[string]any
	if c, ok := body["company"].(map[string]any); ok {
		extra = map[string]any{"company": c}
	}
	a.broadcastChange(cid, "company_meta", "pl_host_company_meta", nil, extra)
	writeJSON(w, 200, map[string]any{"ok": true}, false)
}

func (a *App) handleRegistryPatch(w http.ResponseWriter, r *http.Request) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	body, err := readJSONBody(r)
	if err != nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "registry_patch_failed"}, false)
		return
	}
	cid := strings.TrimSpace(jsStr(body["companyId"]))
	units := []any{}
	for _, u := range arr(body["customUnits"]) {
		if s, ok := u.(string); ok && strings.TrimSpace(s) != "" {
			units = append(units, s)
		}
	}
	if cid == "" || len(units) == 0 {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_fields"}, false)
		return
	}
	if au := a.authorize(r, cid); !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	// Electron main.js me registry patch provider set nahi hota -> hamesha 503.
	writeJSON(w, 503, map[string]any{"ok": false, "error": "registry_patch_unavailable"}, false)
}

func (a *App) handleAuthoritativeUpsert(w http.ResponseWriter, r *http.Request) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	body, err := readJSONBody(r)
	if err != nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "authoritative_upsert_failed"}, false)
		return
	}
	cid := strings.TrimSpace(jsStr(body["companyId"]))
	col := strings.TrimSpace(jsStr(body["collectionName"]))
	docID := strings.TrimSpace(jsStr(body["docId"]))
	data, ok := body["data"].(map[string]any)
	if cid == "" || col == "" || docID == "" || !ok {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_fields"}, false)
		return
	}
	if au := a.authorize(r, cid); !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"ok": false, "error": "authoritative_upsert_unavailable"}, false)
		return
	}
	payload := map[string]any{"companyId": cid, "collectionName": col, "docId": docID, "data": data,
		"notify": body["notify"] != false, "skipCloudSyncEnqueue": body["skipCloudSyncEnqueue"] == true,
		"skipPlanMutationGate": body["skipPlanMutationGate"] == true, "force": body["force"] == true}
	v, _ := a.withTimeout(10*time.Minute, func() any { return a.provideAuthoritativeUpsert(payload) })
	res, _ := v.(map[string]any)
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "authoritative_upsert_failed"}, false)
		return
	}
	if res == nil || res["ok"] != false {
		a.broadcastChange(cid, col, "pl_authoritative_upsert", nil, nil)
	}
	if res == nil {
		res = map[string]any{"ok": true}
	}
	writeJSON(w, 200, res, true)
}

// ---- server login ----

func (a *App) handleLoginMeta(w http.ResponseWriter, r *http.Request, cfg map[string]any) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, 405, map[string]any{"error": "method_not_allowed"}, false)
		return
	}
	cid := strings.TrimSpace(r.URL.Query().Get("companyId"))
	if cid == "" {
		writeJSON(w, 400, map[string]any{"error": "missing_company_id"}, false)
		return
	}
	email := strings.TrimSpace(r.URL.Query().Get("appEmail"))
	if au := a.authorize(r, cid); !au.ok {
		sendAuthFailure(w, au, false)
		return
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"error": "server_login_meta_unavailable"}, false)
		return
	}
	v, _ := a.withTimeout(10*time.Minute, func() any { return a.provideLoginMeta(cid, email) })
	if v == errProviderPanic {
		writeJSON(w, 500, map[string]any{"error": "login_meta_failed"}, false)
		return
	}
	b, _ := v.(json.RawMessage)
	if isNullish(b) || !strings.HasPrefix(strings.TrimSpace(string(b)), "{") {
		b = json.RawMessage(`{"requiresLogin":true,"usernameHint":null}`)
	}
	writeRawJSON(w, 200, b, true)
}

func (a *App) handleCompanyLogin(w http.ResponseWriter, r *http.Request) {
	applyCors(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"ok": false, "error": "method_not_allowed"}, false)
		return
	}
	body, err := readJSONBody(r)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "bad_request"}, false)
		return
	}
	cid := strings.TrimSpace(jsStr(body["companyId"]))
	user := strings.TrimSpace(jsStr(body["username"]))
	pass := strings.TrimSpace(jsStr(body["password"]))
	if cid == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "missing_company_id"}, false)
		return
	}
	if au := a.authorize(r, cid); !au.ok {
		sendAuthFailure(w, au, true)
		return
	}
	if !a.providersEnabled() {
		writeJSON(w, 503, map[string]any{"ok": false, "error": "server_login_unavailable"}, false)
		return
	}
	v, done := a.withTimeout(60*time.Second, func() any { return a.provideLogin(cid, user, pass) })
	var out map[string]any
	if !done {
		out = map[string]any{"ok": false, "error": "server_login_provider_timeout"}
	} else if m, ok := v.(map[string]any); ok {
		out = m
	}
	if v == errProviderPanic {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "bad_request"}, false)
		return
	}
	if out == nil || out["ok"] != true {
		e := "Invalid username or password"
		if out != nil && truthy(out["error"]) {
			e = jsString(out["error"])
		}
		writeJSON(w, 401, map[string]any{"ok": false, "error": e}, false)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "token": out["token"], "user": out["user"]}, true)
}
