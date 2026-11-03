// Server clients stats (Settings -> Server clients list) — Electron ke barabar, in-memory.
package main

import (
	"encoding/base64"
	"math"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

type clientStat = map[string]any

func remoteIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		h = r.RemoteAddr
	}
	h = strings.TrimPrefix(h, "::ffff:")
	return h
}

func remoteIsLoopback(r *http.Request) bool {
	ip := net.ParseIP(remoteIP(r))
	return ip != nil && ip.IsLoopback()
}

func hashClientLabel(s string) string {
	var h int32
	for _, c := range utf16.Encode([]rune(s)) {
		h = (h << 5) - h + int32(c)
	}
	v := int64(h)
	if v < 0 {
		v = -v
	}
	return strconv.FormatInt(v, 36)
}

var companyPathRe = regexp.MustCompile(`^/__pl_company_(?:delta|mirror)/([^/]+)`)

func requestCompanyID(r *http.Request) string {
	q := r.URL.Query()
	for _, k := range []string{"companyId", "company", "pl_company"} {
		if v := q.Get(k); v != "" {
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
			break
		}
	}
	if m := companyPathRe.FindStringSubmatch(r.URL.EscapedPath()); m != nil {
		if d, err := urlPathUnescape(m[1]); err == nil {
			return strings.TrimSpace(d)
		}
	}
	return ""
}

func requestClientPingMs(r *http.Request) (float64, bool) {
	if v := r.Header.Get(hdrClientPing); v != "" {
		if n, ok := jsNumber(v); ok && n >= 0 {
			return math.Round(n), true
		}
	} else {
		// Number("") === 0 -> Electron header absent par 0 deta (headerValue "" -> 0).
		return 0, true
	}
	if v := r.URL.Query().Get("clientPingMs"); v != "" {
		if n, ok := jsNumber(v); ok && n >= 0 {
			return math.Round(n), true
		}
	}
	return 0, false
}

func requestDeviceLabel(r *http.Request) string {
	ua := strings.ToLower(r.Header.Get("User-Agent"))
	if r.Header.Get(hdrMarker) == markerValue {
		return "EXE"
	}
	switch {
	case strings.Contains(ua, "capacitor") || strings.Contains(ua, "wv"):
		return "APK/WebView"
	case strings.Contains(ua, "android"):
		return "Android"
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") || strings.Contains(ua, "ios"):
		return "iOS"
	case strings.Contains(ua, "edg/"):
		return "Edge"
	case strings.Contains(ua, "chrome/"):
		return "Chrome"
	case strings.Contains(ua, "firefox/"):
		return "Firefox"
	}
	return "Web"
}

func base64PayloadByteLength(v string) int {
	raw := strings.TrimSpace(v)
	if raw == "" {
		return 0
	}
	if i := strings.Index(raw, ","); i >= 0 {
		raw = raw[i+1:]
	}
	raw = strings.Join(strings.Fields(raw), "")
	raw = strings.TrimRight(raw, "=")
	if raw == "" {
		return 0
	}
	return base64.RawStdEncoding.DecodedLen(len(raw))
}

func numOr0(v any) float64 {
	n, ok := jsNumber(v)
	if !ok {
		return 0
	}
	return n
}

func (a *App) companyNameForStats(cid string) any {
	if cid == "" {
		return nil
	}
	a.shMu.Lock()
	defer a.shMu.Unlock()
	for _, r := range a.cacheRows {
		if rowID(r) == cid && truthy(r["name"]) {
			return jsString(r["name"])
		}
	}
	return nil
}

func emailUser(e string) string {
	if i := strings.Index(e, "@"); i >= 0 {
		return e[:i]
	}
	return e
}

// stMu pakad kar call karo.
func (a *App) statsIdentity(r *http.Request, companyID string) (key, ip, email, fp, ckey string) {
	ip = remoteIP(r)
	email = requestAppAccountEmail(r)
	ipPart := ip
	if ipPart == "" {
		ipPart = "unknown"
	}
	fp = ipPart + "|" + hashClientLabel(r.Header.Get("User-Agent"))
	ckey = strings.TrimSpace(companyID)
	if ckey == "" {
		ckey = "no_company"
	}
	emailPart := email
	if emailPart == "" {
		emailPart = "anon"
	}
	key = emailPart + "|" + fp + "|" + ckey
	if email == "" {
		for k, row := range a.stats {
			ck := jsStr(row["companyKey"])
			if ck == "" {
				ck = "no_company"
			}
			if truthy(row["email"]) && row["deviceFingerprint"] == fp && ck == ckey {
				key = k
				break
			}
		}
	} else {
		anonKey := "anon|" + fp + "|" + ckey
		if anon, ok := a.stats[anonKey]; ok {
			if _, exists := a.stats[key]; !exists {
				n := clientStat{}
				for k, v := range anon {
					n[k] = v
				}
				n["key"], n["email"], n["user"] = key, email, emailUser(email)
				if !truthy(n["device"]) {
					n["device"] = requestDeviceLabel(r)
				}
				a.stats[key] = n
			} else {
				prev := a.stats[key]
				prev["downloadBytes"] = numOr0(prev["downloadBytes"]) + numOr0(anon["downloadBytes"])
				prev["uploadBytes"] = numOr0(prev["uploadBytes"]) + numOr0(anon["uploadBytes"])
				prev["requestCount"] = numOr0(prev["requestCount"]) + numOr0(anon["requestCount"])
			}
			delete(a.stats, anonKey)
		}
	}
	return
}

