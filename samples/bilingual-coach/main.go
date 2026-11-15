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

// Command bilingual-coach hosts a multilingual & interview practice partner
// exercising dynamic LanguageCode, AdaptationPhrases, VAD SilenceDurationMs
// patience tuning, and live rubric tool cards for a React 19 frontend.
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

const defaultCoachPersona = `You are an encouraging roleplay partner and communication coach.
Stay in character for the chosen scenario, keep each spoken turn short (1-3 sentences), and after every 1-2 user responses call score_turn to log a constructive fluency/clarity score and a natural phrasing tip.`

func main() {
	clients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	port := envOr("PORT", "8093")
	model := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)

	addr := ":" + port
	slog.Info("Bilingual Coach backend listening", "url", "http://localhost"+addr, "model", model)
	log.Fatal(livebridge.NewHTTPServer(addr, newCoachMux(clients, model)).ListenAndServe())
}

func newCoachMux(connector livebridge.Connector, defaultModel string) *http.ServeMux {
	reg := buildRubricRegistry()
	mux := http.NewServeMux()

	mux.Handle("GET /ws", livebridge.NewDynamicHandler(livebridge.DynamicHandlerConfig{
		Connector:        connector,
		Registry:         reg,
		AllowedModels:    []string{defaultModel, "gemini-3.5-flash-lite-live-preview"},
		AllowedLocations: []string{livebridge.DefaultLocation},
		Defaults: livebridge.SessionSpec{
			Mode:                     livebridge.ModeAudio,
			Model:                    defaultModel,
			Location:                 livebridge.DefaultLocation,
			AvatarType:               "preset",
			AvatarData:               "Kira",
			VoiceName:                "Aoede",
			LanguageCode:             "en-US",
			WelcomeMessage:           "Ready for our practice session! Let's jump right in.",
			SystemInstruction:        defaultCoachPersona,
			SilenceDurationMs:        900,
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		},
	}))

	if _, err := os.Stat("frontend/dist"); err == nil {
		mux.Handle("/", http.FileServer(http.Dir("frontend/dist")))
	}
	return mux
}

func buildRubricRegistry() *livebridge.FuncRegistry {
	reg := livebridge.NewFuncRegistry()
	reg.Register(&genai.FunctionDeclaration{
		Name:        "score_turn",
		Description: "Records live coaching rubric feedback for the user's latest spoken turn.",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"fluency": {
					Type:        genai.TypeInteger,
					Description: "Fluency/pacing score from 1 to 5.",
				},
				"clarity": {
					Type:        genai.TypeInteger,
					Description: "Clarity/precision score from 1 to 5.",
				},
				"better_phrasing": {
					Type:        genai.TypeString,
					Description: "A more idiomatic or concise way to express the user's point.",
				},
				"vocab_tip": {
					Type:        genai.TypeString,
					Description: "Key phrase, idiom, or technical term to remember.",
				},
			},
			Required: []string{"fluency", "clarity", "better_phrasing"},
		},
	}, func(_ context.Context, args map[string]any) (map[string]any, error) {
		return map[string]any{
			"status":          "recorded",
			"title":           "Coaching Feedback",
			"summary":         args["better_phrasing"],
			"fluency":         args["fluency"],
			"clarity":         args["clarity"],
			"better_phrasing": args["better_phrasing"],
			"vocab_tip":       args["vocab_tip"],
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
