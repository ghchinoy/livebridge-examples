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
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/genai"
	"google.golang.org/genai/interactions/models/interactions"
	"google.golang.org/genai/interactions/models/operations"

	"github.com/ghchinoy/livebridge"
)

const defaultManagedAgent = "antigravity-preview-09-2026"

// SandboxResult holds the completed output of a Managed Agent interaction.
type SandboxResult struct {
	InteractionID string
	EnvironmentID string
	OutputText    string
	ArtifactPath  string
	ArtifactMIME  string
	ArtifactBytes []byte
}

// AgentRunner abstracts the Gemini Managed Agents Interactions & Environment
// Files APIs so SandboxCoordinator can be unit-tested hermetically without
// live sandbox quota, and graduated cleanly into livebridge/managedagent.
type AgentRunner interface {
	RunStream(
		ctx context.Context,
		agentID string,
		prompt string,
		environmentID string,
		previousInteractionID string,
		outputFile string,
		onStep func(kind, summary, interactionID string),
	) (SandboxResult, error)
	Cancel(ctx context.Context, interactionID string) error
}

// GenAIRunner implements AgentRunner on top of google.golang.org/genai's
// native Interactions service plus the v1beta environment files endpoint.
type GenAIRunner struct {
	client     *genai.Client
	apiKey     string
	apiVersion string
	httpClient *http.Client
}

// NewGenAIRunnerFromEnv constructs a GenAIRunner preferring GEMINI_API_KEY /
// GOOGLE_API_KEY (AI Studio Managed Agents v1beta) and falling back to Google
// Cloud ADC (GOOGLE_CLOUD_PROJECT, global v1beta1) when unset.
func NewGenAIRunnerFromEnv(ctx context.Context) (*GenAIRunner, error) {
	apiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY"))
	}
	if apiKey != "" {
		client, err := genai.NewClient(ctx, &genai.ClientConfig{
			Backend:     genai.BackendGeminiAPI,
			APIKey:      apiKey,
			HTTPOptions: genai.HTTPOptions{APIVersion: "v1beta"},
		})
		if err != nil {
			return nil, fmt.Errorf("creating Gemini API interactions client: %w", err)
		}
		return &GenAIRunner{
			client:     client,
			apiKey:     apiKey,
			apiVersion: "v1beta",
			httpClient: &http.Client{Timeout: 60 * time.Second},
		}, nil
	}

	projectID := strings.TrimSpace(os.Getenv("GOOGLE_CLOUD_PROJECT"))
	if projectID == "" {
		return nil, errors.New("missing GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT for Managed Agents")
	}
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		Backend:     genai.BackendVertexAI,
		Project:     projectID,
		Location:    "global",
		HTTPOptions: genai.HTTPOptions{APIVersion: "v1beta1"},
	})
	if err != nil {
		return nil, fmt.Errorf("creating Cloud interactions client: %w", err)
	}
	return &GenAIRunner{
		client:     client,
		apiVersion: "v1beta1",
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}, nil
}

