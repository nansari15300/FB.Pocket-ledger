// electron/localAppServer.js ka config / client-token / port-file hissa (same file names, same rules).
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	configFile        = "pl-local-server-config.json"
	clientTokenFile   = "pl-local-app-client-token.json"
	persistedPortFile = "pl-electron-static-port.json"
	snapshotFile      = "pl-shareable-companies-snapshot.json"

	hdrClient     = "x-pocket-ledger-app"
	hdrAccess     = "x-pocket-ledger-access"
	hdrMarker     = "x-pocket-ledger-client"
	hdrAppAccount = "x-pocket-ledger-app-account"
	hdrClientPing = "x-pocket-ledger-client-ping-ms"
	markerValue   = "pocket-ledger-electron"

	appUIPortStart = 3000
	appUIPortCount = 100
)

func defaultConfig() map[string]any {
	return map[string]any{
		"port":                     float64(3001),
		"appUiPort":                nil,
		"bindMode":                 "lan",
		"autoStartOnBoot":          false,
		"userWantsRunning":         false,
		"appRole":                  "both",
		"remoteServerUrl":          "",
		"clientAccessToken":        "",
		"publicHost":               "",
		"requireRemoteAccessToken": false,
		"selectedInviteUrls":       []any{},
		"sharedLocalCompanyIds":    nil,
		"showServerSwitchInHeader": false,
	}
}

// ---- JS-like helpers ----

func jsNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, !math.IsNaN(t) && !math.IsInf(t, 0)
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return 0, true // Number("") === 0
		}
		f, err := strconv.ParseFloat(s, 64)
		return f, err == nil
	case bool:
		if t {
			return 1, true
		}
		return 0, true
	case nil:
		return 0, true // Number(null) === 0
	}
	return 0, false
}

func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		if t == math.Trunc(t) && math.Abs(t) < 1e21 {
			return strconv.FormatFloat(t, 'f', -1, 64)
		}
		return strconv.FormatFloat(t, 'g', -1, 64)
	case bool:
		if t {
			return "true"
		}
		return "false"
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// String(x || "") — falsy values -> "".
func jsStr(v any) string {
	if !truthy(v) {
		return ""
	}
	return jsString(v)
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0 && !math.IsNaN(t)
	}
	return true
}

func validPort(v any) (int, bool) {
	n, ok := jsNumber(v)
	if !ok || n <= 0 || n >= 65536 {
		return 0, false
	}
	return int(n), true
}

func normalizeAppRole(v any) string {
	s, _ := v.(string)
	if s == "server" || s == "client" || s == "both" {
		return s
	}
	return "both"
}

func normalizeBindMode(v any) string {
	s, _ := v.(string)
	if s == "lan" || s == "internet" {
		return s
	}
	return "localhost"
}

// nil => null (sab companies), [] => koi nahi.
func normalizeSharedIDs(raw any) any {
	if raw == nil {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return []any{}
	}
	out := []any{}
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

func sharedIDsList(v any) ([]string, bool) {
	arr, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		out = append(out, jsString(x))
	}
	return out, true
}

func (a *App) configPath() string { return filepath.Join(a.userData, configFile) }

func readJSONFile(p string) (map[string]any, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if m == nil {
		return nil, os.ErrInvalid
	}
	return m, nil
}

