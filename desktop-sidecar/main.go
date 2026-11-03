// pl-sidecar v0.2: Pocket Ledger Tauri ka Go sidecar.
// Electron localAppServer.js port: app UI static server (127.0.0.1, strict Host + loopback check),
// LAN sharing server (Electron bind rules), /__pl_* endpoints, access tokens.
// Firebase blob proxy jaan-boojh kar nahi (501 firebase-not-supported) — Firebase hataya ja raha hai.
// Webview kaam (bridge eval) Rust se stdin/stdout RPC ke through (rpc.go).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
)

const version = "0.2.0"

type App struct {
	userData string
	root     string
	csp      string
	version  string
	rpc      *rpcHub

	noNetwork bool

	cfgMu       sync.Mutex
	tokMu       sync.Mutex
	clientToken string

	shMu      sync.Mutex
	cacheRows []Row
	cacheKey  string
	cacheAt   int64
	lastGood  []Row

	stMu  sync.Mutex
	stats map[string]clientStat

	sseMu    sync.Mutex
	sse      map[*sseClient]struct{}
	shutdown chan struct{}

	mmMu                sync.Mutex
	mirrorSync          map[string]map[string]int64
	bundleFallbackCount int
	exportMu            sync.Mutex

	bridgeMu     sync.Mutex
	bridgeWait   chan struct{}
	bridgeLast   candidate
	bridgeLastOK bool

	srvMu   sync.Mutex
	appUI   *httpSrv
	sharing *httpSrv

	ipInflight atomic.Bool
}

func newApp(userData, root, csp, appVersion string, hub *rpcHub) *App {
	return &App{
		userData: userData, root: root, csp: csp, version: appVersion, rpc: hub,
		stats: map[string]clientStat{}, sse: map[*sseClient]struct{}{}, shutdown: make(chan struct{}),
		mirrorSync: map[string]map[string]int64{},
	}
}

func main() {
	root := flag.String("root", os.Getenv("PL_STATIC_ROOT"), "static export root (out/)")
	userData := flag.String("user-data", "", "app data dir (config, tokens, attachments)")
	appVersion := flag.String("app-version", "", "desktop app version (health serverBuild)")
	cspFlag := flag.String("csp", "on", "HTML CSP header: on|off")
	watchStdin := flag.Bool("exit-on-stdin-eof", false, "exit when stdin closes (parent died)")
	rpcOn := flag.Bool("rpc", false, "enable Rust RPC over stdin/stdout")
	noNet := flag.Bool("no-network", false, "tests: public IP auto-detect off")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetOutput(os.Stderr)

	if *root == "" || *userData == "" {
		log.Fatal("missing --root or --user-data")
	}
	absRoot, err := filepath.Abs(*root)
	if err != nil {
		log.Fatal(err)
	}
	if st, err := os.Stat(filepath.Join(absRoot, "index.html")); err != nil || st.IsDir() {
		log.Fatalf("root has no index.html: %s", absRoot)
	}
	absUD, err := filepath.Abs(*userData)
	if err != nil {
		log.Fatal(err)
	}
	_ = os.MkdirAll(absUD, 0o755)
	csp := ""
	if *cspFlag != "off" {
		csp = defaultHTMLCSP
	}
	av := *appVersion
	if av == "" {
		av = version
	}
	hub := newRPCHub(os.Stdout, *rpcOn)
	a := newApp(absUD, absRoot, csp, av, hub)
	a.noNetwork = *noNet
	hub.onCtl = a.onCtl

	quit := func(reason string) {
		log.Printf("exiting: %s", reason)
		close(a.shutdown)
		os.Exit(0)
	}
	if *rpcOn || *watchStdin {
		go hub.readLoop(os.Stdin, func() { quit("stdin closed, parent gone") })
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; quit("signal") }()

	// Boot: app UI (host role) + Electron ensureHostSharingRunningAfterLaunch.
	ctlMu.Lock()
	entry, entryErr := a.entryURL()
	ctlMu.Unlock()
	ready, _ := json.Marshal(map[string]any{
		"port": a.appUIPort(), "appUiPort": a.appUIPort(), "version": version,
		"entryUrl": entry, "entryError": entryErr,
	})
	fmt.Fprintf(os.Stdout, "PL_SIDECAR_READY %s\n", ready)
	_ = os.Stdout.Sync()
	go func() {
		ctlMu.Lock()
		a.ensureHostSharingAfterLaunch(false)
		ctlMu.Unlock()
		a.emitState()
	}()
	select {}
}
