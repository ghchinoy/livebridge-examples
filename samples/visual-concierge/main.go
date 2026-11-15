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

// Command visual-concierge pairs a talking Gemini Live video avatar with 1 FPS
// camera/screen vision and a structured troubleshooting checklist tool.
package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"

	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

const systemPersona = `You are an observant visual troubleshooting concierge.
When the user turns on their camera or shares their screen, describe concrete visual details you observe.
Whenever giving multi-step guidance, diagnostics, or inspection steps, call upsert_checklist so the user sees a live structured checklist alongside your spoken guidance.`

var allowedModels = []string{
	livebridge.DefaultModel,
	"gemini-3.5-flash-lite-live-preview",
}

func main() {
	clients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	port := envOr("PORT", "8091")
	model := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)

	addr := ":" + port
	slog.Info("Visual Concierge backend listening", "url", "http://localhost"+addr, "model", model)
	log.Fatal(livebridge.NewHTTPServer(addr, newConciergeMux(clients, model)).ListenAndServe())
}

func newConciergeMux(connector livebridge.Connector, defaultModel string) *http.ServeMux {
	reg := buildChecklistRegistry()
	mux := http.NewServeMux()

	mux.Handle("GET /ws", livebridge.NewDynamicHandler(livebridge.DynamicHandlerConfig{
		Connector:        connector,
		Registry:         reg,
		AllowedModels:    allowedModels,
		AllowedLocations: []string{livebridge.DefaultLocation},
		Defaults: livebridge.SessionSpec{
			Mode:                     livebridge.ModeAvatar,
			Model:                    defaultModel,
			Location:                 livebridge.DefaultLocation,
			AvatarType:               "preset",
			AvatarData:               "Kira",
			VoiceName:                "Kore",
			WelcomeMessage:           "Hi! I am your Visual Concierge. Turn on your camera or screen share whenever you want me to take a look.",
			SystemInstruction:        systemPersona,
			EnableGoogleSearch:       livebridge.Bool(true),
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		},
	}))

	if _, err := os.Stat("frontend/dist"); err == nil {
		mux.Handle("/", http.FileServer(http.Dir("frontend/dist")))
	}
	return mux
}

func buildChecklistRegistry() *livebridge.FuncRegistry {
	reg := livebridge.NewFuncRegistry()
	reg.Register(&genai.FunctionDeclaration{
		Name:        "upsert_checklist",
		Description: "Creates or updates the live visual troubleshooting checklist and field notes shown next to the avatar.",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"title": {
					Type:        genai.TypeString,
					Description: "Short heading for the current inspection or task.",
				},
				"items": {
					Type:        genai.TypeArray,
					Description: "Ordered checklist steps.",
					Items:       &genai.Schema{Type: genai.TypeString},
				},
				"completed": {
					Type:        genai.TypeArray,
					Description: "Zero-based indices of steps confirmed complete.",
					Items:       &genai.Schema{Type: genai.TypeInteger},
				},
				"summary": {
					Type:        genai.TypeString,
					Description: "Concise observation note from camera or screen inspection.",
				},
			},
			Required: []string{"title", "items"},
		},
	}, func(_ context.Context, args map[string]any) (map[string]any, error) {
		title, _ := args["title"].(string)
		return map[string]any{
			"status":    "updated",
			"title":     title,
			"items":     args["items"],
			"completed": args["completed"],
			"summary":   args["summary"],
		}, nil
	})
	return reg
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
