// Rust (Tauri) <-> Go sidecar line protocol (stdin/stdout).
//
// Go -> Rust (stdout):  "PLMSG " + JSON  ({t:"rpc"|"ctlres"|"event", ...})
// Rust -> Go (stdin):   JSON per line    ({t:"rpcres"|"ctl", ...})
//
// rpc   = Go Rust se webview kaam maangta hai (eval / candidates / bridgeOpen / broadcast).
// ctl   = Rust Go se local-server kaam maangta hai (getStatus, start, tokens, ...).
// event = Go ki taraf se state change (tray / power-save sync ke liye).
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

type rpcHub struct {
	outMu   sync.Mutex
	out     io.Writer
	next    atomic.Int64
	mu      sync.Mutex
	pending map[int64]chan json.RawMessage
	enabled bool
	onCtl   func(op string, args json.RawMessage) any
}

func newRPCHub(out io.Writer, enabled bool) *rpcHub {
	return &rpcHub{out: out, pending: map[int64]chan json.RawMessage{}, enabled: enabled}
}

func (h *rpcHub) send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("rpc marshal: %v", err)
		return
	}
	h.outMu.Lock()
	defer h.outMu.Unlock()
	_, _ = h.out.Write(append(append([]byte("PLMSG "), b...), '\n'))
	if f, ok := h.out.(*os.File); ok {
		_ = f.Sync()
	}
}

var errRPCUnavailable = errors.New("rpc_unavailable")
var errRPCTimeout = errors.New("rpc_timeout")

// call: Rust se kaam karwao, jawab ka intezar (timeout tak).
func (h *rpcHub) call(op string, args map[string]any, timeout time.Duration) (json.RawMessage, error) {
	if h == nil || !h.enabled {
		return nil, errRPCUnavailable
	}
	id := h.next.Add(1)
	ch := make(chan json.RawMessage, 1)
	h.mu.Lock()
	h.pending[id] = ch
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.pending, id)
		h.mu.Unlock()
	}()
	h.send(map[string]any{"t": "rpc", "id": id, "op": op, "args": args})
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(timeout):
		return nil, errRPCTimeout
	}
}

func (h *rpcHub) event(op string, payload any) {
	if h == nil || !h.enabled {
		return
	}
	h.send(map[string]any{"t": "event", "op": op, "payload": payload})
}

type inbound struct {
	T      string          `json:"t"`
	ID     int64           `json:"id"`
	Op     string          `json:"op"`
	Args   json.RawMessage `json:"args"`
	Result json.RawMessage `json:"result"`
}

// readLoop: stdin se Rust ke messages. EOF = parent gaya -> onEOF.
func (h *rpcHub) readLoop(in io.Reader, onEOF func()) {
	r := bufio.NewReaderSize(in, 1<<20)
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 1 {
			var m inbound
			if json.Unmarshal(line, &m) == nil {
				switch m.T {
				case "rpcres":
					h.mu.Lock()
					ch := h.pending[m.ID]
					h.mu.Unlock()
					if ch != nil {
						select {
						case ch <- m.Result:
						default:
						}
					}
				case "ctl":
					go func(m inbound) {
						var res any
						func() {
							defer func() {
								if p := recover(); p != nil {
									log.Printf("ctl %s panic: %v", m.Op, p)
									res = map[string]any{"ok": false, "error": "internal_error"}
								}
							}()
							if h.onCtl != nil {
								res = h.onCtl(m.Op, m.Args)
							}
						}()
						h.send(map[string]any{"t": "ctlres", "id": m.ID, "result": res})
					}(m)
				}
			}
		}
		if err != nil {
			if onEOF != nil {
				onEOF()
			}
			return
		}
	}
}
