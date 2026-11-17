# Agent Instructions

`livebridge-examples` is the companion external showcase and release-canary repository for [`github.com/ghchinoy/livebridge`](https://github.com/ghchinoy/livebridge) (`~/projects/livebridge`) and [`@ghchinoy/livebridge`](https://www.npmjs.com/package/@ghchinoy/livebridge).

- **Boundary between repos:**
  - `~/projects/livebridge` (`ghchinoy/livebridge`) owns the core Go switchboard, `livebridge/browser`, `@ghchinoy/livebridge` (+ `/lit`), Diátaxis docs, and 4 minimal CI-gated API recipes (`examples/01`–`04`).
  - `~/projects/livebridge-examples` (`ghchinoy/livebridge-examples`) owns full multi-framework external apps (`visual-concierge` Lit 3, `whiteboard-architect` Vanilla TS, `bilingual-coach` React 19, `pocket-briefing` Zero-Node Go, `antigravity-voice-desk` Lit 3 + Managed Agents) consuming published `proxy.golang.org` and `npmjs.com` releases with zero `go.work` or `replace` directives.
- **Release canary workflow:** Before publishing a new `livebridge` version, run `make use-tarball && make verify` here; after publishing to npm, run `make use-npm VERSION=<x.y.z> && make verify` so committed `package.json` files track the public npm release.

## UI Design System Guardrails (`@ghchinoy/lustrous-lit`)

Samples use [`@ghchinoy/lustrous-lit`](https://github.com/ghchinoy/lustrous-lit) for consistent, WCAG 2.1 AA light/dark UX **without obscuring `livebridge` as the primary subject**:

1. **`livebridge` First (Top-of-File Rule):** Every sample entry module must open with `livebridge` wiring (`LiveSessionController` / `LiveSession`, `WebmcpToolHost`, media capture, tool handlers) at the top of the file under `// ── 1. Livebridge Session, Media & Tool Wiring ──`, before `// ── 2. Lustrous UI Presentation ──`. Keep component-local CSS minimal (`≤ 35` lines, placed at the bottom) so readers never scroll past layout styling to reach `livebridge`.
2. **Zero Wrapper Abstractions Over `livebridge`:** Never hide `LiveSession`, `LiveSessionController`, `WebmcpToolHost`, or `session.transcript` inside custom UI wrapper components or cross-sample `../../shared/` modules. Every directory under `samples/` must remain standalone and copy-pasteable.
3. **Stack-Respecting Adoption (3 Tiers):**
   - **Lit 3 (`visual-concierge`, `antigravity-voice-desk`):** Full idiomatic Lustrous (`LustrousElement`, layout/control primitives, `@ghchinoy/lustrous-lit/theme.css` + `fonts.css`).
   - **Non-Lit Vite (`whiteboard-architect` Vanilla TS, `bilingual-coach` React 19):** Keep host code 100% idiomatic to Vanilla TS or React 19 (zero `LitElement` authoring); use `--lustrous-*` CSS tokens plus leaf `<lustrous-*>` custom elements where they remove inline style boilerplate.
   - **Zero-Node Go (`pocket-briefing`):** Preserve zero Node/npm dependencies; align embedded CSS custom properties with Lustrous tokens only.
4. **Sample-Sized Chrome Only:** Keep headers lightweight (title, framework badge, session status badge, Light/Dark/System theme toggle)—no multi-page routers, navigation sidebars, or app-shell ceremony.
5. **Public Registry Invariant:** Committed `package.json` files must resolve both `@ghchinoy/livebridge` and `@ghchinoy/lustrous-lit` from public `npmjs.com` so `make install && make verify` passes on a clean clone.

This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context.

> **Architecture in one line:** Issues live in a local Dolt database
> (`.beads/dolt/`); cross-machine sync uses `bd dolt push/pull` (a
> git-compatible protocol), stored under `refs/dolt/data` on your git
> remote — separate from `refs/heads/*` where your code lives.
> `.beads/issues.jsonl` is a passive export, not the wire protocol.
>
> See [sync-concepts](https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md)
> for the one-screen overview and anti-patterns (don't treat JSONL as the
> source of truth; don't `bd import` during normal operation; don't
> reach for third-party Dolt hosting before trying the default).

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
