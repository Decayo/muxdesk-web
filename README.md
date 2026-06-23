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
```

## Layout

- `src/components/muxDesk/*` — chat (`MxEventStream`), agent graph (`MxTeamPanel`),
  structured ask cards (`AskUserQuestionCard`), session sidebar (`MxSessionSidebar`),
  terminal (`MxTerminal`), model picker, preflight banner.
- `src/pages/*` — `MxDeskPage`, `MxDeskWorkbench`.
- `src/{stores,hooks,api}` — zustand stores, stream hook (`useMxDeskStream`),
  terminal hook (`useMxTerminal`), REST client (`api/muxDesk.ts`).

## Contract

The frontend detects the structured-ask channel (`Skill` / `Bash` `muxdesk-ask`) and
pasted-image paths (`/tmp/muxdesk-img`) **by convention** — keep these in lock-step
with the backend. See the backend repo's `CONTRIBUTING.md`.

## License

MIT © Decayo
