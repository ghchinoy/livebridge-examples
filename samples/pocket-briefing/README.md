# Pocket Briefing (Zero-Node Single-Binary Go + `livebridge/browser`)

Single-binary Go voice briefing desk importing `github.com/ghchinoy/livebridge v0.1.2` and `github.com/ghchinoy/livebridge/browser` with **zero Node.js or bundler dependencies**.

> **Architecture note:** `index.html` stays 100% Node-free (embedded via `//go:embed`) while aligning its `@layer lustrous` CSS custom properties with the light/dark/system palette used across the Vite-based samples.

- **`./inbox/` Watcher + Webhook `AlertBus`:** Watches `./inbox/*.{md,txt}` every 2 seconds and accepts `POST /api/memo` webhooks, framing untrusted text with `FormatUntrustedAlert` and playing warm Web Audio cues via `ChimeSynth` (`soft` / `subtle` / `off`).
- **Action Item Capture (`save_action_item`):** Spoken follow-up tasks are logged via `FuncRegistry` and displayed live in the sidebar.

## Run

```bash
../../run.sh pocket-briefing
# Listening on http://localhost:8094
```

### Try Drop-File Briefing from Another Terminal

```bash
echo "Q4 EU latency dropped 22ms after enabling HTTP/3 on edge PoPs." > inbox/eu-latency.md
```

## Verify

```bash
go test -race -v .
```