// RunStream executes a streaming Managed Agent interaction, invokes onStep on
// progress events, fetches the final Interaction metadata (for EnvironmentID),
// and optionally downloads a generated file from the sandbox.
func (r *GenAIRunner) RunStream(
	ctx context.Context,
	agentID, prompt, environmentID, previousInteractionID, outputFile string,
	onStep func(kind, summary, interactionID string),
) (SandboxResult, error) {
	envTarget := "remote"
	if strings.TrimSpace(environmentID) != "" {
		envTarget = strings.TrimSpace(environmentID)
	}
	body := interactions.CreateAgentInteraction{
		Agent:       interactions.AgentOption(agentID),
		Input:       genai.Ptr(interactions.NewInteractionsInput(prompt)),
		Environment: genai.Ptr(interactions.NewCreateAgentInteractionEnvironment(envTarget)),
		Stream:      genai.Ptr(true),
	}
	if strings.TrimSpace(previousInteractionID) != "" {
		body.PreviousInteractionID = genai.Ptr(strings.TrimSpace(previousInteractionID))
	}

	res, err := r.client.Interactions.Create(ctx, operations.CreateInteractionRequest{
		APIVersion: genai.Ptr(r.apiVersion),
		Body:       operations.NewCreateInteractionRequestBody(body),
	})
	if err != nil {
		return SandboxResult{}, fmt.Errorf("starting managed agent interaction: %w", err)
	}

	interactionID, streamedEnvID, outputText, err := consumeInteractionResponse(res, environmentID, onStep)
	if err != nil {
		return SandboxResult{}, err
	}

	out := SandboxResult{
		InteractionID: interactionID,
		EnvironmentID: streamedEnvID,
		OutputText:    outputText,
	}

	if interactionID != "" {
		full, getErr := r.client.Interactions.Get(ctx, operations.GetInteractionByIDRequest{
			APIVersion: genai.Ptr(r.apiVersion),
			ID:         interactionID,
		})
		if getErr == nil && full.Interaction != nil {
			if full.Interaction.EnvironmentID != nil && *full.Interaction.EnvironmentID != "" {
				out.EnvironmentID = *full.Interaction.EnvironmentID
			}
			if out.OutputText == "" && full.Interaction.OutputText != nil {
				out.OutputText = strings.TrimSpace(*full.Interaction.OutputText)
			}
		}
	}

	if outputFile != "" && out.EnvironmentID != "" && r.apiKey != "" {
		mime, data, dlErr := r.downloadSandboxFile(ctx, out.EnvironmentID, outputFile)
		if dlErr != nil {
			slog.Warn("downloading sandbox artifact", "path", outputFile, "err", dlErr)
			return out, nil
		}
		out.ArtifactPath = outputFile
		out.ArtifactMIME = mime
		out.ArtifactBytes = data
	}
	return out, nil
}

// Cancel aborts an in-flight Managed Agent interaction by ID.
func (r *GenAIRunner) Cancel(ctx context.Context, interactionID string) error {
	if strings.TrimSpace(interactionID) == "" {
		return nil
	}
	_, err := r.client.Interactions.Cancel(ctx, operations.CancelInteractionByIDRequest{
		APIVersion: genai.Ptr(r.apiVersion),
		ID:         interactionID,
	})
	return err
}

// SandboxCoordinator binds one browser Live session to a stateful Managed Agent
// sandbox (environment_id + previous_interaction_id) and streams async progress
// back via AlertBus and browser WebSocket frames.
type SandboxCoordinator struct {
	baseCtx context.Context
	runner  AgentRunner
	agentID string
	alerts  *livebridge.AlertBus

	mu                    sync.Mutex
	bridge                *livebridge.Bridge
	environmentID         string
	previousInteractionID string
	activeJobID           string
	activeInteractionID   string
	activeCancel          context.CancelFunc
	stepsCompleted        int
	latestStep            string
	seq                   atomic.Uint64
}

// NewSandboxCoordinator creates a per-session coordinator bound to sessionCtx.
func NewSandboxCoordinator(
	sessionCtx context.Context,
	runner AgentRunner,
	agentID string,
	alerts *livebridge.AlertBus,
) *SandboxCoordinator {
	if strings.TrimSpace(agentID) == "" {
		agentID = defaultManagedAgent
	}
	return &SandboxCoordinator{
		baseCtx: sessionCtx,
		runner:  runner,
		agentID: agentID,
		alerts:  alerts,
	}
}

// BindBridge attaches the live Bridge once WebSocket setup completes so visual
// sandbox artifacts and live step telemetry can stream directly to the session.
func (sc *SandboxCoordinator) BindBridge(b *livebridge.Bridge) {
	sc.mu.Lock()
	sc.bridge = b
	sc.mu.Unlock()
}

// Close aborts any in-flight sandbox job when the Live session disconnects.
func (sc *SandboxCoordinator) Close() {
	sc.CancelActive()
}

