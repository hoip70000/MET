import { test, expect, type Page } from '@playwright/test';
import { openStudio, readStudioStore, typeIntoTextLayer } from './studioFixture';

/**
 * Overflow indicator (⊞) on area (fixed-height) text boxes: appears once wrapped content exceeds
 * the frame, real content is clipped at the frame's bottom edge, a single click on the glyph is a
 * no-op, a double-click auto-fits the frame to content (undoably), and its on-screen footprint
 * stays a fixed ~16px regardless of zoom. See TextLayerNode.tsx / textLayout.ts / Studio.tsx's
 * handleAutoFitTextHeight.
 */

interface StoredTextLayer {
  type: string;
  text?: { x: number; y: number; width: number; fontSize: number; fixedHeight?: number; autoWidth: boolean; content: string };
}

async function findTextLayers(page: Page): Promise<StoredTextLayer[]> {
  const store = await readStudioStore(page);
  if (!store) return [];
  const layersByPage = JSON.parse(store.layersJson) as Record<string, StoredTextLayer[]>;
  return Object.values(layersByPage).flat().filter(l => l.type === 'text');
}

/** Polls until the just-created text layer has a persisted fixedHeight, then returns it. Also
 *  waits out the autosave debounce (Studio.tsx schedules it ~1.2s after the last change), so
 *  callers get a value that's actually landed in IndexedDB, not a stale pre-creation read. */
async function waitForFixedHeight(page: Page): Promise<number> {
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 }).toBeGreaterThan(0);
  return (await findTextLayers(page))[0].text!.fixedHeight!;
}

/** How many newline-separated short lines it takes to push naturalHeight (fontSize * lineHeight
 *  per line, textLayout.ts) past a box's persisted fixedHeight (image-space px, queried back from
 *  the store rather than assumed — the drag's screen-space size maps to an image-space fixedHeight
 *  through the Stage's current zoom, which the test doesn't otherwise know). */
function linesToOverflow(fixedHeight: number, fontSize = 28, lineHeight = 1.15): number {
  return Math.ceil(fixedHeight / (fontSize * lineHeight)) + 3;
}

/** Counts pixels matching the ⊞ indicator's light background-square fill (#fffbeb) anywhere on
 *  the stage — a distinctive cream color the fixture's flat grey page and default black text never
 *  produce, so presence/absence is a reliable global signal without knowing exact screen
 *  coordinates (mirrors studioFixture.ts's countDarkPixels, scoped to `.konvajs-content canvas`). */
async function countIndicatorFillPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const c of Array.from(document.querySelectorAll('.konvajs-content canvas'))) {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128 && data[i] > 240 && data[i + 1] > 235 && data[i + 2] > 200 && data[i + 2] < 245) n += 1;
      }
    }
    return n;
  });
}

/** Counts pixels matching a color predicate within a small *screen*-space region (a screenshot
 *  clip, decoded back into a canvas) — for positional assertions (did the indicator move with the
 *  box? is content actually clipped past the frame?) that need to check a specific spot rather
 *  than the whole stage. A per-pixel count, not an average: averaging a small ~16px feature over a
 *  wider patch dilutes it below any sane threshold once the surrounding background contributes
 *  most of the patch's area — counting matching pixels directly (same technique as
 *  countIndicatorFillPixels/studioFixture's countDarkPixels) doesn't have that problem. */
async function countPixelsInRegion(
  page: Page, x: number, y: number, width: number, height: number, kind: 'indicator' | 'dark',
): Promise<number> {
  const shot = await page.screenshot({ clip: { x, y, width, height } });
  return page.evaluate(async ({ b64, kind }) => {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a <= 128) continue;
      if (kind === 'indicator') {
        if (r > 240 && g > 230 && b > 200 && b < 250) n += 1;
      } else {
        if (r < 64 && g < 64 && b < 64) n += 1;
      }
    }
    return n;
  }, { b64: shot.toString('base64'), kind });
}

/** Finds the ⊞ indicator's actual on-screen position empirically (the centroid of its fill-color
 *  pixels on whichever stage canvas holds it), rather than computed from the drag gesture's
 *  origin/size and assumed scale math — sidesteps needing to reason about zoom/backing-store
 *  ratios at all for a positional assertion. Returns null if no indicator is currently on screen. */
async function findIndicatorScreenPos(page: Page): Promise<{ x: number; y: number } | null> {
  const canvases = page.locator('.konvajs-content canvas');
  const count = await canvases.count();
  for (let i = 0; i < count; i++) {
    const el = canvases.nth(i);
    const box = await el.boundingBox();
    if (!box) continue;
    const centroid = await el.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a > 128 && r > 240 && g > 230 && b > 200 && b < 250) { sx += x; sy += y; n += 1; }
        }
      }
      if (n === 0) return null;
      return { x: sx / n, y: sy / n, backingW: canvas.width, backingH: canvas.height };
    });
    if (centroid) {
      return {
        x: box.x + (centroid.x / centroid.backingW) * box.width,
        y: box.y + (centroid.y / centroid.backingH) * box.height,
      };
    }
  }
  return null;
}

