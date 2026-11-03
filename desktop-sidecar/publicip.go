// Best-effort public IPv4 (sirf khali publicHost field me; user DDNS kabhi overwrite nahi).
package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var publicIPProviders = []string{
	"https://api.ipify.org?format=text",
	"https://checkip.amazonaws.com",
	"https://ipv4.icanhazip.com",
}

var ipv4Re = regexp.MustCompile(`\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b`)

func parseIPv4(text string) string {
	m := ipv4Re.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return ""
	}
	if ip := net.ParseIP(m[1]); ip == nil || ip.To4() == nil {
		return ""
	}
	return m[1]
}

func fetchPublicIP() string {
	for _, u := range publicIPProviders {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
			if resp.StatusCode < 400 {
				if ip := parseIPv4(string(b)); ip != "" {
					cancel()
					return ip
				}
			}
		}
		cancel()
	}
	return ""
}

func shouldAutoDetectPublicHost(cfg map[string]any) bool {
	return shouldHost(cfg) && strings.TrimSpace(cfgStr(cfg, "publicHost")) == "" && cfgStr(cfg, "bindMode") != "localhost"
}

func (a *App) schedulePublicHostAutoDetect(cfg map[string]any) {
	if !shouldAutoDetectPublicHost(cfg) || a.noNetwork {
		return
	}
	if !a.ipInflight.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer a.ipInflight.Store(false)
		ip := fetchPublicIP()
		if ip == "" {
			return
		}
		latest := a.loadConfig()
		if strings.TrimSpace(cfgStr(latest, "publicHost")) != "" || !shouldAutoDetectPublicHost(latest) {
			return
		}
		a.saveConfig(map[string]any{"publicHost": ip})
	}()
}

func (a *App) ensurePublicHost() string {
	cfg := a.loadConfig()
	if !shouldAutoDetectPublicHost(cfg) || a.noNetwork {
		return strings.TrimSpace(cfgStr(cfg, "publicHost"))
	}
	ip := fetchPublicIP()
	if ip == "" {
		return ""
	}
	latest := a.loadConfig()
	if s := strings.TrimSpace(cfgStr(latest, "publicHost")); s != "" {
		return s
	}
	a.saveConfig(map[string]any{"publicHost": ip})
	return ip
}
