import { describe, it, expect } from 'vitest';
import { layoutText } from './textLayout';
import { DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_GRADIENT, type TextLayerData } from './studioTypes';

/** Mirrors createTextLayer's defaults (studioTypes.ts) minus x/y/width, which each test sets. */
function makeText(overrides: Partial<TextLayerData> = {}): TextLayerData {
  return {
    content: '',
    x: 0,
    y: 0,
    width: 200,
    autoWidth: false,
    letterSpacing: 0,
    shadow: { ...DEFAULT_TEXT_SHADOW },
    gradient: { ...DEFAULT_TEXT_GRADIENT },
    runs: [],
    fontFamily: 'Arial',
    fontSize: 20,
    color: '#000000',
    align: 'left',
    bold: false,
    italic: false,
    lineHeight: 1.15,
    strokeColor: '#ffffff',
    strokeWidth: 0,
    rotation: 0,
    status: 'draft',
    comment: '',
    ...overrides,
  };
}

const lineStep = (text: TextLayerData) => text.fontSize * text.lineHeight;

describe('layoutText overflow', () => {
  it('does not overflow when content fits within fixedHeight', () => {
    const text = makeText({ content: 'One short line', fixedHeight: 200 });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
  });

  it('overflows when content exceeds fixedHeight', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three\nLine four\nLine five', fixedHeight: 30 });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(true);
  });

  it('does not overflow exactly at the threshold (naturalHeight === fixedHeight)', () => {
    const text = makeText({ content: 'Just one line' });
    const natural = layoutText(text).height;
    const atThreshold = layoutText({ ...text, fixedHeight: natural });
    expect(atThreshold.overflowing).toBe(false);
  });

  it('point text (autoWidth) never overflows regardless of fixedHeight or content length', () => {
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n');
    const text = makeText({ content: longContent, autoWidth: true, fixedHeight: 10 });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
  });

  it('never overflows when fixedHeight is not set', () => {
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n');
    const text = makeText({ content: longContent });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
  });

  it('flips overflowing live as fixedHeight shrinks or grows (purely derived, never stale)', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three' });
    const natural = layoutText(text).height;

    const shrunk = layoutText({ ...text, fixedHeight: natural - 1 });
    expect(shrunk.overflowing).toBe(true);

    const grown = layoutText({ ...text, fixedHeight: natural + 1 });
    expect(grown.overflowing).toBe(false);
  });

  it('flips overflowing when fontSize grows past the threshold', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three', fontSize: 12 });
    const naturalAtSmall = layoutText(text).height;
    const fitsAtSmall = layoutText({ ...text, fixedHeight: naturalAtSmall });
    expect(fitsAtSmall.overflowing).toBe(false);

    const biggerFont = { ...text, fontSize: 40, fixedHeight: naturalAtSmall };
    expect(layoutText(biggerFont).overflowing).toBe(true);
  });

  it('height is independent of fixedHeight — the exact auto-fit contract', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three\nLine four', fixedHeight: 20 });
    const naturalWithSmallFrame = layoutText(text).height;
    const naturalWithNoFrame = layoutText({ ...text, fixedHeight: undefined }).height;
    expect(naturalWithSmallFrame).toBe(naturalWithNoFrame);
    expect(naturalWithSmallFrame).toBe(Math.max(1, 4) * lineStep(text));
  });

  it('feeding layoutText(text).height back in as fixedHeight makes overflowing false next time', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three', fixedHeight: 10 });
    expect(layoutText(text).overflowing).toBe(true);

    const fitted = layoutText(text).height;
    const autoFit = { ...text, fixedHeight: fitted };
    expect(layoutText(autoFit).overflowing).toBe(false);
  });
});
