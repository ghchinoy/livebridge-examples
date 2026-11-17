# Visual Concierge (Lit 3 + `@ghchinoy/livebridge/lit`)

Pairs a talking Gemini Live video avatar (`Kira`, `Aoede`, `Puck`, `Kore`, or a custom uploaded portrait cropped via `prepareAvatarImage`) with 1 FPS webcam/screen-share `VisionCapture` and a live troubleshooting checklist drawer (`upsert_checklist`).

> **Architecture note:** `@ghchinoy/livebridge` + `@ghchinoy/livebridge/lit` (`LiveSessionController`) drive all session, media, and tool behavior at the top of `frontend/src/app.ts`; [`@ghchinoy/lustrous-lit`](https://github.com/ghchinoy/lustrous-lit) provides the accessible Lit 3 UI primitives and light/dark/system theming.

## Run

```bash
../../run.sh visual-concierge
# Opens Vite on http://localhost:5181 (proxying /ws to Go :8091)
```

### Prompts to Try

- Turn on **1 FPS Camera**, hold up a gadget, cable, or book cover, and ask: *"Inspect what I'm holding and build a quick checklist for setting it up."*
- Turn on **1 FPS Screen**, open a terminal or dashboard, and ask: *"Review what's on my screen and list the next three checks I should run."*

## Verify

```bash
go test -race -v .
cd frontend && npm run build
```
