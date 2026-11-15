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
	"encoding/base64"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

func TestWhiteboardArchitect_GetBoardAndVisualCanvasRelay(t *testing.T) {
	sess := &boardFakeSession{recvCh: make(chan *genai.LiveServerMessage, 8), done: make(chan struct{})}
	srv := httptest.NewServer(newWhiteboardMux(boardFakeConnector{s: sess}, livebridge.DefaultModel))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/live"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.WriteJSON(map[string]any{
		"tools": []map[string]any{
			{"name": "get_board", "description": "Reads board state", "inputSchema": map[string]any{"type": "object"}},
			{"name": "add_node", "description": "Adds box", "inputSchema": map[string]any{"type": "object"}},
			{"name": "rogue_tool", "description": "Blocked", "inputSchema": map[string]any{"type": "object"}},
		},
	})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var rejectedFrame map[string]any
	if err := conn.ReadJSON(&rejectedFrame); err != nil || rejectedFrame["type"] != "tools_rejected" {
		t.Fatalf("newWhiteboardMux(rogue_tool) first frame = %+v (err=%v), want tools_rejected", rejectedFrame, err)
	}

	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("newWhiteboardMux(/ws/live) second frame = %+v (err=%v), want session_info", info, err)
	}

	// 1. Read-only get_board sends structured state with no video frame.
	sess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "wb-0",
				Name: "get_board",
				Args: map[string]any{},
			}},
		},
	}

	var getCall map[string]any
	if err := conn.ReadJSON(&getCall); err != nil || getCall["name"] != "get_board" {
		t.Fatalf("newWhiteboardMux(get_board) frame = %+v (err=%v), want get_board tool_call", getCall, err)
	}
	_ = conn.WriteJSON(map[string]any{
		"type":   "tool_result",
		"id":     "wb-0",
		"result": map[string]any{"revision": 0, "nodes": []any{}, "edges": []any{}, "strokeCount": 0},
		"execMs": 1,
	})
	var getTiming map[string]any
	if err := conn.ReadJSON(&getTiming); err != nil || getTiming["type"] != "tool_timing" {
		t.Fatalf("newWhiteboardMux(get_board timing) frame = %+v (err=%v), want tool_timing", getTiming, err)
	}

	// 2. Mutating add_node sends JPEG snapshot strictly before tool response.
	sess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "wb-1",
				Name: "add_node",
				Args: map[string]any{"id": "redis", "label": "Redis Cache"},
			}},
		},
	}

	var callMsg map[string]any
	if err := conn.ReadJSON(&callMsg); err != nil || callMsg["name"] != "add_node" {
		t.Fatalf("newWhiteboardMux(add_node) frame = %+v (err=%v), want add_node tool_call", callMsg, err)
	}

	jpegURL := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0})
	_ = conn.WriteJSON(map[string]any{
		"type":   "tool_result",
		"id":     "wb-1",
		"result": map[string]any{"added": "redis", "revision": 1},
		"image":  jpegURL,
		"execMs": 8,
	})

	var timing map[string]any
	if err := conn.ReadJSON(&timing); err != nil || timing["type"] != "tool_timing" {
		t.Fatalf("newWhiteboardMux(EmitToolTiming) frame = %+v (err=%v), want tool_timing", timing, err)
	}

	sess.mu.Lock()
	gotOrder := strings.Join(sess.events, ",")
	sess.mu.Unlock()
	const wantOrder = "tool:get_board,video:image/jpeg,tool:add_node"
	if gotOrder != wantOrder {
		t.Errorf("newWhiteboardMux(get_board + add_node) upstream order = %q, want %q", gotOrder, wantOrder)
	}
}

type boardFakeSession struct {
	mu     sync.Mutex
	recvCh chan *genai.LiveServerMessage
	events []string
	done   chan struct{}
}

func (s *boardFakeSession) SendRealtimeInput(p genai.LiveSendRealtimeInputParameters) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.Video != nil {
		s.events = append(s.events, "video:"+p.Video.MIMEType)
	}
	return nil
}
func (s *boardFakeSession) SendToolResponse(p genai.LiveSendToolResponseParameters) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range p.FunctionResponses {
		s.events = append(s.events, "tool:"+r.Name)
	}
	return nil
}
func (s *boardFakeSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}
func (s *boardFakeSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type boardFakeConnector struct{ s *boardFakeSession }

func (c boardFakeConnector) Connect(context.Context, string, string, *genai.LiveConnectConfig) (livebridge.Session, error) {
	return c.s, nil
}