/**
 * A screen point guaranteed to land on the rendered page, not the dark padding around it.
 * `fitToScreen` centers the page within the Stage's container (confirmed by
 * typerBubbleDetect.spec.ts: "the box's center is the image's center"), so the container's own
 * center is reliably on-page at any zoom — unlike a fixed offset from the container's corner,
 * which can land in the surrounding padding once the page is smaller than the container (an
 * earlier version of this helper tried to find the page by scanning canvas pixels for its flat
 * grey fill instead; that turned out to be flaky, since `.konvajs-content` can resolve to more
 * than one canvas — e.g. Transformer/overlay chrome on its own Layer — with different pixel
 * dimensions, and picking the wrong one silently corrupted the computed rect). */
async function getPageCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags out an area (box) text layer via the Text tool, at a known origin *inside the rendered
 *  page* — a drag, not a click, so it gets a fixedHeight (StudioCanvas.tsx's onAddTextLayer
 *  boxWidth/boxHeight path). Fresh text layers auto-enter edit mode (StudioCanvas.tsx), so the
 *  caller can type straight away. Returns the drag's screen origin — the box's bottom-center in
 *  screen space right after creation is (x0 + w/2, y0 + h), regardless of the Stage's actual zoom,
 *  since the drag itself was driven in screen pixels. Origin is offset up/left from the page's
 *  center by less than a typical fit-to-screen page's half-extent, so it stays on-page. */
async function dragCreateAreaText(page: Page, w: number, h: number): Promise<{ x0: number; y0: number }> {
  await page.keyboard.press('t');
  const center = await getPageCenter(page);
  // Modest offset from center (not a corner-relative guess) — safely on-page across the range of
  // container/page sizes this suite's viewport actually produces.
  const x0 = center.x - 40, y0 = center.y - 60;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + w, y0 + h, { steps: 8 });
  await page.mouse.up();
  return { x0, y0 };
}

/** Deselects (clicking empty canvas, well clear of where every test's box is created) so the
 *  Transformer's own handles — drawn on top and always winning the hit-test — aren't sitting on
 *  top of the indicator at the same screen point. The indicator itself renders and is interactive
 *  regardless of selection. */
async function deselect(page: Page): Promise<void> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(150);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
  // A short settle after the Studio mounts — the canvas element is visible (openStudio already
  // waits for that) slightly before the Stage's fitToScreen/pointer handling has fully settled;
  // without this, a tool keypress immediately followed by a mouse gesture can occasionally land
  // before the Stage is ready to act on it, and no layer gets created at all.
  await page.waitForTimeout(400);
});

test('short content in a roomy box shows no overflow indicator', async ({ page }) => {
  await dragCreateAreaText(page, 200, 150);
  await typeIntoTextLayer(page, 'A short line');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await countIndicatorFillPixels(page)).toBe(0);
});

test('typing past the frame height shows the indicator, deleting back down hides it', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);

  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);

  // Re-enter editing (double-click the box interior, well clear of the indicator/handles) and
  // clear it back down to something short.
  await page.mouse.dblclick(x0 + 80, y0 + 15);
  const textarea = page.locator('textarea:not(#swal2-textarea)').first();
  await textarea.waitFor({ state: 'visible' });
  // Click it ourselves rather than waiting on the app's own post-mount focus effect — more robust
  // than racing that timing, and selectText()/typing need focus regardless of how it got there.
  await textarea.click();
  await textarea.selectText();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');

  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBe(0);
});

test('increasing font size past the threshold shows the indicator; decreasing hides it', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 220, 60);
  await typeIntoTextLayer(page, 'One line of text');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await countIndicatorFillPixels(page)).toBe(0);

  // The layer is already active (Add Text Layer sets it). Ctrl+Period/Comma step its font size —
  // grow it in a handful of steps, well beyond what a single short line at the original size
  // needed to fit the frame.
  await page.mouse.click(x0 + 80, y0 + 15);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+Period');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);

  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+Comma');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBe(0);
});

test('clicking the indicator is a no-op: no resize, no content change, indicator stays', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);
  await deselect(page);
  // Let autosave actually flush before taking the "before" snapshot, so it reflects the real
  // persisted state rather than a pre-typing read that the click's "after" read would then be
  // spuriously compared against once autosave belatedly catches up.
  await page.waitForTimeout(1500);

  const before = (await findTextLayers(page))[0].text!;
  await page.mouse.click(x0 + 80, y0 + 40);
  await page.waitForTimeout(300);
  const after = (await findTextLayers(page))[0].text!;

  expect(after.fixedHeight).toBe(before.fixedHeight);
  expect(after.width).toBe(before.width);
  expect(after.content).toBe(before.content);
  // Still there — the click didn't consume/dismiss it either.
  expect(await countIndicatorFillPixels(page)).toBeGreaterThan(15);
});

