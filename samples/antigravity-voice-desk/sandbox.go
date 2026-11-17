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
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/genai"
	"google.golang.org/genai/interactions/models/interactions"
	"google.golang.org/genai/interactions/models/operations"

	"github.com/ghchinoy/livebridge"
)

const (
	defaultManagedAgent  = "antigravity-preview-09-2026"
	defaultGeminiAPIBase = "https://generativelanguage.googleapis.com"
)

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
	client       *genai.Client
	apiKey       string
	filesBaseURL string
	httpClient   *http.Client
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
			client:       client,
			apiKey:       apiKey,
			filesBaseURL: defaultGeminiAPIBase,
			httpClient:   &http.Client{Timeout: 60 * time.Second},
		}, nil
	}

	projectID := strings.TrimSpace(os.Getenv("GOOGLE_CLOUD_PROJECT"))
	if projectID == "" {
		return nil, errors.New("missing GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT for Managed Agents")
	}
	slog.Warn("GEMINI_API_KEY is unset; Antigravity Managed Agents and chart downloads require GEMINI_API_KEY",
		"fallbackBackend", "VertexAI",
		"project", projectID,
	)
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
		client:       client,
		filesBaseURL: defaultGeminiAPIBase,
		httpClient:   &http.Client{Timeout: 60 * time.Second},
	}, nil
}

