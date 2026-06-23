/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override for the terminal font family (xterm.js). A Nerd Font is
   *  recommended for Claude TUI box-drawing/icons. Falls back to a built-in chain. */
  readonly VITE_MUXDESK_TERMINAL_FONT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
