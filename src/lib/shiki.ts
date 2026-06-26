import { createHighlighter, type BundledLanguage, type Highlighter } from 'shiki'

/**
 * Shared shiki highlighter (singleton, lazy language loading).
 * The bundled `shiki` entry code-splits each language/theme into its own dynamic
 * import, so the initial set below is the only highlight payload loaded up front;
 * any other language is fetched on first use via `loadLanguage`.
 * Theme matches the existing code-block surface (#0d1117 / github-dark).
 */
export const SHIKI_THEME = 'github-dark'

const INITIAL_LANGS: BundledLanguage[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'json',
  'bash',
  'diff',
  'markdown',
  'html',
  'css',
]

// Common fenced-language aliases -> shiki bundled ids.
const ALIAS: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  ts: 'typescript',
  js: 'javascript',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  htm: 'html',
  text: 'text',
  plaintext: 'text',
  txt: 'text',
  '': 'text',
}

let highlighterPromise: Promise<Highlighter> | null = null
const loaded = new Set<string>(INITIAL_LANGS)

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [SHIKI_THEME], langs: INITIAL_LANGS })
  }
  return highlighterPromise
}

/** Highlight `code` as `lang` into shiki HTML; unknown languages degrade to plain text (never throws). */
export async function highlightCode(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter()
  let id = ALIAS[lang.toLowerCase()] ?? lang.toLowerCase()
  // shiki ships text/ansi as builtins; everything else must be loaded before use.
  if (id !== 'text' && id !== 'ansi' && !loaded.has(id)) {
    try {
      await hl.loadLanguage(id as BundledLanguage)
      loaded.add(id)
    } catch {
      id = 'text' // unsupported language -> plain text, no crash
    }
  }
  return hl.codeToHtml(code, { lang: id, theme: SHIKI_THEME })
}
