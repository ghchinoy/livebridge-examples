# Bilingual & Interview Coach (React 19 + `@ghchinoy/livebridge`)

Demonstrates consuming headless `LiveSession` inside **React 19** (`src/useLiveSession.ts`) while exercising `SessionSpec` speech & VAD controls:

> **Architecture note:** `src/useLiveSession.ts` and `src/main.tsx` use idiomatic React 19 hooks and native custom-element JSX bindings for [`@ghchinoy/lustrous-lit`](https://github.com/ghchinoy/lustrous-lit) (`<lustrous-prose-text>`, `<lustrous-badge>`, `<lustrous-select>`, and light/dark/system theming).

- **Multilingual & Technical Scenarios:** Switch between *Spanish Hotel Check-In (`es-US`)*, *Tokyo Espresso Bar (`ja-JP`)*, and *Staff Systems Design Interview (`en-US`)*.
- **Speech `AdaptationPhrases` & VAD Patience (`SilenceDurationMs`):** Tune end-of-speech pause tolerance (`400 ms`–`1800 ms`) so language learners have time to think mid-sentence without premature turn cutoffs.
- **Live Coaching Rubric (`score_turn`):** Logs fluency/clarity scores and idiomatic phrasing tips in a React sidebar after each turn.

## Run

```bash
../../run.sh bilingual-coach
# Opens Vite on http://localhost:5183 (proxying /ws to Go :8093)
```

## Verify

```bash
go test -race -v .
cd frontend && npm run build
```
