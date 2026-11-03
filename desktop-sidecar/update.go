// Release installer download (Electron desktopReleaseUpdate.js parity). Launch + quit Rust karta hai.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

var safeVersionRe = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+\-]{0,63}$`)
var updateBusy atomic.Bool

func fileLooksComplete(p string, expected int64) bool {
	st, err := os.Stat(p)
	if err != nil || !st.Mode().IsRegular() || st.Size() < 1024*1024 {
		return false
	}
	return expected <= 0 || st.Size() == expected
}

func (a *App) downloadUpdate(args map[string]any) map[string]any {
	rawURL := strings.TrimSpace(jsStr(args["url"]))
	ver := strings.TrimSpace(jsStr(args["version"]))
	if rawURL == "" || ver == "" {
		return map[string]any{"ok": false, "error": "Missing update URL or version."}
	}
	// Hardening: sirf https (http feed par MITM installer ka khatra) + version file-name safe.
	u, err := parseURL(rawURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return map[string]any{"ok": false, "error": "Update URL must be https."}
	}
	if !safeVersionRe.MatchString(ver) {
		return map[string]any{"ok": false, "error": "Invalid update version."}
	}
	if !updateBusy.CompareAndSwap(false, true) {
		return map[string]any{"ok": false, "error": "Update download already in progress."}
	}
	defer updateBusy.Store(false)
	dest := filepath.Join(a.userData, "pl-release-updates", "Pocket Ledger Setup "+ver+".exe")
	progress := func(rec, total int64, reused bool) {
		p := map[string]any{"received": rec, "total": total}
		if reused {
			p["reused"] = true
		}
		a.rpc.event("updateProgress", p)
	}
	if fileLooksComplete(dest, 0) {
		st, _ := os.Stat(dest)
		progress(st.Size(), st.Size(), true)
		return map[string]any{"ok": true, "installerPath": dest}
	}
	expected, err := downloadTo(rawURL, dest, progress)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	if !fileLooksComplete(dest, expected) {
		return map[string]any{"ok": false, "error": "Downloaded installer looks incomplete."}
	}
	return map[string]any{"ok": true, "installerPath": dest}
}

func downloadTo(rawURL, dest string, progress func(int64, int64, bool)) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" {
			return errors.New("redirect to non-https refused")
		}
		return nil
	}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("Download failed (%d)", resp.StatusCode)
	}
	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return 0, err
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return 0, err
	}
	var rec int64
	last := time.Time{}
	buf := make([]byte, 256*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				os.Remove(tmp)
				return 0, werr
			}
			rec += int64(n)
			if time.Since(last) > 150*time.Millisecond {
				last = time.Now()
				progress(rec, total, false)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			os.Remove(tmp)
			return 0, rerr
		}
	}
	progress(rec, total, false)
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return 0, err
	}
	_ = os.Remove(dest)
	if err := os.Rename(tmp, dest); err != nil {
		return 0, err
	}
	return total, nil
}
