import type { TextLayerData, TextRun, LineStyleOverride } from './studioTypes';

/** The character-level properties a run may override. Everything else on a text layer is either a
 *  layer effect (stroke/shadow/gradient) or a paragraph property (align/lineHeight/wrap). */
export type RunStylePatch = Omit<TextRun, 'length'>;

const RUN_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'bold', 'italic',
  'letterSpacing', 'kerning', 'baselineShift',
] as const satisfies readonly (keyof RunStylePatch)[];

/** A run's overrides resolved against the layer defaults — every field concrete. */
export interface ResolvedRunStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  italic: boolean;
  letterSpacing: number;
  kerning: number;
  baselineShift: number;
}

/**
 * Layer defaults + run overrides -> one concrete style. This is the **only** place the
 * default-vs-override precedence lives; resolving it anywhere else is how the canvas and the
 * exporters drift apart.
 */
export function resolveRunStyle(text: TextLayerData, run?: TextRun): ResolvedRunStyle {
  const bold = run?.bold ?? text.bold;
  return {
    fontFamily: run?.fontFamily ?? text.fontFamily,
    fontSize: run?.fontSize ?? text.fontSize,
    // An explicit run weight wins; otherwise bold is just the 400/700 shorthand.
    fontWeight: run?.fontWeight ?? (bold ? 700 : 400),
    color: run?.color ?? text.color,
    italic: run?.italic ?? text.italic,
    letterSpacing: run?.letterSpacing ?? text.letterSpacing,
    kerning: run?.kerning ?? 0,
    baselineShift: run?.baselineShift ?? 0,
  };
}

/** The CSS/canvas font shorthand for a resolved style. Konva builds the same string internally. */
export function runFontString(style: ResolvedRunStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

/**
 * A run's already-resolved style, with its line's overrides (if any) applied on top — the highest
 * precedence tier, above both the run and the layer default. Kept separate from `resolveRunStyle`
 * (rather than threading a third argument through it) since a line override only exists once
 * wrapping has happened and a piece has a line index, which `resolveRunStyle` never sees.
 */
export function resolveLineStyle(base: ResolvedRunStyle, override?: LineStyleOverride): ResolvedRunStyle {
  if (!override) return base;
  return {
    ...base,
    fontFamily: override.fontFamily ?? base.fontFamily,
    fontSize: override.fontSize ?? base.fontSize,
    fontWeight: override.fontWeight ?? (override.bold !== undefined ? (override.bold ? 700 : 400) : base.fontWeight),
    color: override.color ?? base.color,
    italic: override.italic ?? base.italic,
    letterSpacing: override.letterSpacing ?? base.letterSpacing,
  };
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return RUN_STYLE_KEYS.every(k => a[k] === b[k]);
}

function hasOverrides(run: TextRun): boolean {
  return RUN_STYLE_KEYS.some(k => run[k] !== undefined);
}

/**
 * Coerces `runs` to cover `content` exactly: drops empties, truncates overshoot, and pads any
 * shortfall with a plain run (so typing at the end of a styled layer produces unstyled text, which
 * is what Photoshop does when you type past a styled range... except Photoshop inherits the
 * preceding style — see `padStyle` below).
 *
 * Adjacent runs with identical overrides are merged, which keeps the array from fragmenting into
 * one run per character after a few edits.
 */
export function normalizeRuns(content: string, runs: TextRun[], padStyle?: RunStylePatch): TextRun[] {
  const out: TextRun[] = [];
  let remaining = content.length;

  for (const run of runs) {
    if (remaining <= 0) break;
    const length = Math.min(run.length, remaining);
    if (length <= 0) continue;
    const next: TextRun = { ...run, length };
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev, next)) prev.length += length;
    else out.push(next);
    remaining -= length;
  }

  if (remaining > 0) {
    const pad: TextRun = { ...(padStyle ?? {}), length: remaining };
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev, pad)) prev.length += remaining;
    else out.push(pad);
  }

  // A single plain run carries no information the layer style doesn't already have.
  if (out.length === 1 && !hasOverrides(out[0])) return [];
  return out;
}

/** Expands runs to one entry per character. The simple, obviously-correct way to re-slice ranges;
 *  normalizeRuns merges it straight back down, so the fanned-out form never escapes this module. */
function toPerCharacter(content: string, runs: TextRun[]): RunStylePatch[] {
  const chars: RunStylePatch[] = [];
  for (const run of runs) {
    const { length, ...style } = run;
    for (let i = 0; i < length && chars.length < content.length; i++) chars.push({ ...style });
  }
  while (chars.length < content.length) chars.push({});
  return chars;
}

function fromPerCharacter(content: string, chars: RunStylePatch[]): TextRun[] {
  return normalizeRuns(content, chars.map(style => ({ ...style, length: 1 })));
}

/**
 * Applies `patch` to `[start, end)` of `content`. Keys set to `undefined` in the patch *clear* that
 * override back to the layer default, which is what a "reset" control needs.
 */
export function applyToRange(
  content: string,
  runs: TextRun[],
  start: number,
  end: number,
  patch: RunStylePatch,
): TextRun[] {
  const from = Math.max(0, Math.min(start, content.length));
  const to = Math.max(from, Math.min(end, content.length));
  if (from === to) return normalizeRuns(content, runs);

  const chars = toPerCharacter(content, runs);
  for (let i = from; i < to; i++) {
    const next = { ...chars[i] };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    chars[i] = next;
  }
  return fromPerCharacter(content, chars);
}

