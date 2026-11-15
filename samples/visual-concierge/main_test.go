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
	"context"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

func TestVisualConcierge_AvatarSetupAndChecklistTool(t *testing.T) {
	sess := &conciergeFakeSession{recvCh: make(chan *genai.LiveServerMessage, 8), done: make(chan struct{})}
	srv := httptest.NewServer(newConciergeMux(conciergeFakeConnector{s: sess}, livebridge.DefaultModel))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.WriteJSON(map[string]any{"mode": "avatar", "avatarData": "Kira"}); err != nil {
		t.Fatalf("conn.WriteJSON(setup) failed: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["mode"] != "avatar" {
		t.Fatalf("newConciergeMux(/ws) session_info = %+v (err=%v), want mode=\"avatar\"", info, err)
	}

	sess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "chk-1",
				Name: "upsert_checklist",
				Args: map[string]any{
					"title":   "Router LED Check",
					"items":   []any{"Verify power LED", "Inspect WAN cable"},
					"summary": "Amber WAN light visible",
				},
			}},
		},
	}

	var toolMsg map[string]any
	if err := conn.ReadJSON(&toolMsg); err != nil || toolMsg["type"] != "tool_call" {
		t.Fatalf("newConciergeMux(upsert_checklist) frame = %+v (err=%v), want tool_call", toolMsg, err)
	}
	res, _ := toolMsg["result"].(map[string]any)
	if got := res["title"]; got != "Router LED Check" {
		t.Errorf("upsert_checklist(\"Router LED Check\").title = %v, want %q", got, "Router LED Check")
	}
}

type conciergeFakeSession struct {
	recvCh chan *genai.LiveServerMessage
	done   chan struct{}
}

func (s *conciergeFakeSession) SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error {
	return nil
}
func (s *conciergeFakeSession) SendToolResponse(genai.LiveSendToolResponseParameters) error {
	return nil
}
func (s *conciergeFakeSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}
func (s *conciergeFakeSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type conciergeFakeConnector struct{ s *conciergeFakeSession }

func (c conciergeFakeConnector) Connect(context.Context, string, string, *genai.LiveConnectConfig) (livebridge.Session, error) {
	return c.s, nil
}