// CancelActive cancels the running Managed Agent interaction, if any.
func (sc *SandboxCoordinator) CancelActive() string {
	sc.mu.Lock()
	cancel := sc.activeCancel
	intID := sc.activeInteractionID
	jobID := sc.activeJobID
	sc.activeCancel = nil
	sc.activeJobID = ""
	sc.activeInteractionID = ""
	sc.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if intID != "" {
		cleanupCtx, stop := context.WithTimeout(context.WithoutCancel(sc.baseCtx), 5*time.Second)
		defer stop()
		_ = sc.runner.Cancel(cleanupCtx, intID)
	}
	return jobID
}

// Registry returns the FuncRegistry exposing delegate_sandbox_task,
// get_sandbox_status, and cancel_sandbox_task to Gemini 3.8 Live.
func (sc *SandboxCoordinator) Registry() *livebridge.FuncRegistry {
	reg := livebridge.NewFuncRegistry()

	reg.Register(&genai.FunctionDeclaration{
		Name:        "delegate_sandbox_task",
		Description: "Dispatches a coding, data analysis, chart generation, file manipulation, or web research task to the isolated Antigravity Linux sandbox in the background. Returns immediately with a job_id while progress chimes stream via AlertBus.",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"task": {
					Type:        genai.TypeString,
					Description: "Clear instructions for the Antigravity Managed Agent.",
				},
				"output_file": {
					Type:        genai.TypeString,
					Description: "Optional relative PNG/JPEG path inside the sandbox (e.g. 'workspace/chart.png') to fetch and display upon completion.",
				},
				"fresh_environment": {
					Type:        genai.TypeBoolean,
					Description: "When true, starts a brand-new remote Linux sandbox instead of reusing the current environment_id.",
				},
			},
			Required: []string{"task"},
		},
	}, func(_ context.Context, args map[string]any) (map[string]any, error) {
		task, _ := args["task"].(string)
		task = strings.TrimSpace(task)
		if task == "" {
			return nil, errors.New("task is required")
		}
		outputFile, _ := args["output_file"].(string)
		fresh, _ := args["fresh_environment"].(bool)
		jobID, envID := sc.startAsyncJob(task, strings.TrimSpace(outputFile), fresh)
		return map[string]any{
			"status":         "running_in_sandbox",
			"job_id":         jobID,
			"agent":          sc.agentID,
			"environment_id": envID,
			"note":           "Briefly tell the user the sandbox task has started; you will receive a background alert as soon as it finishes.",
		}, nil
	})

	reg.Register(&genai.FunctionDeclaration{
		Name:        "get_sandbox_status",
		Description: "Returns current Antigravity sandbox job progress, environment_id, and latest step.",
		Parameters:  &genai.Schema{Type: genai.TypeObject, Properties: map[string]*genai.Schema{}},
	}, func(_ context.Context, _ map[string]any) (map[string]any, error) {
		sc.mu.Lock()
		defer sc.mu.Unlock()
		return map[string]any{
			"active_job":              sc.activeJobID,
			"environment_id":          sc.environmentID,
			"previous_interaction_id": sc.previousInteractionID,
			"steps_completed":         sc.stepsCompleted,
			"latest_step":             sc.latestStep,
		}, nil
	})

	reg.Register(&genai.FunctionDeclaration{
		Name:        "cancel_sandbox_task",
		Description: "Cancels the currently running Antigravity Managed Agent sandbox task.",
		Parameters:  &genai.Schema{Type: genai.TypeObject, Properties: map[string]*genai.Schema{}},
	}, func(_ context.Context, _ map[string]any) (map[string]any, error) {
		cancelled := sc.CancelActive()
		if cancelled == "" {
			return map[string]any{"status": "idle", "message": "No active sandbox task."}, nil
		}
		return map[string]any{"status": "cancelled", "job_id": cancelled}, nil
	})

	return reg
}