test('double-clicking the indicator auto-fits the frame height, undoably', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);
  await deselect(page);

  await page.mouse.dblclick(x0 + 80, y0 + 40);
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 })
    .toBeGreaterThan(fh + 5);
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBe(0);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 })
    .toBeCloseTo(fh, 0);
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);
});

test('the indicator keeps the same on-screen footprint at different zoom levels', async ({ page }) => {
  await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const atDefaultZoom = await countIndicatorFillPixels(page);

  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await page.waitForTimeout(300);
  const atZoomedOut = await countIndicatorFillPixels(page);

  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(300);
  const atZoomedIn = await countIndicatorFillPixels(page);

  // If the indicator scaled with zoom, its area (and thus matching pixel count) would move by
  // roughly the square of the zoom ratio across these steps; a fixed-screen-size indicator stays
  // within a generous band regardless.
  expect(atZoomedOut).toBeGreaterThan(atDefaultZoom * 0.4);
  expect(atZoomedOut).toBeLessThan(atDefaultZoom * 2.5);
  expect(atZoomedIn).toBeGreaterThan(atDefaultZoom * 0.4);
  expect(atZoomedIn).toBeLessThan(atDefaultZoom * 2.5);
});

test('dragging the box body moves the indicator with it', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);

  const oldSpot = await findIndicatorScreenPos(page);
  expect(oldSpot).not.toBeNull();

  // Drag the box body (well clear of the indicator/handles, and clear of where the drag started
  // creating the box, so this is unambiguously a body drag) by a small screen delta — kept small
  // because the on-screen drag distance for a *selected* text layer in this app doesn't track the
  // pointer 1:1 (a pre-existing characteristic of this drag path, unrelated to what this task
  // changed), so a larger nominal delta risks carrying the box off the visible stage entirely.
  const dx = 20, dy = 15;
  await page.mouse.move(x0 + 30, y0 + 10);
  await page.mouse.down();
  await page.mouse.move(x0 + 30 + dx, y0 + 10 + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const newSpot = await findIndicatorScreenPos(page);
  expect(newSpot).not.toBeNull();
  // Checks that the indicator followed the box at all — moved a real distance, in the same
  // direction as the drag (down and to the right) — rather than pinning down the box-drag
  // gesture's own pixel-for-pixel precision, which isn't part of what this task changed.
  expect(newSpot!.x - oldSpot!.x).toBeGreaterThan(5);
  expect(newSpot!.y - oldSpot!.y).toBeGreaterThan(5);
});

test('point text never shows the overflow indicator, however long the content', async ({ page }) => {
  await page.keyboard.press('t');
  const center = await getPageCenter(page);
  await page.mouse.click(center.x, center.y);
  const longContent = Array.from({ length: 30 }, (_, i) => `Line number ${i} of quite a lot of point text`).join('\n');
  // Not typeIntoTextLayer here: this app has more than one textarea in the DOM (e.g. the TypeR
  // panel's script box), and `textarea:not(#swal2-textarea)` isn't specific enough to always pick
  // the text-layer editing overlay over one of those. `[dir]` is unique to the editing overlay
  // (StudioCanvas.tsx sets it to reflect RTL/LTR; TypeR's own textarea has no such attribute).
  const textarea = page.locator('textarea[dir]').first();
  await textarea.waitFor({ state: 'visible' });
  await textarea.click();
  await textarea.pressSequentially(longContent);
  await page.keyboard.press('Escape');

  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.content, { timeout: 15_000 }).toBeTruthy();
  const layers = await findTextLayers(page);
  expect(layers[0].text!.autoWidth).toBe(true);
  expect(layers[0].text!.fixedHeight).toBeUndefined();
  expect(await countIndicatorFillPixels(page)).toBe(0);
});

test('overflowing content is actually clipped at the frame bottom, not just flagged', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) + 5 }, () => 'XXXXXXXXXX');
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);
  await deselect(page);

  // Well below the box's bottom edge (y0 + h), where an unclipped line would otherwise paint —
  // dark default (#000000) text on the fixture's flat grey (#808080) page. If clipping weren't
  // working, several more full lines of "XXXXXXXXXX" would paint through this whole band.
  const darkPixels = await countPixelsInRegion(page, x0, y0 + 40 + 15, 160, 60, 'dark');
  expect(darkPixels).toBe(0);
});
