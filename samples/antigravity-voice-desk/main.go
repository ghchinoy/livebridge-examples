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

// Command antigravity-voice-desk pairs a stateless Gemini 3.8 Live voice/avatar
// edge with an isolated Gemini Managed Agents (Antigravity) Linux sandbox via
// async SSE streaming, AlertBus chimes, and visual artifact handoff.
package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/gorilla/websocket"

	"github.com/ghchinoy/livebridge"
)

const deskPersona = `You are an Executive Voice & Avatar Copilot backed by an isolated Antigravity Managed Agent Linux sandbox.
- Answer quick conversational questions directly.
- Whenever the user asks to write or run code, analyze data, plot charts, inspect repositories, or create files, call delegate_sandbox_task (setting output_file to 'workspace/chart.png' if plotting a visual chart).
- Because sandbox tasks run asynchronously in the background, keep chatting naturally until the background completion alert arrives; when an artifact frame arrives, describe what the chart shows concisely.`

func main() {
	ctx := context.Background()
	liveClients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	sandboxRunner, err := NewGenAIRunnerFromEnv(ctx)
	if err != nil {
		log.Fatal(err)
	}

	port := envOr("PORT", "8095")
	liveModel := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)
	agentID := envOr("GEMINI_MANAGED_AGENT", defaultManagedAgent)

	addr := ":" + port
	slog.Info("Antigravity Voice Desk listening",
		"url", "http://localhost"+addr,
		"liveModel", liveModel,
		"managedAgent", agentID,
	)
	srv := livebridge.NewHTTPServer(addr, newVoiceDeskMux(liveClients, sandboxRunner, liveModel, agentID))
	log.Fatal(srv.ListenAndServe())
}

func newVoiceDeskMux(
	connector livebridge.Connector,
	runner AgentRunner,
	defaultLiveModel, agentID string,
) *http.ServeMux {
	origins := livebridge.NewOriginPolicyFromEnv()
	upgrader := origins.Upgrader()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		rawConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		ws := livebridge.NewSafeConn(rawConn)
		defer func() { _ = ws.Close() }()

		ws.SetReadLimit(livebridge.MaxInitialConfigBytes)
		var clientSpec livebridge.SessionSpec
		if err := ws.ReadJSON(&clientSpec); err != nil {
			ws.WriteCloseAndDrain(websocket.CloseInvalidFramePayloadData, "Invalid session config")
			return
		}
		ws.SetReadLimit(livebridge.MaxClientMessageBytes)

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		alerts := livebridge.NewAlertBus(8)
		coord := NewSandboxCoordinator(ctx, runner, agentID, alerts)
		defer coord.Close()
		reg := coord.Registry()

		defaults := livebridge.SessionSpec{
			Mode:                     livebridge.ModeAudio,
			Model:                    defaultLiveModel,
			Location:                 livebridge.DefaultLocation,
			AvatarType:               "preset",
			AvatarData:               "Kira",
			VoiceName:                "Aoede",
			WelcomeMessage:           "Antigravity Voice Desk online. Ask me to run Python, analyze data, or plot a chart in the sandbox anytime.",
			SystemInstruction:        deskPersona,
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		}
		spec := livebridge.MergeSessionSpec(
			defaults,
			clientSpec,
			[]string{defaultLiveModel, "gemini-3.5-flash-lite-live-preview"},
			[]string{livebridge.DefaultLocation},
		)
		spec.ServerDeclarations = reg.Declarations()

		liveCfg, err := livebridge.BuildConnectConfig(spec)
		if err != nil {
			ws.WriteCloseAndDrain(websocket.CloseInvalidFramePayloadData, err.Error())
			return
		}

		upstream, err := connector.Connect(ctx, spec.Model, spec.Location, liveCfg)
		if err != nil {
			ws.WriteCloseAndDrain(websocket.CloseInternalServerErr, "Failed to connect")
			return
		}

		alertCh, unsub := alerts.Subscribe()
		defer unsub()

		bridge := livebridge.NewBridge(ctx, ws, upstream, livebridge.BridgeConfig{
			Mode:            spec.Mode,
			Model:           spec.Model,
			Location:        spec.Location,
			GreetingPrompt:  spec.EffectiveGreetingPrompt(),
			EmitSessionInfo: true,
			Tools:           livebridge.NewToolRunner(livebridge.ToolRunnerConfig{Registry: reg}),
			Alerts:          alertCh,
			FormatAlert: func(a livebridge.Alert) (string, any) {
				prompt := livebridge.FormatUntrustedAlert(
					"Summarize the completed Antigravity sandbox result for the user in 1-2 clear sentences.",
					map[string]string{"agent": a.Source, "event": a.Type, "title": a.Title},
					a.Text,
					900,
				)
				card := map[string]any{
					"type":    "proactive_alert",
					"id":      a.ID,
					"source":  a.Source,
					"summary": a.Title,
				}
				return prompt, card
			},
			OnSetupComplete: func(b *livebridge.Bridge) {
				coord.BindBridge(b)
			},
		})
		coord.BindBridge(bridge)
		defer bridge.Shutdown(0, "")
		bridge.Run()
	})

	if _, err := os.Stat("frontend/dist"); err == nil {
		mux.Handle("/", http.FileServer(http.Dir("frontend/dist")))
	}
	return mux
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
