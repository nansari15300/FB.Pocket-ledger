// electron/localAppServerAccessTokens.js ka Go port (same file: pl-server-access-tokens.json).
package main

import (
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
)

const accessTokensFile = "pl-server-access-tokens.json"

func (a *App) tokensPath() string { return filepath.Join(a.userData, accessTokensFile) }

func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// JS String.slice(0,n) UTF-16 units ke hisaab se.
func jsSlice(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

func normalizeCompanyIDs(raw any) []any {
	out := []any{}
	arr, ok := raw.([]any)
	if !ok {
		return out
	}
	seen := map[string]bool{}
	for _, id := range arr {
		s := strings.TrimSpace(jsStr(id))
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
		if len(out) >= 200 {
			break
		}
	}
	return out
}

func normalizeInvitedEmails(raw any) []any {
	out := []any{}
	arr, ok := raw.([]any)
	if !ok {
		return out
	}
	seen := map[string]bool{}
	for _, e := range arr {
		s := strings.ToLower(strings.TrimSpace(jsStr(e)))
		if s == "" || !strings.Contains(s, "@") || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
		if len(out) >= 50 {
			break
		}
	}
	return out
}

func (a *App) loadTokenStore() []map[string]any {
	m, err := readJSONFile(a.tokensPath())
	if err != nil {
		return []map[string]any{}
	}
	arr, _ := m["tokens"].([]any)
	out := make([]map[string]any, 0, len(arr))
	for _, t := range arr {
		if r, ok := t.(map[string]any); ok {
			out = append(out, r)
		} else {
			out = append(out, nil)
		}
	}
	return out
}

func (a *App) saveTokenStore(tokens []map[string]any) {
	arr := make([]any, 0, len(tokens))
	for _, t := range tokens {
		if t == nil {
			arr = append(arr, nil)
		} else {
			arr = append(arr, t)
		}
	}
	_ = writeJSONFile(a.tokensPath(), map[string]any{"tokens": arr}, true)
}

func orNil(v any) any {
	if truthy(v) {
		return v
	}
	return nil
}

func tokenPreview(tok string) string {
	if tok == "" {
		return ""
	}
	return jsSlice(tok, 6) + "…" + tok[max(0, len(tok)-4):]
}

func (a *App) listAccessTokens() []any {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	out := []any{}
	for _, t := range a.loadTokenStore() {
		if t == nil || truthy(t["revokedAt"]) {
			continue
		}
		label := "User"
		if truthy(t["label"]) {
			label = jsString(t["label"])
		}
		out = append(out, map[string]any{
			"id":                t["id"],
			"label":             label,
			"email":             orNil(t["email"]),
			"uid":               orNil(t["uid"]),
			"createdAt":         orNil(t["createdAt"]),
			"lastUsedAt":        orNil(t["lastUsedAt"]),
			"tokenPreview":      tokenPreview(jsStr(t["token"])),
			"allowedCompanyIds": normalizeCompanyIDs(t["allowedCompanyIds"]),
			"invitedEmails":     normalizeInvitedEmails(t["invitedEmails"]),
		})
	}
	return out
}

func findLiveToken(tokens []map[string]any, token string) map[string]any {
	if token == "" {
		return nil
	}
	for _, t := range tokens {
		if t != nil && !truthy(t["revokedAt"]) {
			if s, ok := t["token"].(string); ok && s == token {
				return t
			}
		}
	}
	return nil
}

func (a *App) validateAccessToken(token string) bool {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	tokens := a.loadTokenStore()
	live := findLiveToken(tokens, token)
	if live == nil {
		return false
	}
	live["lastUsedAt"] = nowISO()
	a.saveTokenStore(tokens)
	return true
}

func (a *App) createAccessToken(input map[string]any) map[string]any {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	tokens := a.loadTokenStore()
	label := "Shared user"
	if truthy(input["label"]) {
		label = jsString(input["label"])
	}
	rec := map[string]any{
		"id":                randomHex(8),
		"token":             randomHex(32),
		"label":             jsSlice(label, 120),
		"email":             nil,
		"uid":               nil,
		"allowedCompanyIds": normalizeCompanyIDs(input["allowedCompanyIds"]),
		"createdAt":         nowISO(),
		"revokedAt":         nil,
		"lastUsedAt":        nil,
	}
	if truthy(input["email"]) {
		rec["email"] = jsSlice(jsString(input["email"]), 200)
	}
	if truthy(input["uid"]) {
		rec["uid"] = jsSlice(jsString(input["uid"]), 128)
	}
	tokens = append(tokens, rec)
	a.saveTokenStore(tokens)
	return map[string]any{
		"id": rec["id"], "token": rec["token"], "label": rec["label"], "email": rec["email"],
		"uid": rec["uid"], "allowedCompanyIds": rec["allowedCompanyIds"], "createdAt": rec["createdAt"],
	}
}

func findByID(tokens []map[string]any, id string, liveOnly bool) map[string]any {
	for _, t := range tokens {
		if t == nil || jsString(t["id"]) != id || (t["id"] == nil) {
			continue
		}
		if liveOnly && truthy(t["revokedAt"]) {
			continue
		}
		return t
	}
	return nil
}

func (a *App) revokeAccessToken(id string) bool {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	tokens := a.loadTokenStore()
	rec := findByID(tokens, id, false)
	if rec == nil {
		return false
	}
	rec["revokedAt"] = nowISO()
	a.saveTokenStore(tokens)
	return true
}

func (a *App) getAccessTokenSecret(id string) map[string]any {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	rec := findByID(a.loadTokenStore(), id, true)
	if rec == nil || !truthy(rec["token"]) {
		return nil
	}
	label := "Shared user"
	if truthy(rec["label"]) {
		label = jsString(rec["label"])
	}
	return map[string]any{"id": rec["id"], "token": rec["token"], "label": label,
		"allowedCompanyIds": normalizeCompanyIDs(rec["allowedCompanyIds"])}
}

func applyLabel(rec map[string]any, v any) {
	l := "Shared user"
	if truthy(v) {
		l = jsString(v)
	} else if truthy(rec["label"]) {
		l = jsString(rec["label"])
	}
	rec["label"] = jsSlice(l, 120)
}

func (a *App) rotateAccessToken(id string, input map[string]any) map[string]any {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	tokens := a.loadTokenStore()
	rec := findByID(tokens, id, true)
	if rec == nil {
		return nil
	}
	rec["token"] = randomHex(32)
	if v, ok := input["label"]; ok && v != nil {
		applyLabel(rec, v)
	}
	if v, ok := input["allowedCompanyIds"]; ok && v != nil {
		rec["allowedCompanyIds"] = normalizeCompanyIDs(v)
	}
	a.saveTokenStore(tokens)
	return map[string]any{"id": rec["id"], "token": rec["token"], "label": rec["label"],
		"email": orNil(rec["email"]), "uid": orNil(rec["uid"]),
		"allowedCompanyIds": normalizeCompanyIDs(rec["allowedCompanyIds"]), "createdAt": orNil(rec["createdAt"])}
}

func (a *App) updateAccessToken(id string, input map[string]any) map[string]any {
	a.tokMu.Lock()
	defer a.tokMu.Unlock()
	tokens := a.loadTokenStore()
	rec := findByID(tokens, id, true)
	if rec == nil {
		return nil
	}
	if v, ok := input["label"]; ok && v != nil {
		applyLabel(rec, v)
	}
	if v, ok := input["allowedCompanyIds"]; ok && v != nil {
		rec["allowedCompanyIds"] = normalizeCompanyIDs(v)
	}
	if v, ok := input["invitedEmails"]; ok && v != nil {
		rec["invitedEmails"] = normalizeInvitedEmails(v)
	}
	a.saveTokenStore(tokens)
	label := "User"
	if truthy(rec["label"]) {
		label = jsString(rec["label"])
	}
	return map[string]any{"id": rec["id"], "label": label, "email": orNil(rec["email"]), "uid": orNil(rec["uid"]),
		"createdAt": orNil(rec["createdAt"]), "lastUsedAt": orNil(rec["lastUsedAt"]),
		"tokenPreview":      tokenPreview(jsStr(rec["token"])),
		"allowedCompanyIds": normalizeCompanyIDs(rec["allowedCompanyIds"]),
		"invitedEmails":     normalizeInvitedEmails(rec["invitedEmails"])}
}