/** The run covering `index`, for reading back "what style is the caret/selection in?". */
export function runAt(content: string, runs: TextRun[], index: number): TextRun | undefined {
  let offset = 0;
  for (const run of normalizeRuns(content, runs)) {
    if (index < offset + run.length) return run;
    offset += run.length;
  }
  return undefined;
}

/** Character properties that also exist as a layer default. The rest (kerning, baseline shift,
 *  explicit weight) only exist per-run, so with no selection they're written across every run. */
export const LAYER_BACKED_CHAR_KEYS = new Set<string>(['fontFamily', 'fontSize', 'color', 'bold', 'italic', 'letterSpacing']);

/**
 * Applies a character-style patch to a selected range (as run overrides) or, with no range, to the
 * whole layer — matching Photoshop's Character panel when nothing is selected. Shared by TextPanel's
 * inline controls and the Text menu's Bold/Italic/Size actions, so the two precedence rules (range vs
 * layer-wide, and which keys are layer-backed) can't drift apart.
 */
export function applyCharPatch(text: TextLayerData, range: { start: number; end: number } | null, patch: RunStylePatch): Partial<TextLayerData> {
  const runs = text.runs ?? [];
  if (range && range.end > range.start) {
    return { runs: applyToRange(text.content, runs, range.start, range.end, patch) };
  }
  const layerPatch: Partial<TextLayerData> = {};
  const runOnly: RunStylePatch = {};
  const clear: RunStylePatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (LAYER_BACKED_CHAR_KEYS.has(key)) {
      (layerPatch as Record<string, unknown>)[key] = value;
      // Clear any run override of this key, or the new layer default would be masked by runs.
      (clear as Record<string, unknown>)[key] = undefined;
    } else {
      (runOnly as Record<string, unknown>)[key] = value;
    }
  }
  let next = runs;
  if (Object.keys(clear).length) next = applyToRange(text.content, next, 0, text.content.length, clear);
  if (Object.keys(runOnly).length) next = applyToRange(text.content, next, 0, text.content.length, runOnly);
  return { ...layerPatch, runs: next };
}

/** Reads a single resolved character-style value for a range (or the whole layer, with no range) —
 *  the read-side counterpart of `applyCharPatch`, shared for the same reason. */
export function resolveCharValue<K extends keyof ResolvedRunStyle>(
  text: TextLayerData,
  range: { start: number; end: number } | null,
  key: K,
): ResolvedRunStyle[K] {
  const runs = text.runs ?? [];
  const anchor = range ? resolveRunStyle(text, runAt(text.content, runs, range.start)) : resolveRunStyle(text);
  if (!range || range.end <= range.start) return anchor[key];
  const shared = styleOverRange(text.content, runs, range.start, range.end);
  return ((shared as Partial<ResolvedRunStyle>)[key] ?? anchor[key]) as ResolvedRunStyle[K];
}

/**
 * The style shared across `[start, end)`, or `undefined` per key where the range is mixed — so the
 * panel can show a blank/indeterminate control instead of falsely claiming the whole selection is
 * one value.
 */
export function styleOverRange(content: string, runs: TextRun[], start: number, end: number): RunStylePatch {
  const chars = toPerCharacter(content, runs);
  const from = Math.max(0, Math.min(start, content.length));
  const to = Math.max(from, Math.min(end, content.length));
  if (from >= to) return { ...(chars[from] ?? {}) };

  const first = chars[from];
  const shared: RunStylePatch = { ...first };
  for (let i = from + 1; i < to; i++) {
    for (const key of RUN_STYLE_KEYS) {
      if (chars[i][key] !== shared[key]) delete shared[key];
    }
  }
  return shared;
}

/**
 * Keeps runs aligned when `content` itself changes (typing/deleting in the textarea).
 *
 * The textarea only gives us the new string, not an edit operation, so we diff by common prefix and
 * suffix — enough to keep styled spans anchored through ordinary typing. Inserted characters
 * inherit the style at the insertion point, matching Photoshop.
 */
export function reflowRunsForContent(prevContent: string, nextContent: string, runs: TextRun[]): TextRun[] {
  if (prevContent === nextContent) return normalizeRuns(nextContent, runs);
  if (runs.length === 0) return [];

  let prefix = 0;
  const maxPrefix = Math.min(prevContent.length, nextContent.length);
  while (prefix < maxPrefix && prevContent[prefix] === nextContent[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(prevContent.length, nextContent.length) - prefix;
  while (
    suffix < maxSuffix &&
    prevContent[prevContent.length - 1 - suffix] === nextContent[nextContent.length - 1 - suffix]
  ) suffix++;

  const chars = toPerCharacter(prevContent, runs);
  const inserted = nextContent.length - prevContent.length + (prevContent.length - prefix - suffix);
  const inheritFrom = chars[Math.max(0, prefix - 1)] ?? {};

  const next: RunStylePatch[] = [
    ...chars.slice(0, prefix),
    ...Array.from({ length: Math.max(0, inserted) }, () => ({ ...inheritFrom })),
    ...chars.slice(prevContent.length - suffix),
  ];
  return fromPerCharacter(nextContent, next);
}
