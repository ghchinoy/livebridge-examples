# Whiteboard Architect (Vanilla TypeScript + `@ghchinoy/livebridge`)

Zero-framework TypeScript studio where **both you (freehand pointer drawing) and AI agents (Gemini Live voice + external `document.modelContext` WebMCP callers)** co-design system architecture diagrams on a shared `640x400` `<canvas>`, accompanied by a 60 FPS `PcmPlayer.analyser` frequency visualizer.

> **Architecture note:** `frontend/src/main.ts` stays 100% framework-free Vanilla TypeScript (`LiveSession`, `WebmcpToolHost`, pointer drawing, and 60 FPS `AnalyserNode` spectrum loop at the top), styled with [`@ghchinoy/lustrous-lit`](https://github.com/ghchinoy/lustrous-lit) CSS tokens and leaf custom elements (including theme-aware canvas palettes via `resolveLustrousTheme()`).

- **Structured State + Monotonic `revision` (`get_board`):** Exposes a read-only `get_board` tool (`readOnlyHint: true`, `untrustedContentHint: true`) returning `{ revision, canvas, nodes, edges, strokeCount }` so reconnecting voice sessions and external WebMCP agents recover exact node IDs, coordinates, and revision state without guessing from pixels.
- **Bidirectional Visual Grounding & W3C §6.4 Annotations:** Mutating tools (`add_node`, `connect_nodes`, `highlight_node`, and `clear_board` with `consequentialHint: true`) bump `revision` and return a JPEG snapshot (`SeeVisualResults: true`); freehand pointer strokes and external `document.modelContext` edits also bump `revision` and stream live JPEG updates when connected.
- **Audio-Reactive Mute Proof:** Click **Mute Speaker** while the architect is talking—speaker output silences (`OutputGainNode.gain = 0`) while the `AnalyserNode` spectrum bars keep animating.

## Run

```bash
../../run.sh whiteboard-architect
# Opens Vite on http://localhost:5182 (proxying /ws to Go :8092)
```

### Prompts to Try

- *"Diagram an event-driven order pipeline with an API Gateway, Pub/Sub topic, Worker Pool, and AlloyDB."*
- Draw a circle or arrow with your mouse around two nodes, then ask: *"What caching or dead-letter component should we add where I just sketched?"*

## Verify

```bash
go test -race -v .
cd frontend && npm run build
```
