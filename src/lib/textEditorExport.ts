import { stripSpellMarks } from './spellCheck';
import { stripStatusMarks } from './textEditorMarks';
import type { TextEditorDoc } from './textEditorStore';

/** Strips every editorial annotation — spell-check marks and section status
 *  marks alike — before any export. Both are editor-only chrome, never
 *  meant to reach TXT/DOCX/PDF output. */
function stripEditorialMarks(html: string): string {
  return stripStatusMarks(stripSpellMarks(html));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A hard page break (Ctrl+Enter) lives inside a single logical page's HTML as an invisible
 *  marker div — swap it for a literal form-feed so plain-text export still represents the break,
 *  matching the existing page-boundary convention of joining pages with `\n\f\n`. Images have no
 *  plain-text form of their own, so they're represented as a literal "[Image]" placeholder rather
 *  than silently vanishing (innerText would otherwise just skip them). */
export function pageToPlainText(pageHtml: string): string {
  const container = document.createElement('div');
  container.innerHTML = stripEditorialMarks(pageHtml);
  container.innerHTML = stripSpellMarks(pageHtml);
  container.querySelectorAll('[data-hard-break="true"]').forEach((el) => {
    el.replaceWith(document.createTextNode('\f'));
  });
  container.querySelectorAll('img').forEach((el) => {
    el.replaceWith(document.createTextNode('[Image]'));
  });
  return container.innerText;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function imageTypeFromDataUrl(dataUrl: string): 'jpg' | 'png' | 'gif' | 'bmp' {
  const mime = dataUrl.match(/^data:image\/(\w+);/)?.[1]?.toLowerCase();
  if (mime === 'jpeg' || mime === 'jpg') return 'jpg';
  if (mime === 'gif') return 'gif';
  if (mime === 'bmp') return 'bmp';
  return 'png';
}

export function exportDocAsTxt(doc: TextEditorDoc) {
  const text = doc.pages.map(pageToPlainText).join('\n\f\n');
  downloadBlob(new Blob([text], { type: 'text/plain' }), `${doc.title || 'Untitled'}.txt`);
}

interface ParsedBlock {
  level: 'h1' | 'h2' | 'h3' | 'p';
  runs: { text: string; bold: boolean; italic: boolean; underline: boolean }[];
  pageBreakBefore?: boolean;
  /** Set when this "block" is really a top-level `<img>` rather than a text paragraph — Insert >
   *  Image always lands the tag as a direct child of the page, matching this app's own insertion
   *  path; an image mixed inline within a text paragraph isn't reconstructed here (a bounded,
   *  documented simplification, not a silent gap — see CLAUDE.md). Dimensions come from whatever
   *  the image's own inline `style.width/height` currently is (set by the resize-handle drag), so
   *  an image the user never resized falls back to a fixed default rather than probing its
   *  natural size asynchronously. */
  image?: { dataUrl: string; width: number; height: number };
}

/** Reads the block-level structure of a page's HTML into paragraph descriptors for DOCX export. */
function parseBlocks(pageHtml: string): ParsedBlock[] {
  const container = document.createElement('div');
  container.innerHTML = stripEditorialMarks(pageHtml);
  const blocks: ReturnType<typeof parseBlocks> = [];

  function runsFromNode(node: Node, bold: boolean, italic: boolean, underline: boolean): { text: string; bold: boolean; italic: boolean; underline: boolean }[] {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      return text ? [{ text, bold, italic, underline }] : [];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const nextBold = bold || tag === 'b' || tag === 'strong';
    const nextItalic = italic || tag === 'i' || tag === 'em';
    const nextUnderline = underline || tag === 'u';
    return Array.from(el.childNodes).flatMap(child => runsFromNode(child, nextBold, nextItalic, nextUnderline));
  }

  const blockNodes = container.children.length > 0 ? Array.from(container.children) : [container];
  // A hard page break (Ctrl+Enter) is an invisible marker div sitting between two blocks on the
  // same logical page — it doesn't carry content of its own, it just means "start the next real
  // block on a new page."
  let pendingBreak = false;
  for (const blockEl of blockNodes) {
    if (blockEl instanceof HTMLElement && blockEl.dataset.hardBreak === 'true') {
      pendingBreak = true;
      continue;
    }
    const tag = blockEl.tagName.toLowerCase();
    if (tag === 'img' && blockEl instanceof HTMLImageElement) {
      const width = parseFloat(blockEl.style.width) || 300;
      const height = parseFloat(blockEl.style.height) || 200;
      blocks.push({ level: 'p', runs: [], pageBreakBefore: pendingBreak, image: { dataUrl: blockEl.src, width, height } });
      pendingBreak = false;
      continue;
    }
    const level = tag === 'h1' || tag === 'h2' || tag === 'h3' ? tag : 'p';
    const runs = runsFromNode(blockEl, false, false, false);
    if (runs.length > 0) {
      blocks.push({ level: level as 'h1' | 'h2' | 'h3' | 'p', runs, pageBreakBefore: pendingBreak });
      pendingBreak = false;
    }
  }
  return blocks;
}

export async function exportDocAsDocx(doc: TextEditorDoc): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, ImageRun } = await import('docx');
  const HEADING_MAP = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;

  const children: InstanceType<typeof Paragraph>[] = [];
  doc.pages.forEach((pageHtml, pageIndex) => {
    const blocks = parseBlocks(pageHtml);
    blocks.forEach((block, blockIndex) => {
      const isFirstOfPage = blockIndex === 0 && pageIndex > 0;
      const needsBreak = isFirstOfPage || block.pageBreakBefore;
      if (block.image) {
        const imageRun = new ImageRun({
          type: imageTypeFromDataUrl(block.image.dataUrl),
          data: dataUrlToUint8Array(block.image.dataUrl),
          transformation: { width: block.image.width, height: block.image.height },
        });
        children.push(new Paragraph({
          children: needsBreak ? [new TextRun({ children: [new PageBreak()] }), imageRun] : [imageRun],
        }));
        return;
      }
      const runs = block.runs.map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, underline: r.underline ? {} : undefined }));
      children.push(new Paragraph({
        heading: block.level === 'p' ? undefined : HEADING_MAP[block.level],
        children: needsBreak ? [new TextRun({ children: [new PageBreak()] }), ...runs] : runs,
        bidirectional: doc.dir === 'rtl',
      }));
    });
    if (blocks.length === 0 && pageIndex < doc.pages.length - 1) {
      children.push(new Paragraph({ children: [new TextRun({ children: [new PageBreak()] })] }));
    }
  });

  const document = new Document({ sections: [{ children: children.length > 0 ? children : [new Paragraph('')] }] });
  return Packer.toBlob(document);
}

/** Opens a print-formatted window with @media print A4 page breaks matching the on-screen
 *  pages exactly, then triggers the browser's native print dialog — "Save as PDF" from there
 *  produces print-quality output without needing a heavy client-side PDF rendering library. */
export function printDocAsPdf(doc: TextEditorDoc) {
  const win = window.open('', '_blank');
  if (!win) return;
  const pagesHtml = doc.pages.map(p => `<div class="te-print-page">${stripEditorialMarks(p)}</div>`).join('');
  win.document.write(`<!doctype html><html dir="${doc.dir}"><head><meta charset="utf-8"><title>${doc.title}</title>
    <style>
      @page { size: A4; margin: 20mm; }
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; }
      .te-print-page { page-break-after: always; min-height: 257mm; }
      .te-print-page:last-child { page-break-after: auto; }
      .spell-miss { text-decoration: none; }
    </style>
  </head><body>${pagesHtml}</body></html>`);
  win.document.close();
  win.focus();
  win.onload = () => win.print();
}
