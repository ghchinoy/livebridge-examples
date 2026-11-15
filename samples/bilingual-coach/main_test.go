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
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

func TestBilingualCoach_PropagatesLanguageVADAndRubricTool(t *testing.T) {
	sess := &coachFakeSession{recvCh: make(chan *genai.LiveServerMessage, 8), done: make(chan struct{})}
	fc := &coachFakeConnector{s: sess}
	srv := httptest.NewServer(newCoachMux(fc, livebridge.DefaultModel))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.WriteJSON(map[string]any{
		"mode":              "audio",
		"languageCode":      "es-US",
		"silenceDurationMs": 1350,
		"adaptationPhrases": []string{"reserva", "equipaje"},
	}); err != nil {
		t.Fatalf("conn.WriteJSON(setup) failed: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("newCoachMux(/ws) first frame = %+v (err=%v), want session_info", info, err)
	}

	fc.mu.Lock()
	cfg := fc.lastCfg
	fc.mu.Unlock()
	if cfg == nil || cfg.SpeechConfig == nil || cfg.SpeechConfig.LanguageCode != "es-US" {
		t.Fatalf("newCoachMux(es-US).SpeechConfig = %+v, want LanguageCode=\"es-US\"", cfg)
	}
	if cfg.RealtimeInputConfig == nil || cfg.RealtimeInputConfig.AutomaticActivityDetection == nil ||
		*cfg.RealtimeInputConfig.AutomaticActivityDetection.SilenceDurationMs != 1350 {
		t.Errorf("newCoachMux(silenceDurationMs=1350).RealtimeInputConfig = %+v, want 1350ms", cfg.RealtimeInputConfig)
	}
	if len(cfg.InputAudioTranscription.AdaptationPhrases) != 2 {
		t.Errorf("newCoachMux(adaptationPhrases) count = %d, want 2", len(cfg.InputAudioTranscription.AdaptationPhrases))
	}
}

type coachFakeSession struct {
	recvCh chan *genai.LiveServerMessage
	done   chan struct{}
}

func (s *coachFakeSession) SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error { return nil }
func (s *coachFakeSession) SendToolResponse(genai.LiveSendToolResponseParameters) error   { return nil }
func (s *coachFakeSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}
func (s *coachFakeSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type coachFakeConnector struct {
	mu      sync.Mutex
	s       *coachFakeSession
	lastCfg *genai.LiveConnectConfig
}

func (c *coachFakeConnector) Connect(_ context.Context, _, _ string, cfg *genai.LiveConnectConfig) (livebridge.Session, error) {
	c.mu.Lock()
	c.lastCfg = cfg
	c.mu.Unlock()
	return c.s, nil
}
