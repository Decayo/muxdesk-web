# muxdesk-web

The React/Vite frontend for [muxdesk](https://github.com/Decayo/muxdesk) — a
terminal-native cockpit for interactive AI CLI sessions running in tmux.

This repo is the **web UI only**; it talks to the `muxdesk` backend over the
`/api/muxdesk` REST/WS contract. Start the backend first.

## Run

```bash
# 1. backend (see the muxdesk repo)
pip install "muxdesk[server]"
MUXDESK_WORKSPACE=~/your/project python3 -m uvicorn muxdesk.app:app --port 8001

# 2. this frontend (dev server proxies /api → :8001, incl. WebSocket)
npm install
npm run dev          # → http://127.0.0.1:5274
```

Point at a different backend with `VITE_BACKEND_URL` (default `http://127.0.0.1:8001`).
A Nerd Font is recommended for Claude's TUI box-drawing/icons; override the terminal
font with `VITE_MUXDESK_TERMINAL_FONT`.

```bash
npm run build        # tsc + vite production build → dist/
npm test             # vitest (unit tests for src/lib)
```

## Rendering

Assistant messages render through `MxMessage` (react-markdown + remark-gfm). The
`pre` handler dispatches fenced blocks by language:

| fenced ` ```lang ` | renders as |
|--------------------|-----------|
| `mermaid`          | diagram (`Mermaid`) |
| `diff`             | two-layer diff (`CodeDiff`) — ≤20 changed lines inline, larger collapses to a `+N −M` summary that opens a scrollable panel |
| `html` / `canvas`  | `<iframe sandbox="allow-scripts">` (`SandboxedFrame`) — runs/draws in an opaque origin, no parent/cookie/storage access |
| anything else      | shiki syntax highlight (`CodeBlock`, github-dark, lazy per-language) |

The event stream (`MxEventStream`) folds consecutive tool calls into collapsible
**WORK LOG** groups; `Edit`/`Write` entries show an inline diff built from the
tool input. Pure grouping/dedup logic lives in `src/lib/eventGroups.ts`
(unit-tested): events are deduped by stable identity (`tool_use_id` / `uuid`+text,
**not** seq, which is a re-emittable emission counter) and tool_start/tool_end are
paired globally so an interleaved event can't orphan a result.

> Diffs use the shiki "diff" lexer (unified). Split view + worker-virtualized
> rendering for very large diffs (via `@pierre/diffs`) is a planned follow-up.

## Layout

- `src/components/muxDesk/*` — chat (`MxEventStream`, `MxMessage`), rendering
  (`CodeBlock`, `CodeDiff`, `WorkLog`, `SandboxedFrame`, `Mermaid`), agent graph
  (`MxTeamPanel`), structured ask cards (`AskUserQuestionCard`), session sidebar
  (`MxSessionSidebar`), terminal (`MxTerminal`), model picker, preflight banner.
- `src/pages/*` — `MxDeskPage`, `MxDeskWorkbench`.
- `src/lib/*` — pure helpers: `shiki` (highlighter), `diff` (patch build/classify),
  `eventGroups` (tool grouping + dedup; unit-tested), `format`, `utils`.
- `src/{stores,hooks,api}` — zustand stores, stream hook (`useMxDeskStream`),
  terminal hook (`useMxTerminal`), REST client (`api/muxDesk.ts`).

## Contract

The frontend detects the structured-ask channel (`Skill` / `Bash` `muxdesk-ask`) and
pasted-image paths (`/tmp/muxdesk-img`) **by convention** — keep these in lock-step
with the backend. See the backend repo's `CONTRIBUTING.md`.

## License

MIT © Decayo
