// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

func TestPocketBriefing_InboxScanMemoAlertAndActionItem(t *testing.T) {
	sess := &briefingFakeSession{recvCh: make(chan *genai.LiveServerMessage, 8), done: make(chan struct{})}
	alerts := livebridge.NewAlertBus(8)
	store := &actionStore{}

	// Verify inbox directory scanner publishes new .md memos onto AlertBus.
	inbox := t.TempDir()
	seen := make(map[string]time.Time)
	scanInboxOnce(inbox, seen, false, alerts)
	if err := os.WriteFile(filepath.Join(inbox, "deploy.md"), []byte("Canary green."), 0o644); err != nil {
		t.Fatalf("os.WriteFile(deploy.md) failed: %v", err)
	}
	scanInboxOnce(inbox, seen, true, alerts)

	srv := httptest.NewServer(newBriefingMux(briefingFakeConnector{s: sess}, alerts, store, livebridge.DefaultModel))
	defer srv.Close()

	// Verify embedded /livebridge.js is served.
	jsResp, err := http.Get(srv.URL + "/livebridge.js")
	if err != nil {
		t.Fatalf("http.Get(/livebridge.js) failed: %v", err)
	}
	_ = jsResp.Body.Close()
	if jsResp.StatusCode != http.StatusOK {
		t.Errorf("newBriefingMux(GET /livebridge.js) status = %d, want %d", jsResp.StatusCode, http.StatusOK)
	}

	// Connect WebSocket -> SetupComplete flushes queued inbox file alert.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/live"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("newBriefingMux(/ws/live) first frame = %+v (err=%v), want session_info", info, err)
	}

	sess.recvCh <- &genai.LiveServerMessage{SetupComplete: &genai.LiveServerSetupComplete{}}

	var alertMsg map[string]any
	if err := conn.ReadJSON(&alertMsg); err != nil || alertMsg["summary"] != "deploy.md" {
		t.Fatalf("newBriefingMux(inbox backlog) frame = %+v (err=%v), want summary=\"deploy.md\"", alertMsg, err)
	}

	// Trigger save_action_item tool and verify GET /api/actions reflects it.
	sess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "act-call-1",
				Name: "save_action_item",
				Args: map[string]any{"task": "Promote canary to 100%", "owner": "sre"},
			}},
		},
	}

	var toolMsg map[string]any
	if err := conn.ReadJSON(&toolMsg); err != nil || toolMsg["type"] != "tool_call" {
		t.Fatalf("newBriefingMux(save_action_item) frame = %+v (err=%v), want tool_call", toolMsg, err)
	}

	// Also verify POST /api/memo endpoint.
	memoBody, _ := json.Marshal(memoPayload{From: "ops", Subject: "All clear", Body: "Done"})
	memoResp, err := http.Post(srv.URL+"/api/memo", "application/json", bytes.NewReader(memoBody))
	if err != nil {
		t.Fatalf("http.Post(/api/memo) failed: %v", err)
	}
	_ = memoResp.Body.Close()
	if memoResp.StatusCode != http.StatusOK {
		t.Errorf("newBriefingMux(POST /api/memo) status = %d, want %d", memoResp.StatusCode, http.StatusOK)
	}

	actionsResp, err := http.Get(srv.URL + "/api/actions")
	if err != nil {
		t.Fatalf("http.Get(/api/actions) failed: %v", err)
	}
	var actions []actionItem
	_ = json.NewDecoder(actionsResp.Body).Decode(&actions)
	_ = actionsResp.Body.Close()
	if len(actions) != 1 || actions[0].Task != "Promote canary to 100%" {
		t.Errorf("newBriefingMux(GET /api/actions) = %+v, want [Promote canary to 100%%]", actions)
	}
}

type briefingFakeSession struct {
	recvCh chan *genai.LiveServerMessage
	done   chan struct{}
}

func (s *briefingFakeSession) SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error {
	return nil
}
func (s *briefingFakeSession) SendToolResponse(genai.LiveSendToolResponseParameters) error {
	return nil
}
func (s *briefingFakeSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}
func (s *briefingFakeSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type briefingFakeConnector struct{ s *briefingFakeSession }

func (c briefingFakeConnector) Connect(context.Context, string, string, *genai.LiveConnectConfig) (livebridge.Session, error) {
	return c.s, nil
}