type trafficOpts struct {
	companyID   string
	pingMs      *float64
	uploadBytes float64
}

func (a *App) recordTraffic(r *http.Request, download float64, o trafficOpts) {
	ip := remoteIP(r)
	email := requestAppAccountEmail(r)
	if isRequestFromLocalhost(r) && email == "" {
		return
	}
	if ip == "" && email == "" {
		return
	}
	cid := strings.TrimSpace(o.companyID)
	if cid == "" {
		cid = requestCompanyID(r)
	}
	cname := a.companyNameForStats(cid)
	a.stMu.Lock()
	defer a.stMu.Unlock()
	key, _, _, fp, ckey := a.statsIdentity(r, cid)
	var ping any = nil
	if o.pingMs != nil {
		ping = *o.pingMs
	} else if p, ok := requestClientPingMs(r); ok {
		ping = p
	}
	prev, ok := a.stats[key]
	if !ok {
		var em, us any
		if email != "" {
			em, us = email, emailUser(email)
		}
		prev = clientStat{"key": key, "email": em, "user": us, "ip": ip, "device": requestDeviceLabel(r),
			"deviceFingerprint": fp, "companyKey": ckey, "companyIds": []any{}, "companyNames": []any{},
			"pingMs": nil, "downloadBytes": 0.0, "uploadBytes": 0.0, "requestCount": 0.0, "lastSeenAtMs": 0.0}
	}
	ids := append([]any{}, arr(prev["companyIds"])...)
	names := append([]any{}, arr(prev["companyNames"])...)
	if cid != "" && !containsAny(ids, cid) {
		ids = append(ids, cid)
	}
	if cname != nil && !containsAny(names, cname) {
		names = append(names, cname)
	}
	n := clientStat{}
	for k, v := range prev {
		n[k] = v
	}
	if email != "" {
		n["email"], n["user"] = email, emailUser(email)
	}
	if ip != "" {
		n["ip"] = ip
	}
	if !truthy(n["device"]) {
		n["device"] = requestDeviceLabel(r)
	}
	n["deviceFingerprint"], n["companyKey"] = fp, ckey
	n["companyIds"], n["companyNames"] = ids, names
	if ping != nil {
		n["pingMs"] = ping
	}
	n["downloadBytes"] = numOr0(prev["downloadBytes"]) + math.Max(0, download)
	n["uploadBytes"] = numOr0(prev["uploadBytes"]) + math.Max(0, o.uploadBytes)
	n["requestCount"] = numOr0(prev["requestCount"]) + 1
	n["lastSeenAtMs"] = float64(time.Now().UnixMilli())
	a.stats[key] = n
}

func containsAny(list []any, v any) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (a *App) recordDownload(r *http.Request, bytes float64, companyID string) {
	if bytes <= 0 {
		return
	}
	ip := remoteIP(r)
	email := requestAppAccountEmail(r)
	if ip == "" && email == "" {
		return
	}
	cid := companyID
	if cid == "" {
		cid = requestCompanyID(r)
	}
	a.stMu.Lock()
	key, _, _, _, _ := a.statsIdentity(r, cid)
	prev, ok := a.stats[key]
	if ok {
		prev["downloadBytes"] = numOr0(prev["downloadBytes"]) + bytes
		prev["lastSeenAtMs"] = float64(time.Now().UnixMilli())
	}
	a.stMu.Unlock()
	if !ok {
		a.recordTraffic(r, bytes, trafficOpts{})
	}
}

func (a *App) listClientStats() []any {
	a.stMu.Lock()
	defer a.stMu.Unlock()
	cutoff := float64(time.Now().Add(-24 * time.Hour).UnixMilli())
	rows := []clientStat{}
	for k, row := range a.stats {
		if numOr0(row["lastSeenAtMs"]) < cutoff {
			delete(a.stats, k)
			continue
		}
		c := clientStat{}
		for kk, v := range row {
			c[kk] = v
		}
		rows = append(rows, c)
	}
	sort.SliceStable(rows, func(i, j int) bool { return numOr0(rows[i]["lastSeenAtMs"]) > numOr0(rows[j]["lastSeenAtMs"]) })
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}