func consumeInteractionResponse(
	res *operations.CreateInteractionResponse,
	initialEnvID string,
	onStep func(kind, summary, interactionID string),
) (interactionID, envID, outputText string, err error) {
	envID = initialEnvID
	if stream := res.InteractionSSEStreamEvent; stream != nil {
		defer func() { _ = stream.Close() }()
		var textBuilder strings.Builder
		for stream.Next() {
			evt := stream.Value()
			if created := evt.GetDataInteractionCreated(); created != nil {
				interactionID = created.Interaction.ID
				onStep("created", "Provisioned sandbox interaction "+interactionID, interactionID)
			}
			if start := evt.GetDataStepStart(); start != nil {
				kind, detail := summarizeStepStart(start)
				onStep(kind, detail, interactionID)
			}
			if delta := evt.GetDataStepDelta(); delta != nil {
				if td := delta.GetDeltaText(); td != nil {
					textBuilder.WriteString(td.GetText())
				}
			}
			if done := evt.GetDataInteractionCompleted(); done != nil && interactionID == "" {
				interactionID = done.Interaction.ID
			}
		}
		if streamErr := stream.Err(); streamErr != nil {
			return "", "", "", fmt.Errorf("reading managed agent stream: %w", streamErr)
		}
		return interactionID, envID, strings.TrimSpace(textBuilder.String()), nil
	}

	if res.Interaction != nil {
		if res.Interaction.ID != nil {
			interactionID = *res.Interaction.ID
		}
		if res.Interaction.OutputText != nil {
			outputText = strings.TrimSpace(*res.Interaction.OutputText)
		}
		if res.Interaction.EnvironmentID != nil {
			envID = *res.Interaction.EnvironmentID
		}
	}
	return interactionID, envID, outputText, nil
}

func (r *GenAIRunner) downloadSandboxFile(ctx context.Context, envID, filePath string) (string, []byte, error) {
	cleaned := strings.TrimPrefix(path.Clean("/"+strings.TrimSpace(filePath)), "/")
	if cleaned == "" || cleaned == "." {
		return "", nil, errors.New("empty sandbox file path")
	}
	dlURL := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/environments/%s/files/%s?alt=media",
		url.PathEscape(envID),
		cleaned,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dlURL, nil)
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("x-goog-api-key", r.apiKey)

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("sandbox file GET status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", nil, err
	}
	mime := resp.Header.Get("Content-Type")
	lower := strings.ToLower(cleaned)
	if strings.HasSuffix(lower, ".png") {
		mime = "image/png"
	}
	if strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") {
		mime = "image/jpeg"
	}
	return mime, data, nil
}

func summarizeStepStart(s *interactions.StepStart) (string, string) {
	if s.GetStepCodeExecutionCall() != nil {
		return "code_execution", fmt.Sprintf("Step %d: executing code in Linux sandbox", s.Index+1)
	}
	if s.GetStepGoogleSearchCall() != nil {
		return "google_search", fmt.Sprintf("Step %d: searching the web", s.Index+1)
	}
	if s.GetStepURLContextCall() != nil {
		return "url_context", fmt.Sprintf("Step %d: fetching URL context", s.Index+1)
	}
	if s.GetStepMcpServerToolCall() != nil {
		return "mcp_tool", fmt.Sprintf("Step %d: calling external MCP server", s.Index+1)
	}
	if s.GetStepThought() != nil {
		return "reasoning", fmt.Sprintf("Step %d: planning next step", s.Index+1)
	}
	return "step", fmt.Sprintf("Step %d: working", s.Index+1)
}

func (sc *SandboxCoordinator) startAsyncJob(task, outputFile string, fresh bool) (string, string) {
	sc.CancelActive()

	jobID := fmt.Sprintf("ag-%d", sc.seq.Add(1))
	jobCtx, cancel := context.WithTimeout(sc.baseCtx, 4*time.Minute)

	sc.mu.Lock()
	if fresh {
		sc.environmentID = ""
		sc.previousInteractionID = ""
	}
	envID := sc.environmentID
	prevID := sc.previousInteractionID
	sc.activeJobID = jobID
	sc.activeCancel = cancel
	sc.stepsCompleted = 0
	sc.latestStep = "Starting Antigravity sandbox..."
	sc.mu.Unlock()

	sc.emitBrowserJSON(map[string]any{
		"type":   "sandbox_step",
		"jobId":  jobID,
		"kind":   "queued",
		"detail": "Dispatching task to " + sc.agentID,
	})

	go sc.runJobGoroutine(jobCtx, cancel, jobID, task, envID, prevID, outputFile)
	return jobID, envID
}