// RunStream executes a streaming Managed Agent interaction, invokes onStep on
// progress events, fetches the final Interaction metadata (for EnvironmentID),
// and downloads any explicit or newly generated PNG/JPEG chart from the sandbox.
func (r *GenAIRunner) RunStream(
	ctx context.Context,
	agentID, prompt, environmentID, previousInteractionID, outputFile string,
	onStep func(kind, summary, interactionID string),
) (SandboxResult, error) {
	var beforeImages map[string]string
	if strings.TrimSpace(environmentID) != "" && r.apiKey != "" {
		beforeImages = r.snapshotImageFiles(ctx, environmentID)
	}

	effectivePrompt := prompt
	if strings.TrimSpace(outputFile) != "" {
		effectivePrompt += "\n\nIf you generate a chart or image, save it to " + strings.TrimSpace(outputFile) + "."
	}

	envTarget := "remote"
	if strings.TrimSpace(environmentID) != "" {
		envTarget = strings.TrimSpace(environmentID)
	}
	body := interactions.CreateAgentInteraction{
		Agent:       interactions.AgentOption(agentID),
		Input:       genai.Ptr(interactions.NewInteractionsInput(effectivePrompt)),
		Environment: genai.Ptr(interactions.NewCreateAgentInteractionEnvironment(envTarget)),
		Stream:      genai.Ptr(true),
	}
	if strings.TrimSpace(previousInteractionID) != "" {
		body.PreviousInteractionID = genai.Ptr(strings.TrimSpace(previousInteractionID))
	}

	res, err := r.client.Interactions.Create(ctx, operations.CreateInteractionRequest{
		Body: operations.NewCreateInteractionRequestBody(body),
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
			ID: interactionID,
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

	if out.EnvironmentID != "" && r.apiKey != "" {
		artPath, artMIME, artBytes := r.resolveAndDownloadArtifact(ctx, out.EnvironmentID, outputFile, beforeImages)
		out.ArtifactPath = artPath
		out.ArtifactMIME = artMIME
		out.ArtifactBytes = artBytes
	}
	return out, nil
}

// Cancel aborts an in-flight Managed Agent interaction by ID.
func (r *GenAIRunner) Cancel(ctx context.Context, interactionID string) error {
	if strings.TrimSpace(interactionID) == "" {
		return nil
	}
	_, err := r.client.Interactions.Cancel(ctx, operations.CancelInteractionByIDRequest{
		ID: interactionID,
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
		Description: "Dispatches a coding, data analysis, chart generation, file manipulation, or web research task to the isolated Antigravity Linux sandbox in the background. Any PNG/JPEG chart saved in the sandbox is automatically discovered and displayed upon completion.",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"task": {
					Type:        genai.TypeString,
					Description: "Clear instructions for the Antigravity Managed Agent.",
				},
				"output_file": {
					Type:        genai.TypeString,
					Description: "Optional preferred PNG/JPEG path inside the sandbox (e.g. 'workspace/chart.png'). If omitted, any newly generated PNG/JPEG chart is auto-detected.",
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
			"note":           "Briefly tell the user the sandbox task has started; you will receive a background alert and visual frame as soon as it finishes.",
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

type sandboxFileEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	MimeType string `json:"mime_type"`
	Created  string `json:"created"`
	Modified string `json:"modified"`
}

type sandboxFilesEnvelope struct {
	Files         []sandboxFileEntry `json:"files"`
	NextPageToken string             `json:"next_page_token"`
}

func (r *GenAIRunner) resolveAndDownloadArtifact(
	ctx context.Context,
	envID, requestedFile string,
	beforeImages map[string]string,
) (string, string, []byte) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(requestedFile), "/")
	var reqCandidates []string
	if trimmed != "" {
		reqCandidates = append(reqCandidates, trimmed)
		if !strings.HasPrefix(trimmed, "workspace/") {
			reqCandidates = append(reqCandidates, "workspace/"+trimmed)
		}
	}

	// 1. Query recursive environment file listing so we detect newly created or
	// modified charts (even when output_file was omitted or Antigravity chose a
	// custom filename such as goog_stock.png) and avoid stale previous-turn files.
	entries, err := r.listSandboxFilesRecursive(ctx, envID)
	if err != nil {
		slog.Debug("listing sandbox files for artifact auto-discovery", "err", err)
	}
	if err == nil {
		chosen := pickNewestArtifactPath(entries, beforeImages, reqCandidates)
		if chosen != "" {
			mime, data, dlErr := r.downloadSandboxFile(ctx, envID, chosen)
			if dlErr == nil && len(data) > 0 {
				return chosen, mime, data
			}
			slog.Warn("downloading auto-discovered sandbox artifact", "path", chosen, "err", dlErr)
		}
	}

	// 2. Fallback to explicit output_file candidates if listing was unavailable,
	// skipping any path known to be unchanged since before the interaction.
	for _, candidate := range reqCandidates {
		if _, existedUnchanged := beforeImages[candidate]; existedUnchanged {
			continue
		}
		if mime, data, err := r.downloadSandboxFile(ctx, envID, candidate); err == nil && len(data) > 0 {
			return candidate, mime, data
		}
	}
	return "", "", nil
}

func (r *GenAIRunner) snapshotImageFiles(ctx context.Context, envID string) map[string]string {
	entries, err := r.listSandboxFilesRecursive(ctx, envID)
	if err != nil {
		return nil
	}
	snap := make(map[string]string)
	for _, f := range entries {
		if isCandidateArtifact(f) {
			snap[f.Path] = cmp.Or(f.Modified, f.Created)
		}
	}
	return snap
}

func (r *GenAIRunner) listSandboxFilesRecursive(ctx context.Context, envID string) ([]sandboxFileEntry, error) {
	base := strings.TrimRight(cmp.Or(r.filesBaseURL, defaultGeminiAPIBase), "/")
	var all []sandboxFileEntry
	pageToken := ""

	for range 10 {
		q := url.Values{
			"recursive": {"true"},
			"page_size": {"500"},
		}
		if pageToken != "" {
			q.Set("page_token", pageToken)
		}
		listURL := fmt.Sprintf("%s/v1beta/environments/%s/files?%s", base, url.PathEscape(envID), q.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-goog-api-key", r.apiKey)

		resp, err := r.httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("list sandbox files status %d", resp.StatusCode)
		}
		var env sandboxFilesEnvelope
		decErr := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&env)
		_ = resp.Body.Close()
		if decErr != nil {
			return nil, decErr
		}
		all = append(all, env.Files...)
		if env.NextPageToken == "" {
			break
		}
		pageToken = env.NextPageToken
	}
	return all, nil
}

func pickNewestArtifactPath(entries []sandboxFileEntry, before map[string]string, preferred []string) string {
	var fresh []sandboxFileEntry
	for _, f := range entries {
		if !isCandidateArtifact(f) {
			continue
		}
		stamp := cmp.Or(f.Modified, f.Created)
		if prev, existed := before[f.Path]; existed && prev == stamp {
			continue
		}
		fresh = append(fresh, f)
	}
	if len(fresh) == 0 {
		return ""
	}
	for _, want := range preferred {
		for _, f := range fresh {
			if f.Path == want {
				return f.Path
			}
		}
	}
	slices.SortFunc(fresh, func(a, b sandboxFileEntry) int {
		ta := parseFileTime(cmp.Or(a.Modified, a.Created))
		tb := parseFileTime(cmp.Or(b.Modified, b.Created))
		if !ta.Equal(tb) {
			if ta.After(tb) {
				return -1
			}
			return 1
		}
		// Prefer files saved inside workspace/ on identical timestamps.
		aw := strings.HasPrefix(a.Path, "workspace/")
		bw := strings.HasPrefix(b.Path, "workspace/")
		if aw != bw {
			if aw {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Path, b.Path)
	})
	return fresh[0].Path
}

func isCandidateArtifact(f sandboxFileEntry) bool {
	if !strings.EqualFold(f.Type, "FILE") && f.Type != "" {
		return false
	}
	p := strings.TrimPrefix(f.Path, "/")
	if p == "" {
		return false
	}
	// Exclude hidden dirs, Python virtualenvs/matplotlib icon assets, and node_modules.
	excluded := []string{
		"/.", "node_modules/", "site-packages/", "dist-packages/",
		"mpl-data/", "/usr/", "/lib/", "/etc/", "/var/", "/proc/", "__pycache__/",
	}
	wrapped := "/" + p
	for _, skip := range excluded {
		if strings.Contains(wrapped, skip) {
			return false
		}
	}
	lower := strings.ToLower(p)
	if strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") {
		return true
	}
	mime := strings.ToLower(strings.TrimSpace(f.MimeType))
	return mime == "image/png" || mime == "image/jpeg"
}

func parseFileTime(raw string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}
	}
	return t
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
	base := cmp.Or(r.filesBaseURL, defaultGeminiAPIBase)
	dlURL := fmt.Sprintf(
		"%s/v1beta/environments/%s/files/%s?alt=media",
		strings.TrimRight(base, "/"),
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