func writeJSONFile(p string, v any, indent bool) error {
	var b []byte
	var err error
	if indent {
		b, err = json.MarshalIndent(v, "", "  ")
	} else {
		b, err = json.Marshal(v)
	}
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (a *App) loadConfig() map[string]any {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.loadConfigLocked()
}

func (a *App) loadConfigLocked() map[string]any {
	raw, err := readJSONFile(a.configPath())
	if err != nil {
		return defaultConfig()
	}
	cfg := defaultConfig()
	for k, v := range raw {
		cfg[k] = v
	}
	if p, ok := validPort(raw["port"]); ok {
		cfg["port"] = float64(p)
	} else {
		cfg["port"] = float64(3001)
	}
	if p, ok := validPort(raw["appUiPort"]); ok {
		cfg["appUiPort"] = float64(p)
	} else {
		cfg["appUiPort"] = nil
	}
	cfg["bindMode"] = normalizeBindMode(raw["bindMode"])
	cfg["autoStartOnBoot"] = raw["autoStartOnBoot"] == true
	cfg["userWantsRunning"] = raw["userWantsRunning"] == true
	cfg["appRole"] = normalizeAppRole(raw["appRole"])
	if s, ok := raw["remoteServerUrl"].(string); ok {
		cfg["remoteServerUrl"] = strings.TrimSpace(s)
	} else {
		cfg["remoteServerUrl"] = ""
	}
	cfg["clientAccessToken"] = ""
	if s, ok := raw["publicHost"].(string); ok {
		cfg["publicHost"] = strings.TrimSpace(s)
	} else {
		cfg["publicHost"] = ""
	}
	cfg["requireRemoteAccessToken"] = false
	urls := []any{}
	if arr, ok := raw["selectedInviteUrls"].([]any); ok {
		for _, u := range arr {
			if s := strings.TrimSpace(jsStr(u)); s != "" {
				urls = append(urls, s)
			}
		}
	}
	cfg["selectedInviteUrls"] = urls
	cfg["sharedLocalCompanyIds"] = normalizeSharedIDs(raw["sharedLocalCompanyIds"])
	cfg["showServerSwitchInHeader"] = raw["showServerSwitchInHeader"] == true
	return cfg
}

func (a *App) saveConfig(partial map[string]any) map[string]any {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	next := a.loadConfigLocked()
	for k, v := range partial {
		next[k] = v
	}
	next["clientAccessToken"] = ""
	next["requireRemoteAccessToken"] = false
	delete(next, "appOnlyAccess")
	if v, ok := partial["appRole"]; ok && v != nil {
		next["appRole"] = normalizeAppRole(v)
	}
	if v, ok := partial["bindMode"]; ok && v != nil {
		next["bindMode"] = normalizeBindMode(v)
	}
	if v, ok := partial["sharedLocalCompanyIds"]; ok {
		next["sharedLocalCompanyIds"] = normalizeSharedIDs(v)
	}
	if partial["autoStartOnBoot"] == true {
		next["userWantsRunning"] = true
	}
	_ = writeJSONFile(a.configPath(), next, true)
	return next
}

func cfgBool(cfg map[string]any, k string) bool { return cfg[k] == true }
func cfgStr(cfg map[string]any, k string) string {
	s, _ := cfg[k].(string)
	return s
}

func shouldHost(cfg map[string]any) bool {
	r := cfgStr(cfg, "appRole")
	return r == "server" || r == "both"
}

func shouldUseRemoteEntry(cfg map[string]any) bool {
	return cfgStr(cfg, "appRole") == "client" && cfgStr(cfg, "remoteServerUrl") != ""
}

func listenHostForConfig(cfg map[string]any) string {
	if !cfgBool(cfg, "userWantsRunning") {
		return "127.0.0.1"
	}
	if cfgStr(cfg, "bindMode") == "localhost" {
		return "127.0.0.1"
	}
	return "0.0.0.0"
}

func (a *App) clientTokenValue() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	if a.clientToken != "" {
		return a.clientToken
	}
	p := filepath.Join(a.userData, clientTokenFile)
	if m, err := readJSONFile(p); err == nil {
		if s, ok := m["token"].(string); ok && len(s) >= 16 {
			a.clientToken = s
			return s
		}
	}
	a.clientToken = randomHex(24)
	_ = writeJSONFile(p, map[string]any{"token": a.clientToken}, false)
	return a.clientToken
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (a *App) readPersistedPort() (int, bool) {
	m, err := readJSONFile(filepath.Join(a.userData, persistedPortFile))
	if err != nil {
		return 0, false
	}
	return validPort(m["port"])
}

func (a *App) writePersistedPort(port int) {
	_ = writeJSONFile(filepath.Join(a.userData, persistedPortFile), map[string]any{"port": port}, false)
}

func (a *App) resolveAppUIPort(cfg map[string]any) (int, bool) {
	if p, ok := validPort(cfg["appUiPort"]); ok {
		return p, true
	}
	return a.readPersistedPort()
}

func consecutivePortCandidates(start, count int, preferred ...int) []int {
	out := []int{}
	seen := map[int]bool{}
	add := func(p int) {
		if p <= 0 || p >= 65536 || seen[p] {
			return
		}
		seen[p] = true
		out = append(out, p)
	}
	for _, p := range preferred {
		add(p)
	}
	for i := 0; i < count; i++ {
		add(start + i)
	}
	return out
}

func normalizeRemoteServerURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := parseURL(s)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host + "/"
}
