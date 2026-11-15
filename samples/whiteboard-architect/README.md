# Whiteboard Architect (Vanilla TypeScript + `@ghchinoy/livebridge`)

Zero-framework TypeScript studio where **both you (freehand pointer drawing) and Gemini Live (WebMCP canvas tools)** co-design system architecture diagrams on a shared `640x400` `<canvas>`, accompanied by a 60 FPS `PcmPlayer.analyser` frequency visualizer.

- **Bidirectional Visual Grounding:** Every WebMCP tool call (`add_node`, `connect_nodes`, `highlight_node`, `clear_board`) returns a JPEG snapshot (`SeeVisualResults: true`), and every freehand pointer stroke sends a live JPEG frame so Gemini sees your annotations immediately.
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
