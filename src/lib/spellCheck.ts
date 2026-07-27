/**
 * A small starter misspelling dictionary (English + Arabic common mistakes), not a full
 * language dictionary — flags exact-word matches only. Real dictionary-backed spell/grammar
 * checking is out of scope for a browser-only app without a server; this gives the
 * click-to-fix workflow SPEC asks for on a realistic, honestly-scoped word list.
 */
export const COMMON_MISSPELLINGS: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  untill: 'until',
  wich: 'which',
  becuase: 'because',
  writen: 'written',
  freind: 'friend',
  goverment: 'government',
  neccessary: 'necessary',
  publically: 'publicly',
  wierd: 'weird',
  اكيد: 'أكيد',
  ايضا: 'أيضًا',
  لاكن: 'لكن',
  انشاء: 'إنشاء',
  هاذا: 'هذا',
  اللة: 'الله',
  هاذه: 'هذه',
  او: 'أو',
};

/**
 * Multi-word idioms — kept separate from `COMMON_MISSPELLINGS` because `findSpellIssues`'s regex
 * matches one contiguous letter-run at a time, so a phrase with a space needs its own literal
 * substring scan (`findPhraseIssues`) rather than a per-word lookup.
 *
 * Deliberately does NOT include a blanket `ان -> إن` entry: `ان` is a genuinely valid standalone
 * word (the conditional "if") as well as a common typo for `إن`, and this dictionary does
 * zero-context exact-word matching — a blanket replacement would silently "correct" a large
 * fraction of valid usages instead of just real mistakes.
 */
export const COMMON_PHRASE_MISSPELLINGS: Record<string, string> = {
  'انشاء الله': 'إن شاء الله',
};

export interface SpellIssue {
  word: string;
  fix: string;
  start: number;
  end: number;
}

/** Finds misspelled words in plain text. Word boundaries are simple whitespace/punctuation splits. */
export function findSpellIssues(text: string): SpellIssue[] {
  const issues: SpellIssue[] = [];
  const re = /[\p{L}\p{M}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const word = match[0];
    const fix = COMMON_MISSPELLINGS[word.toLowerCase()] ?? COMMON_MISSPELLINGS[word];
    if (fix) issues.push({ word, fix, start: match.index, end: match.index + word.length });
  }
  return issues;
}

/** Finds multi-word idiom matches via a literal substring scan — only reliably catches a phrase
 *  while both words are still plain sibling text within the same run (the common freshly-typed
 *  case), since it doesn't look across element boundaries. */
export function findPhraseIssues(text: string): SpellIssue[] {
  const issues: SpellIssue[] = [];
  for (const [phrase, fix] of Object.entries(COMMON_PHRASE_MISSPELLINGS)) {
    let idx = text.indexOf(phrase);
    while (idx !== -1) {
      issues.push({ word: phrase, fix, start: idx, end: idx + phrase.length });
      idx = text.indexOf(phrase, idx + phrase.length);
    }
  }
  return issues;
}

/** Combines word- and phrase-level issues, letting a phrase match win over any single-word match
 *  it overlaps (e.g. "انشاء الله" as a phrase takes priority over "انشاء" alone as a word) rather
 *  than flagging the same span twice with two different, conflicting suggested fixes. */
export function findAllSpellIssues(text: string): SpellIssue[] {
  const phraseIssues = findPhraseIssues(text);
  const wordIssues = findSpellIssues(text).filter(
    w => !phraseIssues.some(p => w.start < p.end && w.end > p.start)
  );
  return [...phraseIssues, ...wordIssues].sort((a, b) => a.start - b.start);
}

/** Replaces one text node with fragments/spans for every flagged span found within it — the
 *  shared core `markMisspellings` (off-DOM string rewrite) and `markMisspellingsLive` (live DOM,
 *  skips the node with the caret) both drive per text node. */
function markTextNode(textNode: Text): void {
  const text = textNode.textContent ?? '';
  const issues = findAllSpellIssues(text);
  if (issues.length === 0) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const issue of issues) {
    if (issue.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, issue.start)));
    const span = document.createElement('span');
    span.className = 'spell-miss';
    span.dataset.fix = issue.fix;
    span.title = `Did you mean "${issue.fix}"?`;
    span.textContent = issue.word;
    frag.appendChild(span);
    cursor = issue.end;
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  textNode.parentNode?.replaceChild(frag, textNode);
}

/** Wraps every flagged word in a clickable `<span class="spell-miss" data-fix="...">` for click-to-fix editing.
 *  Off-DOM (works on an HTML string) — used by the explicit "Spell Check" button's full re-mark,
 *  which is safe to fully remount since it's a discrete, explicit user action. */
export function markMisspellings(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) textNodes.push(node as Text);
  textNodes.forEach(markTextNode);
  return container.innerHTML;
}

/** Live variant: marks misspellings directly on an already-mounted, already-marked page element
 *  in place — no HTML string round-trip, no React state/renderKey touch — so it's safe to call on
 *  a debounce while the user is still typing. Skips `skipNode` (the text node currently holding
 *  the caret, if any): replacing that node's content mid-typing would destroy the caret, and not
 *  flagging the word being actively typed is standard live-spellcheck behaviour anyway (Word,
 *  Google Docs). Already-marked spans elsewhere are left alone rather than re-flagged, and only
 *  newly-appeared plain text nodes get scanned. */
export function markMisspellingsLive(root: HTMLElement, skipNode: Node | null): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === skipNode) continue;
    // A text node already inside a spell-miss span was marked by a previous pass — re-marking it
    // would double-wrap it in another span.
    if (node.parentElement?.classList.contains('spell-miss')) continue;
    textNodes.push(node as Text);
  }
  textNodes.forEach(markTextNode);
}

/** Strips spell-check marker spans back to plain text content — always run before export/send. */
export function stripSpellMarks(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('.spell-miss').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent ?? ''));
  });
  return container.innerHTML;
}
