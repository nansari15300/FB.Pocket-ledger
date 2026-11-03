// Static `out/` serving — serve-handler (cleanUrls) + packagedStaticHeaders jaisa.
package main

import (
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// HTML responses par CSP. pdfmake `new Function` -> 'unsafe-eval' (non-breaking set, real out/ se test).
const defaultHTMLCSP = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; " +
	"connect-src * ws: wss: data: blob:; " +
	"img-src * data: blob:; media-src * data: blob:; " +
	"style-src 'self' 'unsafe-inline' https:; " +
	"font-src 'self' data: https:; " +
	"frame-src * data: blob:; worker-src 'self' blob:; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

var mimeTable = map[string]string{
	".html":        "text/html; charset=utf-8",
	".htm":         "text/html; charset=utf-8",
	".js":          "application/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".cjs":         "application/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".map":         "application/json; charset=utf-8",
	".txt":         "text/plain; charset=utf-8",
	".xml":         "application/xml; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".wasm":        "application/wasm",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".gif":         "image/gif",
	".webp":        "image/webp",
	".avif":        "image/avif",
	".ico":         "image/x-icon",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".ttf":         "font/ttf",
	".otf":         "font/otf",
	".pdf":         "application/pdf",
	".mp3":         "audio/mpeg",
	".wav":         "audio/wav",
	".mp4":         "video/mp4",
}

func contentTypeFor(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if ct, ok := mimeTable[ext]; ok {
		return ct
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func parseURL(s string) (*url.URL, error) {
	u, err := url.Parse(s)
	if err != nil {
		return nil, err
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "" {
		// JS URL bhi dusre schemes parse karta; humein sirf http(s) chahiye.
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		u.Host = host + ":" + port
	} else {
		u.Host = host
	}
	return u, nil
}

func urlOrigin(u *url.URL) string { return u.Scheme + "://" + u.Host }

func hostOnly(hostHeader string) string {
	h := hostHeader
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	return strings.ToLower(strings.Trim(h, "[]"))
}

func isLoopbackHostName(h string) bool {
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// resolve: URL path -> file inside root (serve-handler cleanUrls jaisa).
func resolveStatic(root, urlPath string) (string, bool) {
	if strings.ContainsAny(urlPath, "\x00\\") || strings.Contains(urlPath, ":") {
		return "", false
	}
	clean := path.Clean("/" + urlPath)
	trailing := strings.HasSuffix(urlPath, "/")
	var candidates []string
	if trailing || clean == "/" {
		candidates = []string{path.Join(clean, "index.html"), strings.TrimSuffix(clean, "/") + ".html"}
	} else {
		candidates = []string{clean, clean + ".html", path.Join(clean, "index.html")}
	}
	for _, c := range candidates {
		if c == "/.html" {
			continue
		}
		full := filepath.Join(root, filepath.FromSlash(c))
		rel, err := filepath.Rel(root, full)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		st, err := os.Stat(full)
		if err != nil || st.IsDir() {
			continue
		}
		return full, true
	}
	return "", false
}

func (a *App) setStaticHeaders(w http.ResponseWriter, file, urlPath string) {
	h := w.Header()
	h.Set("Content-Type", contentTypeFor(file))
	h.Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(urlPath, "/_next/static/") {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	if strings.HasSuffix(strings.ToLower(file), ".html") && a.csp != "" {
		h.Set("Content-Security-Policy", a.csp)
	}
}

func (a *App) serveFile(w http.ResponseWriter, r *http.Request, file string, status int) {
	f, err := os.Open(file)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	a.setStaticHeaders(w, file, r.URL.Path)
	if status == http.StatusOK {
		http.ServeContent(w, r, "", st.ModTime(), f)
		return
	}
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, f)
	}
}

var extRe = regexp.MustCompile(`(?i)\.[a-z0-9]+$`)
var reconLegacyRe = regexp.MustCompile(`^/reconciliation/([^/]+)$`)

// main.js rewriteReconciliationDocumentUrl ke barabar (path-only check).
func reconciliationRewrite(escapedPath string) bool {
	p := strings.TrimRight(escapedPath, "/")
	if p == "" {
		p = "/"
	}
	if strings.Contains(p, "/_next/") || extRe.MatchString(p) {
		return false
	}
	if p == "/reconciliation" {
		return true
	}
	if m := reconLegacyRe.FindStringSubmatch(p); m != nil && m[1] != "__placeholder__" {
		return true
	}
	return false
}

func shouldRedirectToRemoteClient(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	q := r.URL.Query()
	if q.Get("pl_remote_client") == "1" || q.Get("pl_server_data_bridge") == "1" {
		return false
	}
	p := r.URL.EscapedPath()
	if p == "" {
		p = "/"
	}
	if strings.HasPrefix(p, "/__") || strings.HasPrefix(p, "/api/") || p == "/favicon.ico" {
		return false
	}
	ext := strings.ToLower(path.Ext(p))
	if ext != "" && ext != ".html" && ext != ".htm" {
		return false
	}
	accept := strings.ToLower(r.Header.Get("Accept"))
	return accept == "" || strings.Contains(accept, "text/html") || strings.Contains(accept, "*/*")
}

func (a *App) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if reconciliationRewrite(r.URL.EscapedPath()) {
		if f, ok := resolveStatic(a.root, "/reconciliation/index.html"); ok {
			a.serveFile(w, r, f, http.StatusOK)
			return
		}
	}
	p := r.URL.Path
	// serve-handler cleanUrls: `/x.html` -> 301 `/x`, `/x/index` -> `/x`.
	lower := strings.ToLower(p)
	if strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, "/index") {
		target := p
		if strings.HasSuffix(lower, ".html") {
			target = target[:len(target)-5]
		}
		if strings.HasSuffix(strings.ToLower(target), "/index") {
			target = target[:len(target)-6]
		}
		if target == "" {
			target = "/"
		}
		loc := (&url.URL{Path: target}).EscapedPath()
		if r.URL.RawQuery != "" {
			loc += "?" + r.URL.RawQuery
		}
		w.Header().Set("Location", loc)
		w.WriteHeader(http.StatusMovedPermanently)
		return
	}
	if file, ok := resolveStatic(a.root, p); ok {
		a.serveFile(w, r, file, http.StatusOK)
		return
	}
	if nf, ok := resolveStatic(a.root, "/404.html"); ok {
		a.serveFile(w, r, nf, http.StatusNotFound)
		return
	}
	http.Error(w, "Not Found", http.StatusNotFound)
}
