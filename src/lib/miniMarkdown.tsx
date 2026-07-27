import type { ReactNode } from 'react';

/** A small, dependency-free markdown renderer scoped to what a chat message actually needs —
 *  bold/italic/strikethrough/inline-code/links/code-blocks. Not a CommonMark implementation
 *  (no headings, lists, blockquotes, tables); chat bubbles don't need any of that, and pulling
 *  in a full markdown library for this would be a lot of bundle weight for a handful of inline
 *  styles. Every chunk stays plain text unless it matches one of these patterns, so ordinary
 *  messages with no markdown in them render byte-for-byte as before. */

const INLINE_PATTERN = /`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_\n]+)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${i++}`;
    const [, code, boldStar, boldUnder, strike, italicStar, italicUnder, linkText, linkHref] = match;
    if (code !== undefined) {
      nodes.push(<code key={key} className="px-1 py-0.5 rounded bg-ink/10 font-mono text-[0.9em]">{code}</code>);
    } else if (boldStar !== undefined || boldUnder !== undefined) {
      nodes.push(<strong key={key}>{boldStar ?? boldUnder}</strong>);
    } else if (strike !== undefined) {
      nodes.push(<del key={key}>{strike}</del>);
    } else if (italicStar !== undefined || italicUnder !== undefined) {
      nodes.push(<em key={key}>{italicStar ?? italicUnder}</em>);
    } else if (linkText !== undefined && linkHref !== undefined) {
      nodes.push(
        <a key={key} href={linkHref} target="_blank" rel="noopener noreferrer" className="underline text-accent hover:text-ink break-all">
          {linkText}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Renders a chat message body: triple-backtick fences become `<pre>` blocks (no inline
 *  formatting inside them, matching every other markdown renderer's convention), everything
 *  else is split on newlines and run through `renderInline`, with `<br />` between lines so
 *  callers no longer need `whitespace-pre-line` themselves. */
export function renderMarkdownMessage(body: string): ReactNode {
  const parts = body.split(/```/);
  const blocks: ReactNode[] = [];
  parts.forEach((part, idx) => {
    const isCodeBlock = idx % 2 === 1;
    if (isCodeBlock) {
      const content = part.replace(/^\n/, '').replace(/\n$/, '');
      blocks.push(
        <pre key={`block-${idx}`} className="my-1 p-2 rounded-lg bg-ink/10 overflow-x-auto text-[0.85em] font-mono whitespace-pre">
          <code>{content}</code>
        </pre>
      );
    } else {
      const lines = part.split('\n');
      lines.forEach((line, lineIdx) => {
        blocks.push(...renderInline(line, `${idx}-${lineIdx}`));
        if (lineIdx < lines.length - 1) blocks.push(<br key={`br-${idx}-${lineIdx}`} />);
      });
    }
  });
  return blocks;
}
