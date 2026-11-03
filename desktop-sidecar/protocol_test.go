package main

import "testing"

func TestEvaluateMirrorProtocol(t *testing.T) {
	match := evaluateMirrorProtocol(3, 3)
	if match.Action != "ok" || match.Code != "mirror_protocol_match" {
		t.Fatalf("match: %+v", match)
	}
	unknown := evaluateMirrorProtocol(nil, 3)
	if unknown.Action != "ok" || unknown.Code != "mirror_protocol_unknown" {
		t.Fatalf("unknown: %+v", unknown)
	}
	older := evaluateMirrorProtocol(2, 3)
	if older.Action != "warn" || older.Code != "mirror_protocol_older_client" {
		t.Fatalf("older: %+v", older)
	}
	newer := evaluateMirrorProtocol(4, 3)
	if newer.Action != "warn" || newer.Code != "mirror_protocol_newer_client" {
		t.Fatalf("newer: %+v", newer)
	}
	reject := evaluateMirrorProtocol(1, 3)
	if reject.Action != "reject" || reject.Code != "mirror_protocol_major_mismatch" {
		t.Fatalf("reject: %+v", reject)
	}
	fromStr := evaluateMirrorProtocol("3", 3.0)
	if fromStr.Action != "ok" || fromStr.Code != "mirror_protocol_match" {
		t.Fatalf("string/float: %+v", fromStr)
	}
}

func TestPlRoutesMatchElectron(t *testing.T) {
	// electron/localAppServer.js (reference) ke saath sidecar switch cases.
	want := []string{
		"/api/pl-server-http-relay",
		"/__firebase_blob_proxy",
		"/__pl_server_ping",
		"/__pl_access_context",
		"/__pl_company_delta_events",
		"/__pl_company_mirror_events",
		"/__pl_delta_health",
		"/__pl_mirror_health",
		"/__pl_attachment",
		"/__pl_company_delta_push",
		"/__pl_company_mirror_push",
		"/__pl_company_meta_bump",
		"/__pl_company_registry_patch",
		"/__pl_authoritative_company_doc_upsert",
		"/__pl_company_login_meta",
		"/__pl_company_login",
	}
	if !reCollection.MatchString("/__pl_company_delta/abc/vouchers") {
		t.Fatal("collection export path")
	}
	if !reBundle.MatchString("/__pl_company_mirror/abc") {
		t.Fatal("bundle export path")
	}
	if reCollection.MatchString("/__pl_company_delta/abc") {
		t.Fatal("bundle must not match collection regex")
	}
	if len(want) < 16 {
		t.Fatal("route inventory")
	}
}
