/** Section-level editorial status marks — a block-level annotation tier
 *  above the doc-level status (see textEditorStore.ts's TextEditorDocStatus).
 *  A mark tags one or more of the page's own top-level block children (the
 *  same "block is the atomic unit" assumption reflow() already relies on)
 *  with a class + data attributes; a CSS rule (index.css) renders the left
 *  border accent and margin icon via ::before, so no extra DOM node is ever
 *  part of the exported content. Marks are editorial annotations only —
 *  stripStatusMarks() removes them before every export, mirroring how
 *  spellCheck.ts's stripSpellMarks() already handles spell-check marks. */

export type MarkStatus = 'inProgress' | 'finished' | 'reviewed';

export const MARK_CLASSES: Record<MarkStatus, string> = {
  inProgress: 'te-mark-in-progress',
  finished: 'te-mark-finished',
  reviewed: 'te-mark-reviewed',
};

export const MARK_LABELS: Record<MarkStatus, string> = {
  inProgress: 'In Progress',
  finished: 'Finished',
  reviewed: 'Reviewed',
};

const ALL_MARK_CLASSES = Object.values(MARK_CLASSES);

/** Finds the nearest top-level block child of `root` (the page's own
 *  contentEditable div) that contains `node` — wrapping it in a new <div>
 *  first if it's a bare top-level node with no wrapping element at all.
 *  Text typed before the first Enter press sits directly under the
 *  contentEditable root as a plain text node (no <div>/<p> wrapper — the
 *  browser only starts wrapping lines in block elements once Enter is
 *  pressed), so without this a mark on that very first line would have
 *  nothing to attach its class to. Wraps the whole contiguous run of
 *  adjacent non-element top-level siblings together, not just the touched
 *  node alone, so the new block represents the complete line. */
function ensureTopLevelBlock(root: HTMLElement, node: Node): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.parentNode !== root) el = el.parentNode;
  if (el instanceof HTMLElement) return el;
  if (!el || el.parentNode !== root) return null;

  let start = el;
  while (start.previousSibling && !(start.previousSibling instanceof HTMLElement)) start = start.previousSibling;
  let end = el;
  while (end.nextSibling && !(end.nextSibling instanceof HTMLElement)) end = end.nextSibling;

  const wrapper = document.createElement('div');
  root.insertBefore(wrapper, start);
  let cursor: Node | null = start;
  while (cursor) {
    const next: Node | null = cursor === end ? null : cursor.nextSibling;
    wrapper.appendChild(cursor);
    cursor = next;
  }
  return wrapper;
}

/** Tags every top-level block the given range overlaps with a
 *  data-mark-status attribute + a te-mark-* class. Returns how many blocks
 *  were marked (0 if the range doesn't resolve to any top-level block,
 *  e.g. a collapsed/empty selection). */
export function markSelectionAs(root: HTMLElement, range: Range, status: MarkStatus, markedAt: number = Date.now()): number {
  // Read both boundary containers up front. Resolving/wrapping the start
  // boundary mutates the DOM (moving nodes into a new wrapper), and per the
  // DOM spec a Range auto-rewrites its OWN boundary points when their
  // container node is moved — a live re-read of range.endContainer done
  // *after* that mutation would return a corrupted value (rewritten to the
  // node's old position) rather than the original endpoint.
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startBlock = ensureTopLevelBlock(root, startContainer);
  if (!startBlock) return 0;
  const endBlock = ensureTopLevelBlock(root, endContainer);
  if (!endBlock) return 0;

  const children = Array.from(root.children);
  const startIdx = children.indexOf(startBlock);
  const endIdx = children.indexOf(endBlock);
  if (startIdx === -1 || endIdx === -1) return 0;
  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);

  let count = 0;
  for (let i = lo; i <= hi; i++) {
    const block = children[i];
    if (!(block instanceof HTMLElement)) continue;
    ALL_MARK_CLASSES.forEach(c => block.classList.remove(c));
    block.classList.add(MARK_CLASSES[status]);
    block.setAttribute('data-mark-status', status);
    block.setAttribute('data-mark-at', String(markedAt));
    block.setAttribute('title', `Marked as ${MARK_LABELS[status]} — ${new Date(markedAt).toLocaleString()}`);
    count++;
  }
  return count;
}

/** Removes every status mark's class/attributes (keeps the block and its
 *  content) so exported TXT/DOCX/PDF never see them — editorial annotations
 *  only, matching stripSpellMarks()'s exact convention. */
export function stripStatusMarks(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('[data-mark-status]').forEach((el) => {
    ALL_MARK_CLASSES.forEach(c => el.classList.remove(c));
    el.removeAttribute('data-mark-status');
    el.removeAttribute('data-mark-at');
    el.removeAttribute('title');
    if (!el.getAttribute('class')) el.removeAttribute('class');
  });
  return container.innerHTML;
}
