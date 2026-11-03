// ctl ops (Rust -> Go): Electron ke ipcMain "pl-local-server-*" handlers + server lifecycle.
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var errClientOnly = errors.New("PL_LOCAL_SERVER_ROLE_CLIENT_ONLY")
var errStopped = errors.New("PL_LOCAL_SERVER_STOPPED")
var errPortsExhausted = errors.New("PL_PACKAGED_STATIC_PORT_EXHAUSTED")

type httpSrv struct {
	srv  *http.Server
	ln   net.Listener
	port int
	host string
}

func (a *App) newServer(kind srvKind) *http.Server {
	return &http.Server{Handler: a.handler(kind), ReadHeaderTimeout: 15 * time.Second, IdleTimeout: 120 * time.Second}
}

func tryListen(host string, cands []int) (net.Listener, int, error) {
	for _, p := range cands {
		ln, err := net.Listen("tcp4", net.JoinHostPort(host, strconv.Itoa(p)))
		if err == nil {
			return ln, p, nil
		}
		if !isAddrInUse(err) {
			return nil, 0, err
		}
	}
	return nil, 0, errPortsExhausted
}

func isAddrInUse(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "address already in use") || strings.Contains(s, "only one usage of each socket address") ||
		strings.Contains(s, "access permissions") || strings.Contains(s, "bind")
}

func (a *App) appUIPort() int {
	a.srvMu.Lock()
	defer a.srvMu.Unlock()
	if a.appUI != nil {
		return a.appUI.port
	}
	return 0
}

func (a *App) sharingPort() int {
	a.srvMu.Lock()
	defer a.srvMu.Unlock()
	if a.sharing != nil {
		return a.sharing.port
	}
	return 0
}

func (a *App) startAppUI() (int, error) {
	a.srvMu.Lock()
	defer a.srvMu.Unlock()
	if a.appUI != nil {
		return a.appUI.port, nil
	}
	cfg := a.loadConfig()
	if !shouldHost(cfg) {
		return 0, errClientOnly
	}
	persisted, _ := a.readPersistedPort()
	resolved, _ := a.resolveAppUIPort(cfg)
	cands := consecutivePortCandidates(appUIPortStart, appUIPortCount, resolved, persisted)
	ln, port, err := tryListen("127.0.0.1", cands)
	if err != nil {
		return 0, err
	}
	s := a.newServer(kindAppUI)
	a.appUI = &httpSrv{srv: s, ln: ln, port: port, host: "127.0.0.1"}
	go func() {
		if err := s.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("app ui serve: %v", err)
		}
	}()
	a.writePersistedPort(port)
	if p, ok := validPort(cfg["appUiPort"]); !ok || p != port {
		a.saveConfig(map[string]any{"appUiPort": float64(port)})
	}
	log.Printf("app_ui_listening port=%d", port)
	return port, nil
}

func closeSrv(h *httpSrv) {
	if h == nil {
		return
	}
	_ = h.srv.Close()
}

func (a *App) stopSharing() {
	a.srvMu.Lock()
	h := a.sharing
	a.sharing = nil
	a.srvMu.Unlock()
	closeSrv(h)
	a.emitState()
}

func (a *App) startSharing() (int, error) {
	cfg := a.loadConfig()
	if !shouldHost(cfg) {
		return 0, errClientOnly
	}
	if !cfgBool(cfg, "userWantsRunning") {
		return 0, errStopped
	}
	host := listenHostForConfig(cfg)
	a.srvMu.Lock()
	if a.sharing != nil && a.sharing.host == host {
		p := a.sharing.port
		a.srvMu.Unlock()
		return p, nil
	}
	old := a.sharing
	a.sharing = nil
	a.srvMu.Unlock()
	closeSrv(old)
	pref := 0
	if p, ok := validPort(cfg["port"]); ok {
		pref = p
	}
	ui := a.appUIPort()
	cands := []int{}
	for _, c := range consecutivePortCandidates(appUIPortStart, appUIPortCount, pref) {
		if c != ui {
			cands = append(cands, c)
		}
	}
	ln, port, err := tryListen(host, cands)
	if err != nil {
		a.emitState()
		return 0, err
	}
	s := a.newServer(kindSharing)
	a.srvMu.Lock()
	a.sharing = &httpSrv{srv: s, ln: ln, port: port, host: host}
	a.srvMu.Unlock()
	go func() {
		if err := s.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("sharing serve: %v", err)
		}
	}()
	log.Printf("sharing_listening port=%d host=%s", port, host)
	a.emitState()
	return port, nil
}

