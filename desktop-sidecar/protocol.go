// P2P delta/mirror protocol — electron/plMirrorProtocol.cjs + src/lib/plMirrorProtocol.ts ka 1:1 port.
package main

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

const mirrorProtocolVersion = 3
const mirrorProtocolMajorRejectDelta = 2

type mirrorEval struct {
	Action         string  `json:"action"`
	Code           string  `json:"code"`
	Message        string  `json:"message,omitempty"`
	ClientProtocol *int    `json:"clientProtocol"`
	ServerProtocol *int    `json:"serverProtocol"`
}

func protoInt(v any) (int, bool) {
	switch x := v.(type) {
	case nil:
		return 0, false
	case float64:
		if x <= 0 || math.IsNaN(x) || math.IsInf(x, 0) || x != math.Trunc(x) {
			return 0, false
		}
		return int(x), true
	case json.Number:
		f, err := x.Float64()
		if err != nil || f <= 0 || f != math.Trunc(f) {
			return 0, false
		}
		return int(f), true
	case int:
		if x <= 0 {
			return 0, false
		}
		return x, true
	case int64:
		if x <= 0 {
			return 0, false
		}
		return int(x), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil || f <= 0 || math.IsNaN(f) || f != math.Trunc(f) {
			return 0, false
		}
		return int(f), true
	default:
		return 0, false
	}
}

func ptrInt(n int) *int { return &n }

func evaluateMirrorProtocol(clientProtocol, serverProtocol any) mirrorEval {
	c, cok := protoInt(clientProtocol)
	s, sok := protoInt(serverProtocol)
	base := mirrorEval{Action: "ok", Code: "mirror_protocol_unknown"}
	if cok {
		base.ClientProtocol = ptrInt(c)
	}
	if sok {
		base.ServerProtocol = ptrInt(s)
	}
	if !cok || !sok {
		return base
	}
	diff := c - s
	abs := diff
	if abs < 0 {
		abs = -abs
	}
	out := mirrorEval{Action: "ok", Code: "mirror_protocol_match", ClientProtocol: ptrInt(c), ServerProtocol: ptrInt(s)}
	if abs == 0 {
		return out
	}
	if abs >= mirrorProtocolMajorRejectDelta {
		return mirrorEval{
			Action:         "reject",
			Code:           "mirror_protocol_major_mismatch",
			Message:        "Delta protocol major mismatch (client " + strconv.Itoa(c) + ", server " + strconv.Itoa(s) + "). Update Pocket Ledger on both PCs to the same version.",
			ClientProtocol: ptrInt(c),
			ServerProtocol: ptrInt(s),
		}
	}
	if diff < 0 {
		return mirrorEval{
			Action:         "warn",
			Code:           "mirror_protocol_older_client",
			Message:        "Client delta protocol " + strconv.Itoa(c) + " is older than server " + strconv.Itoa(s) + ". Update the client app when possible.",
			ClientProtocol: ptrInt(c),
			ServerProtocol: ptrInt(s),
		}
	}
	return mirrorEval{
		Action:         "warn",
		Code:           "mirror_protocol_newer_client",
		Message:        "Client delta protocol " + strconv.Itoa(c) + " is newer than server " + strconv.Itoa(s) + ". Update the server PC app when possible.",
		ClientProtocol: ptrInt(c),
		ServerProtocol: ptrInt(s),
	}
}
