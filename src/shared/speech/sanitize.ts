/**
 * Sanitize — the text pipeline CopySpeech applies before synthesis.
 * Faithful port of src-tauri/src/sanitize/{mod,markdown,tts_normalize,cleanup}.rs.
 *
 * Pipeline order (sanitize_text):
 *   1. Markdown stripping (per-feature toggles)
 *   2. TTS normalization (symbols, units, abbreviations)
 *   3. Artifact cleanup (always)
 *
 * JS regexes differ from Rust's in two ways that don't change behavior here:
 * `\b` is ASCII-centric in both for the tokens used, and replacements use
 * functions when they need captures. Character classes with `\u{...}` need the
 * `u` flag, added throughout.
 */

export interface MarkdownSanitizationConfig {
  enabled: boolean
  strip_headers: boolean
  strip_code_blocks: boolean
  strip_inline_code: boolean
  strip_links: boolean
  strip_bold_italic: boolean
  strip_lists: boolean
  strip_blockquotes: boolean
}
export interface SanitizationConfig {
  enabled: boolean
  markdown: MarkdownSanitizationConfig
  tts_normalization: { enabled: boolean }
}

// ── Markdown ─────────────────────────────────────────────────────────────────

const RE_CODE_BLOCK = /```[\s\S]*?```/g
const RE_INLINE_CODE = /`[^`]+`/g
const RE_LINK = /\[([^\]]+)\]\([^)]+\)/g
const RE_HEADER = /^(#{1,6})\s+(.*)$/gm
const RE_LIST = /^[ \t]*[-*+]\s+(.+)$|^[ \t]*\d+\.\s+(.+)$/gm
const RE_BLOCKQUOTE = /^[ \t]*>\s+/gm

const sentenceEnd = (s: string): boolean => /[.?!:;]$/.test(s)
const ensurePeriod = (s: string): string => (sentenceEnd(s) ? s : `${s}.`)

export function stripMarkdown(text: string, config: MarkdownSanitizationConfig): string {
  let result = text
  if (config.strip_code_blocks) result = result.replace(RE_CODE_BLOCK, '')
  if (config.strip_inline_code) result = result.replace(RE_INLINE_CODE, '')
  if (config.strip_links) result = result.replace(RE_LINK, '$1')
  if (config.strip_headers) {
    result = result.replace(RE_HEADER, (_m, _hashes: string, content: string) => ensurePeriod(content))
  }
  if (config.strip_bold_italic) {
    result = result.replace(/\*\*/g, '').replace(/__/g, '').replace(/\*/g, '').replace(/_/g, '')
  }
  if (config.strip_lists) {
    result = result.replace(RE_LIST, (_m, a: string | undefined, b: string | undefined) => {
      const content = (a ?? b ?? '').trim()
      return content ? ensurePeriod(content) : ''
    })
  }
  if (config.strip_blockquotes) result = result.replace(RE_BLOCKQUOTE, '')
  return result
}

// ── TTS normalization ────────────────────────────────────────────────────────

const RE_SYMBOL = /[\u{00AD}\u{203C}\u{2049}\u{2139}\u{2190}-\u{2BFF}\u{E000}-\u{F8FF}\u{1F000}-\u{1F2FF}\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{FFFD}-\u{FFFF}]+/gu
const RE_INVISIBLE = /[\u{0000}-\u{0008}\u{000E}-\u{001F}\u{007F}-\u{009F}\u{200B}\u{200D}-\u{200F}\u{2028}-\u{202E}\u{2060}-\u{2064}\u{20D0}-\u{20FF}\u{FEFF}]+/gu

export function removeUnpronounceable(text: string): string {
  const spaced = text.replace(/[\t\u{000B}\u{000C}]/gu, ' ')
  return spaced.replace(RE_INVISIBLE, '').replace(RE_SYMBOL, '')
}

// ── Character normalization ──────────────────────────────────────────────────

const RE_UNICODE_SPACES = /[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu
const RE_CURLY_DOUBLE = /[“”]/g
const RE_CURLY_SINGLE = /[‘’ʼ]/g
const RE_EN_DASH = /\u2013/g
const RE_FULLWIDTH = /[\u{FF01}-\u{FF5E}]/gu
const RE_STRIP_INVISIBLES = /[\u{200B}\u{200D}-\u{200F}\u{2060}-\u{2064}\u{FEFF}\u{00AD}\u{180E}]/gu

function substituteSameLength(text: string): string {
  return text
    .replace(RE_UNICODE_SPACES, ' ')
    .replace(RE_CURLY_DOUBLE, '"')
    .replace(RE_CURLY_SINGLE, "'")
    .replace(RE_EN_DASH, '-')
    .replace(RE_FULLWIDTH, (m) => String.fromCodePoint(m.codePointAt(0)! - 0xfee0))
}

/** Cyrillic confusables fold to their Latin look-alike inside words that also hold a Latin letter. */
const HOMOGLYPHS: Record<string, string> = {
  'Ѐ': 'E', 'Ё': 'E', 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
  'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'ё': 'e',
}

function foldWord(word: string): string {
  if (!/[A-Za-z]/.test(word)) return word
  let out = ''
  for (const ch of word) out += HOMOGLYPHS[ch] ?? ch
  return out
}

export function foldHomoglyphs(text: string): string {
  let out = ''
  let word = ''
  for (const ch of text) {
    if (/\p{L}|\p{N}/u.test(ch)) { word += ch; continue }
    out += foldWord(word); word = ''
    out += ch
  }
  out += foldWord(word)
  return out
}

function normalizeCharacters(text: string): string {
  return foldHomoglyphs(substituteSameLength(text)).replace(RE_STRIP_INVISIBLES, '')
}

// ── Leading orphan punctuation ───────────────────────────────────────────────

const ORPHAN_CHARS = new Set([',', ';', ':', '-', '*', '>', '•', '·', '‣', '∙', '◦'])
function stripLeadingOrphans(text: string): string {
  let i = 0
  while (i < text.length && (ORPHAN_CHARS.has(text[i]) || /\s/.test(text[i]))) i++
  return text.slice(i).trimStart()
}

// ── Web artifacts & citations ────────────────────────────────────────────────

const RE_URL = /https?:\/\/[^\s)\]]+/g
const RE_CITATION = /\[[a-zA-Z0-9]+\]/g

// ── Slashes ──────────────────────────────────────────────────────────────────

const RE_WO = /\bw\/o\b/gi
const RE_NA = /\bn\/a\b/gi
const RE_AND_OR = /\band\/or\b/gi
const RE_W = /\bw\/\s*/gi
const RE_SLASH_OPTION = /\b([a-zA-Z]+)\/([a-zA-Z]+)\b/g
const RE_SLASH_RATIO = /(\d\s*)([a-zA-Z]+)\/([a-zA-Z]+)/g

// ── Abbreviations ────────────────────────────────────────────────────────────

const RE_EG = /\be\.g\.\s*/gi
const RE_IE = /\bi\.e\.\s*/gi
const RE_ETC = /\betc\.\s*/gi
const RE_VS = /\bvs\.\s*/gi
const RE_DR = /\bDr\.\s*/gi
const RE_MR = /\bMr\.\s*/gi
const RE_MRS = /\bMrs\.\s*/gi
const RE_MS = /\bMs\.\s*/gi
const RE_PROF = /\bProf\.\s*/gi
const RE_REV = /\bRev\.\s*/gi
const RE_SR = /\bSr\.\s*/gi
const RE_JR = /\bJr\.\s*/gi
const RE_HON = /\bHon\.\s*/gi
const RE_SIR = /\bSir\s+/gi
const RE_MADAM = /\bMadam\s+/gi

// ── Number magnitudes & units ───────────────────────────────────────────────

const RE_BN = /(\d+(?:\.\d+)?)\s*bn\b/gi
const RE_BILLION_B = /(\d+(?:\.\d+)?)\s*B\b/g
const RE_MILLION_L = /(\d+(?:\.\d+)?)\s*m\b/g
const RE_MILLION_U = /(\d+(?:\.\d+)?)\s*M\b/g
const RE_K = /(\d+(?:\.\d+)?)\s*k\b/gi
const RE_TR = /(\d+(?:\.\d+)?)\s*tr\b/gi
const RE_MM = /(\d)\s*mm\b/g
const RE_CM = /(\d)\s*cm\b/g
const RE_KM = /(\d)\s*km\b/g
const RE_KG = /(\d)\s*kg\b/g
const RE_G = /(\d)\s*g\b/g
const RE_M = /(\d)\s*m\b/g

// ── Symbols ──────────────────────────────────────────────────────────────────

const RE_AT_EMAIL = /([a-zA-Z0-9._%+-])@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
const RE_AT_HANDLE = /@([a-zA-Z0-9_]+)/g
const RE_DOLLAR = /\$(\d+(?:\.\d+)?)\b/g
const RE_EURO = /€(\d+(?:\.\d+)?)\b/g
const RE_POUND = /£(\d+(?:\.\d+)?)\b/g
const RE_YEN = /¥(\d+(?:\.\d+)?)\b/g

// ── Punctuation ──────────────────────────────────────────────────────────────

const RE_ELLIPSIS_U = /\u2026/g
const RE_ELLIPSIS_SPACED = /\.\s*\.\s*\./g
const RE_EM_DASH = /\u2014/g
const RE_PAREN = /\(([^)]+)\)/g

// ── Cleanup ──────────────────────────────────────────────────────────────────

const RE_MULTI_SPACE = / {2,}/g
const RE_SPACE_BEFORE_PUNCT = / +([,.:;!?])/g
const RE_REPEATED_COMMA = /,(\s*,)+/g
const RE_COMMA_BEFORE_PERIOD = /,\s*\./g
const RE_PUNCT_NO_SPACE = /([,;:])([A-Za-z])/g
const RE_TRAILING_COMMA = /,\s*$/
const RE_MULTI_NEWLINE = /\n{3,}/g

export function cleanupArtifacts(text: string): string {
  let result = text
  for (let i = 0; i < 2; i++) {
    result = result
      .replace(RE_MULTI_SPACE, ' ')
      .replace(RE_SPACE_BEFORE_PUNCT, '$1')
      .replace(RE_REPEATED_COMMA, ',')
      .replace(RE_COMMA_BEFORE_PERIOD, '.')
      .replace(RE_PUNCT_NO_SPACE, '$1 $2')
  }
  result = result.replace(RE_TRAILING_COMMA, '')
  result = result.replace(RE_MULTI_NEWLINE, '\n\n')
  return result.split('\n').map((line) => line.trim()).join('\n').trim()
}

/** Normalize text for TTS readability (expands symbols, abbreviations and units). */
export function sanitizeTts(text: string): string {
  let result = text
  result = normalizeCharacters(result)
  result = removeUnpronounceable(result)
  result = result.replace(RE_URL, '')
  result = result.replace(RE_CITATION, '')
  result = result.replace(RE_WO, 'without')
  result = result.replace(RE_NA, 'not applicable')
  result = result.replace(RE_AND_OR, 'and or')
  result = result.replace(RE_W, 'with ')
  result = result.replace(RE_SLASH_OPTION, '$1 or $2')
  result = result.replace(RE_SLASH_RATIO, '$1$2 per $3')
  result = result.replace(RE_EG, 'for example ')
  result = result.replace(RE_IE, 'that is ')
  result = result.replace(RE_ETC, 'et cetera ')
  result = result.replace(RE_VS, 'versus ')
  result = result.replace(RE_DR, 'Doctor ')
  result = result.replace(RE_MR, 'Mister ')
  result = result.replace(RE_MRS, 'Misses ')
  result = result.replace(RE_MS, 'Miss ')
  result = result.replace(RE_PROF, 'Professor ')
  result = result.replace(RE_REV, 'Reverend ')
  result = result.replace(RE_SR, 'Senior ')
  result = result.replace(RE_JR, 'Junior ')
  result = result.replace(RE_HON, 'Honorable ')
  result = result.replace(RE_SIR, 'Sir ')
  result = result.replace(RE_MADAM, 'Madam ')
  result = result.replace(RE_BN, '$1 billion')
  result = result.replace(RE_BILLION_B, '$1 billion')
  result = result.replace(RE_TR, '$1 trillion')
  result = result.replace(RE_MILLION_L, '$1 million')
  result = result.replace(RE_MILLION_U, '$1 million')
  result = result.replace(RE_K, '$1 thousand')
  result = result.replace(RE_MM, '$1 millimeters')
  result = result.replace(RE_CM, '$1 centimeters')
  result = result.replace(RE_KM, '$1 kilometers')
  result = result.replace(RE_KG, '$1 kilograms')
  result = result.replace(RE_G, '$1 grams')
  result = result.replace(RE_M, '$1 meters')
  result = result.replace(RE_AT_EMAIL, '$1 at $2')
  result = result.replace(RE_AT_HANDLE, 'at $1')
  result = result.replace(RE_DOLLAR, '$1 dollars')
  result = result.replace(RE_EURO, '$1 euros')
  result = result.replace(RE_POUND, '$1 pounds')
  result = result.replace(RE_YEN, '$1 yen')
  result = result.replace(/&/g, ' and ')
  result = result.replace(/%/g, ' percent')
  result = result.replace(/~/g, 'approximately ')
  result = result.replace(/\+/g, ' plus ')
  result = result.replace(/=/g, ' equals ')
  result = result.replace(/°/g, ' degrees')
  result = result.replace(RE_ELLIPSIS_U, '...')
  result = result.replace(RE_ELLIPSIS_SPACED, '...')
  result = result.replace(RE_EM_DASH, ', ')
  result = result.replace(RE_PAREN, ', $1,')
  result = cleanupArtifacts(result)
  result = stripLeadingOrphans(result)
  result = result.replace(/\r/g, '').replace(/\n/g, ' ')
  return result.trim()
}

/**
 * Full pipeline: markdown → normalization → cleanup. When `config.enabled` is
 * false the text is returned verbatim.
 */
export function sanitizeText(text: string, config: SanitizationConfig): string {
  if (!config.enabled) return text
  let result = text
  if (config.markdown.enabled) result = stripMarkdown(result, config.markdown)
  if (config.tts_normalization.enabled) result = sanitizeTts(result)
  return cleanupArtifacts(result)
}