func (a *App) restartSharing() (int, error) {
	a.stopSharing()
	cfg := a.loadConfig()
	if !shouldHost(cfg) || !cfgBool(cfg, "userWantsRunning") {
		return 0, nil
	}
	a.ensurePublicHost()
	return a.startSharing()
}

func (a *App) startSharedLocalServer() (int, error) {
	a.saveConfig(map[string]any{"userWantsRunning": true})
	if _, err := a.startAppUI(); err != nil {
		return 0, err
	}
	p, err := a.startSharing()
	if err != nil {
		return 0, err
	}
	a.warmBridgeBestEffort()
	return p, nil
}

func (a *App) stopLocalServerAndPersist() {
	a.saveConfig(map[string]any{"userWantsRunning": false})
	a.stopSharing()
	if shouldHost(a.loadConfig()) {
		_, _ = a.startAppUI()
	}
	a.emitState()
}

// Electron ensureHostSharingRunningAfterLaunch (boot / resume).
func (a *App) ensureHostSharingAfterLaunch(forceRestart bool) {
	cfg := a.loadConfig()
	if !shouldHost(cfg) || shouldUseRemoteEntry(cfg) {
		return
	}
	if !cfgBool(cfg, "userWantsRunning") && !cfgBool(cfg, "autoStartOnBoot") {
		return
	}
	if cfgBool(cfg, "autoStartOnBoot") && !cfgBool(cfg, "userWantsRunning") {
		a.saveConfig(map[string]any{"userWantsRunning": true})
	}
	if _, err := a.startAppUI(); err != nil {
		log.Printf("ensure app UI failed: %v", err)
	}
	if forceRestart {
		if p, err := a.restartSharing(); err == nil && p != 0 {
			a.warmBridgeBestEffort()
		}
		return
	}
	if st := a.getStatus(); st["sharingActive"] == true {
		a.warmBridgeBestEffort()
		return
	}
	if _, err := a.startSharing(); err != nil {
		log.Printf("ensure host sharing failed: %v", err)
		return
	}
	a.warmBridgeBestEffort()
}

func lanIPv4s() []string {
	out := []string{}
	ifs, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, i := range ifs {
		if i.Flags&net.FlagLoopback != 0 || i.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, ad := range addrs {
			if ipn, ok := ad.(*net.IPNet); ok {
				if v4 := ipn.IP.To4(); v4 != nil {
					out = append(out, v4.String())
				}
			}
		}
	}
	return out
}

func buildPublicListingURL(ph string, port int) string {
	ph = strings.TrimSpace(ph)
	if ph == "" || port <= 0 {
		return ""
	}
	href := ph
	if l := strings.ToLower(href); !strings.HasPrefix(l, "http://") && !strings.HasPrefix(l, "https://") {
		href = "http://" + href
	}
	if u, err := parseURL(href); err == nil && u.Hostname() != "" {
		pp := u.Port()
		if pp == "" {
			pp = strconv.Itoa(port)
		}
		h := u.Hostname()
		if strings.Contains(h, ":") {
			h = "[" + h + "]"
		}
		return "http://" + h + ":" + pp + "/"
	}
	return ""
}