func (sc *SandboxCoordinator) runJobGoroutine(
	jobCtx context.Context,
	cancel context.CancelFunc,
	jobID, task, envID, prevID, outputFile string,
) {
	defer cancel()

	res, err := sc.runner.RunStream(
		jobCtx,
		sc.agentID,
		task,
		envID,
		prevID,
		outputFile,
		func(kind, summary, intID string) {
			sc.mu.Lock()
			if intID != "" {
				sc.activeInteractionID = intID
			}
			sc.stepsCompleted++
			sc.latestStep = summary
			sc.mu.Unlock()

			sc.emitBrowserJSON(map[string]any{
				"type":          "sandbox_step",
				"jobId":         jobID,
				"interactionId": intID,
				"kind":          kind,
				"detail":        summary,
			})
		},
	)

	if jobCtx.Err() != nil {
		return
	}

	b := sc.recordJobOutcome(jobID, res, err)
	if err != nil {
		sc.emitBrowserJSON(map[string]any{
			"type":   "sandbox_step",
			"jobId":  jobID,
			"kind":   "error",
			"detail": err.Error(),
		})
		sc.alerts.Publish(livebridge.Alert{
			ID:     jobID,
			Source: sc.agentID,
			Type:   "sandbox_error",
			Title:  "Sandbox task failed",
			Text:   err.Error(),
		})
		return
	}

	if len(res.ArtifactBytes) > 0 && livebridge.RealtimeVideoMIMETypes[res.ArtifactMIME] {
		dataURL := "data:" + res.ArtifactMIME + ";base64," + base64.StdEncoding.EncodeToString(res.ArtifactBytes)
		sc.emitBrowserJSON(map[string]any{
			"type":          "sandbox_artifact",
			"jobId":         jobID,
			"environmentId": res.EnvironmentID,
			"path":          res.ArtifactPath,
			"dataUrl":       dataURL,
		})
		if b != nil {
			_ = b.SendRealtime(genai.LiveSendRealtimeInputParameters{
				Video: &genai.Blob{MIMEType: res.ArtifactMIME, Data: res.ArtifactBytes},
			})
		}
	}

	sc.emitBrowserJSON(map[string]any{
		"type":          "sandbox_step",
		"jobId":         jobID,
		"interactionId": res.InteractionID,
		"environmentId": res.EnvironmentID,
		"kind":          "completed",
		"detail":        "Sandbox interaction completed",
		"output":        livebridge.TruncateRunes(res.OutputText, 1200),
	})

	sc.alerts.Publish(livebridge.Alert{
		ID:     jobID,
		Source: sc.agentID,
		Type:   "sandbox_completed",
		Title:  fmt.Sprintf("Sandbox job %s finished (env %s)", jobID, res.EnvironmentID),
		Text:   res.OutputText,
	})
}

func (sc *SandboxCoordinator) recordJobOutcome(jobID string, res SandboxResult, err error) *livebridge.Bridge {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if sc.activeJobID == jobID {
		sc.activeJobID = ""
		sc.activeInteractionID = ""
		sc.activeCancel = nil
	}
	if err != nil {
		sc.latestStep = "Failed: " + err.Error()
		return sc.bridge
	}
	if res.EnvironmentID != "" {
		sc.environmentID = res.EnvironmentID
	}
	if res.InteractionID != "" {
		sc.previousInteractionID = res.InteractionID
	}
	sc.latestStep = "Completed"
	return sc.bridge
}

func (sc *SandboxCoordinator) emitBrowserJSON(v any) {
	sc.mu.Lock()
	b := sc.bridge
	sc.mu.Unlock()
	if b != nil {
		b.WriteJSON(v)
	}
}
