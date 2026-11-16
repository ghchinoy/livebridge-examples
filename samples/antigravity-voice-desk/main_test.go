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
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

func TestAntigravityVoiceDesk_DelegatesStreamsStepsArtifactsAndAlertBus(t *testing.T) {
	liveSess := &deskFakeLiveSession{recvCh: make(chan *genai.LiveServerMessage, 16), done: make(chan struct{})}
	runner := &fakeAgentRunner{
		result: SandboxResult{
			InteractionID: "int-101",
			EnvironmentID: "env-sandbox-9",
			OutputText:    "Generated 30 primes and plotted workspace/primes.png.",
			ArtifactPath:  "workspace/primes.png",
			ArtifactMIME:  "image/png",
			ArtifactBytes: []byte{0x89, 0x50, 0x4E, 0x47},
		},
	}

	srv := httptest.NewServer(newVoiceDeskMux(
		deskFakeConnector{s: liveSess},
		runner,
		livebridge.DefaultModel,
		defaultManagedAgent,
	))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.WriteJSON(map[string]any{"mode": "audio"}); err != nil {
		t.Fatalf("conn.WriteJSON(setup) failed: %v", err)
	}

	liveSess.recvCh <- &genai.LiveServerMessage{SetupComplete: &genai.LiveServerSetupComplete{}}
	liveSess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "call-ag-1",
				Name: "delegate_sandbox_task",
				Args: map[string]any{
					"task":        "Plot primes",
					"output_file": "workspace/primes.png",
				},
			}},
		},
	}

	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var sawArtifact, sawProactiveAlert, sawCompletedStep bool
	for !sawArtifact || !sawProactiveAlert || !sawCompletedStep {
		var msg map[string]any
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("conn.ReadJSON() while awaiting sandbox events failed: %v", err)
		}
		switch msg["type"] {
		case "sandbox_artifact":
			if msg["environmentId"] == "env-sandbox-9" && msg["path"] == "workspace/primes.png" {
				sawArtifact = true
			}
		case "proactive_alert":
			sawProactiveAlert = true
		case "sandbox_step":
			if msg["kind"] == "completed" {
				sawCompletedStep = true
			}
		}
	}

	// Verify the PNG artifact was also streamed as a realtime Video frame to
	// Gemini 3.8 Live AND untrusted alert text was injected via SendRealtimeInput.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		liveSess.mu.Lock()
		hasVideo := liveSess.sawVideo
		hasAlertPrompt := liveSess.sawAlertText
		liveSess.mu.Unlock()
		if hasVideo && hasAlertPrompt {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Errorf("newVoiceDeskMux(delegate_sandbox_task) upstream sawVideo=%v sawAlertText=%v, want both true",
		liveSess.sawVideo, liveSess.sawAlertText)
}

func TestAutoDiscoverArtifact_FindsUnrequestedStockChartAndIgnoresVenvAssets(t *testing.T) {
	filesSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1beta/environments/env-42/files":
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Query().Get("page_token") == "p2" {
				_, _ = w.Write([]byte(`{
					"files": [
						{"name":"goog_stock_price.png","path":"workspace/goog_stock_price.png","type":"FILE","mime_type":"image/png","modified":"2026-11-15T10:04:00Z"}
					]
				}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"files": [
					{"name":"home.png","path":".venv/lib/python3.12/site-packages/matplotlib/mpl-data/images/home.png","type":"FILE","modified":"2026-11-15T10:05:00Z"},
					{"name":"chart.png","path":"workspace/chart.png","type":"FILE","modified":"2026-11-15T09:00:00Z"}
				],
				"next_page_token": "p2"
			}`))
		case "/v1beta/environments/env-42/files/workspace/goog_stock_price.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte{0x89, 0x50, 0x4E, 0x47})
		case "/v1beta/environments/env-42/files/workspace/chart.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("stale-chart"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer filesSrv.Close()

	runner := &GenAIRunner{
		apiKey:       "test-key",
		filesBaseURL: filesSrv.URL,
		httpClient:   filesSrv.Client(),
	}
	before := map[string]string{
		"workspace/chart.png": "2026-11-15T09:00:00Z",
	}

	// Even if Gemini Live passed output_file="workspace/chart.png", unchanged
	// Turn-1 chart.png must be skipped in favor of newly created goog_stock_price.png.
	gotPath, gotMIME, gotBytes := runner.resolveAndDownloadArtifact(t.Context(), "env-42", "workspace/chart.png", before)
	if gotPath != "workspace/goog_stock_price.png" || gotMIME != "image/png" || len(gotBytes) != 4 {
		t.Errorf("resolveAndDownloadArtifact(env-42, \"workspace/chart.png\") = (%q, %q, %d bytes), want (\"workspace/goog_stock_price.png\", \"image/png\", 4 bytes)",
			gotPath, gotMIME, len(gotBytes))
	}
}

type fakeAgentRunner struct {
	mu          sync.Mutex
	result      SandboxResult
	cancelledID string
}

func (r *fakeAgentRunner) RunStream(
	_ context.Context,
	_, _, _, _, _ string,
	onStep func(kind, summary, interactionID string),
) (SandboxResult, error) {
	onStep("code_execution", "Step 1: executing Python in sandbox", r.result.InteractionID)
	return r.result, nil
}

func (r *fakeAgentRunner) Cancel(_ context.Context, interactionID string) error {
	r.mu.Lock()
	r.cancelledID = interactionID
	r.mu.Unlock()
	return nil
}

type deskFakeLiveSession struct {
	mu           sync.Mutex
	recvCh       chan *genai.LiveServerMessage
	sawVideo     bool
	sawAlertText bool
	done         chan struct{}
}

func (s *deskFakeLiveSession) SendRealtimeInput(p genai.LiveSendRealtimeInputParameters) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.Video != nil && p.Video.MIMEType == "image/png" {
		s.sawVideo = true
	}
	if strings.Contains(p.Text, "BEGIN UNTRUSTED PAYLOAD") {
		s.sawAlertText = true
	}
	return nil
}

func (s *deskFakeLiveSession) SendToolResponse(genai.LiveSendToolResponseParameters) error {
	return nil
}

func (s *deskFakeLiveSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}

func (s *deskFakeLiveSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type deskFakeConnector struct{ s *deskFakeLiveSession }

func (c deskFakeConnector) Connect(context.Context, string, string, *genai.LiveConnectConfig) (livebridge.Session, error) {
	return c.s, nil
}