func listLanURLs(port int, publicHost string) []any {
	ps := strconv.Itoa(port)
	urls := []string{"http://127.0.0.1:" + ps + "/", "http://localhost:" + ps + "/"}
	for _, ip := range lanIPv4s() {
		urls = append(urls, "http://"+ip+":"+ps+"/")
	}
	if pub := buildPublicListingURL(publicHost, port); pub != "" {
		urls = append(urls, pub)
	}
	seen := map[string]bool{}
	out := []any{}
	for _, u := range urls {
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

func (a *App) getStatus() map[string]any {
	cfg := a.loadConfig()
	a.schedulePublicHostAutoDetect(cfg)
	hosting := shouldHost(cfg)
	ui := a.appUIPort()
	sp := a.sharingPort()
	sharingUp := sp != 0 && cfgBool(cfg, "userWantsRunning")
	resolved := ui
	if resolved == 0 {
		resolved, _ = a.resolveAppUIPort(cfg)
	}
	var sharingPort, port, appUI any = nil, nil, nil
	if sharingUp {
		sharingPort = sp
		port = sp
	} else if resolved != 0 {
		port = resolved
	}
	if resolved != 0 {
		appUI = resolved
	}
	urls := []any{}
	if sharingUp && hosting {
		urls = listLanURLs(sp, cfgStr(cfg, "publicHost"))
	} else if ui != 0 && hosting {
		urls = []any{"http://127.0.0.1:" + strconv.Itoa(resolved) + "/", "http://localhost:" + strconv.Itoa(resolved) + "/"}
	}
	var hint any = nil
	if cfgStr(cfg, "bindMode") != "localhost" {
		hint = "On your router, forward the external TCP port to this PC's LAN IP and server port. Allow the port in Windows Firewall."
	}
	return map[string]any{
		"running": sharingUp, "appUiServing": ui != 0, "sharingActive": sharingUp,
		"port": port, "appUiPort": appUI, "sharingPort": sharingPort,
		"configuredPort": cfg["port"], "bindMode": cfg["bindMode"], "autoStartOnBoot": cfg["autoStartOnBoot"],
		"userWantsRunning": cfg["userWantsRunning"], "appRole": cfg["appRole"], "remoteServerUrl": cfg["remoteServerUrl"],
		"publicHost": cfg["publicHost"], "requireRemoteAccessToken": cfg["requireRemoteAccessToken"],
		"urls": urls, "clientHeader": hdrClient, "accessHeader": hdrAccess, "electronMarkerHeader": hdrMarker,
		"clients": a.listClientStats(), "portForwardHint": hint,
	}
}

// Rust ko tray / power-save / header-injection ke liye state.
func (a *App) emitState() {
	if !a.providersEnabled() {
		return
	}
	cfg := a.loadConfig()
	sp := a.sharingPort()
	a.rpc.event("state", map[string]any{
		"hosting":           shouldHost(cfg),
		"userWantsRunning":  cfgBool(cfg, "userWantsRunning"),
		"sharingActive":     sp != 0 && cfgBool(cfg, "userWantsRunning"),
		"sharingPort":       sp,
		"appUiPort":         a.appUIPort(),
		"autoStartOnBoot":   cfgBool(cfg, "autoStartOnBoot"),
		"remoteBase":        normalizeRemoteServerURL(cfgStr(cfg, "remoteServerUrl")),
		"clientAccessToken": strings.TrimSpace(cfgStr(cfg, "clientAccessToken")),
		"appRole":           cfgStr(cfg, "appRole"),
	})
}

func (a *App) entryURL() (string, string) {
	cfg := a.loadConfig()
	if shouldUseRemoteEntry(cfg) {
		remote := normalizeRemoteServerURL(cfgStr(cfg, "remoteServerUrl"))
		if remote == "" {
			return "", "PL_REMOTE_SERVER_URL_MISSING"
		}
		u, err := parseURL(remote)
		if err != nil {
			return remote + "?pl_remote_client=1", ""
		}
		q := u.Query()
		q.Set("pl_remote_client", "1")
		u.RawQuery = q.Encode()
		return u.String(), ""
	}
	p, err := a.startAppUI()
	if err != nil {
		return "", err.Error()
	}
	return "http://localhost:" + strconv.Itoa(p) + "/", ""
}

func argMap(raw json.RawMessage) map[string]any {
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if m == nil {
		m = map[string]any{}
	}
	return m
}

var ctlMu sync.Mutex

func (a *App) onCtl(op string, raw json.RawMessage) any {
	// lifecycle ops ek-ek karke (Electron single-thread jaisa).
	switch op {
	case "start", "stop", "restart", "resume", "quit", "entry":
		ctlMu.Lock()
		defer ctlMu.Unlock()
	}
	args := argMap(raw)
	switch op {
	case "status":
		return a.getStatus()
	case "getConfig":
		return a.loadConfig()
	case "setConfig":
		p, _ := args["partial"].(map[string]any)
		if p == nil {
			p = map[string]any{}
		}
		next := a.saveConfig(p)
		a.emitState()
		return next
	case "start":
		if !shouldHost(a.loadConfig()) {
			return map[string]any{"ok": false, "error": "client-only", "status": a.getStatus()}
		}
		port, err := a.startSharedLocalServer()
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error(), "throw": true}
		}
		return map[string]any{"ok": true, "port": port, "status": a.getStatus()}
	case "stop":
		a.stopLocalServerAndPersist()
		return map[string]any{"ok": true, "status": a.getStatus()}
	case "restart":
		before := a.appUIPort()
		if p, ok := args["partial"].(map[string]any); ok {
			a.saveConfig(p)
		}
		cfg := a.loadConfig()
		if !shouldHost(cfg) {
			a.stopSharing()
			return map[string]any{"ok": true, "port": nil, "status": a.getStatus()}
		}
		ui := before
		if p, err := a.startAppUI(); err == nil {
			ui = p
		}
		sharing := 0
		if cfgBool(cfg, "userWantsRunning") {
			if p, err := a.restartSharing(); err == nil {
				sharing = p
				go a.ensureBridge()
			}
		} else {
			a.stopSharing()
		}
		var port any = nil
		if sharing != 0 {
			port = sharing
		} else if ui != 0 {
			port = ui
		}
		var uiv any = nil
		if ui != 0 {
			uiv = ui
		}
		return map[string]any{"ok": true, "port": port, "appUiPort": uiv, "status": a.getStatus(),
			"reloadPort": map[bool]any{true: ui, false: nil}[before != 0 && ui != 0 && before != ui]}
	case "listTokens":
		return a.listAccessTokens()
	case "createToken":
		in, _ := args["input"].(map[string]any)
		if in == nil {
			in = map[string]any{}
		}
		return a.createAccessToken(in)
	case "updateToken":
		in, _ := args["input"].(map[string]any)
		if in == nil {
			in = map[string]any{}
		}
		up := a.updateAccessToken(jsStr(args["id"]), in)
		if up == nil {
			return map[string]any{"ok": false}
		}
		return map[string]any{"ok": true, "token": up}
	case "getTokenSecret":
		s := a.getAccessTokenSecret(jsStr(args["id"]))
		if s == nil {
			return map[string]any{"ok": false}
		}
		out := map[string]any{"ok": true}
		for k, v := range s {
			out[k] = v
		}
		return out
	case "rotateToken":
		in, _ := args["input"].(map[string]any)
		if in == nil {
			in = map[string]any{}
		}
		s := a.rotateAccessToken(jsStr(args["id"]), in)
		if s == nil {
			return map[string]any{"ok": false}
		}
		out := map[string]any{"ok": true}
		for k, v := range s {
			out[k] = v
		}
		return out
	case "revokeToken":
		return map[string]any{"ok": a.revokeAccessToken(jsStr(args["id"]))}
	case "saveSnapshot":
		rows, _ := args["companies"].([]any)
		a.saveSnapshot(rows)
		return map[string]any{"ok": true, "count": len(rows)}
	case "normalizeRemote":
		n := normalizeRemoteServerURL(jsStr(args["url"]))
		if n == "" {
			return map[string]any{"ok": false}
		}
		u, _ := parseURL(n)
		return map[string]any{"ok": true, "origin": urlOrigin(u)}
	case "resume":
		a.ensureHostSharingAfterLaunch(false)
		if cfgBool(a.loadConfig(), "userWantsRunning") {
			go a.ensureBridge()
		}
		return map[string]any{"ok": true}
	case "windowClosedToTray":
		cfg := a.loadConfig()
		if cfgBool(cfg, "userWantsRunning") && a.sharingPort() == 0 {
			go func() {
				ctlMu.Lock()
				defer ctlMu.Unlock()
				if _, err := a.startAppUI(); err == nil {
					if _, err := a.startSharing(); err == nil {
						go a.ensureBridge()
					}
				}
			}()
		}
		return map[string]any{"ok": true}
	case "trayRetry":
		go func() {
			ctlMu.Lock()
			defer ctlMu.Unlock()
			cfg := a.loadConfig()
			if !shouldHost(cfg) || !cfgBool(cfg, "userWantsRunning") {
				return
			}
			if _, err := a.startAppUI(); err == nil {
				if _, err := a.startSharing(); err == nil {
					go a.ensureBridge()
				}
			}
		}()
		return map[string]any{"ok": true}
	case "quit":
		a.saveConfig(map[string]any{"userWantsRunning": false})
		a.stopSharing()
		return map[string]any{"ok": true}
	case "entry":
		u, e := a.entryURL()
		return map[string]any{"url": u, "error": e, "appUiPort": a.appUIPort()}
	case "clientToken":
		return map[string]any{"token": a.clientTokenValue()}
	case "updateDownload":
		return a.downloadUpdate(args)
	case "bridgeUpsert":
		p, _ := args["payload"].(map[string]any)
		if p == nil {
			return map[string]any{"ok": false, "error": "bridge_upsert_failed"}
		}
		return a.provideAuthoritativeUpsert(p)
	case "emitState":
		a.emitState()
		return map[string]any{"ok": true}
	}
	return map[string]any{"ok": false, "error": "unknown_op"}
}
