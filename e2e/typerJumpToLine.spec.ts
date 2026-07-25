import { test, expect, type Page } from '@playwright/test';
import { openStudio, readStudioStore } from './studioFixture';

/**
 * TypeR jump-to-line: every parsed line in the pasted script is now listed (numbered, individually
 * clickable), and clicking one jumps the current position directly to it (trSetCur-style — a direct
 * index set) rather than advancing one line at a time. Sequential advance (placing a bubble on
 * canvas, which still just does index+1 in Studio.tsx) must keep working unmodified.
 */

const LINES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett'];

async function openTyperPanel(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'TypeR' }).or(page.getByText('TypeR', { exact: true })).first().click();
  await page.getByPlaceholder(/Paste a script/).fill(LINES.join('\n'));
}

/** Arms placement (only if not already armed — the same button toggles it off on a second click,
 *  and a single-bubble placement doesn't auto-disarm unless it was the script's last line), clicks
 *  the canvas once to place the current line, then polls (autosave is debounced) until a NEW text
 *  layer actually lands — not just until *a* layer exists, which a stale pre-placement snapshot
 *  from an earlier call would already satisfy and silently prove nothing. */
async function placeAndGetContent(page: Page, previousCount: number): Promise<string> {
  const armButton = page.getByRole('button', { name: /Arm placement|Armed/ });
  if ((await armButton.textContent())?.includes('Arm placement')) {
    await armButton.click();
  }
  const box = (await page.locator('canvas').first().boundingBox())!;
  // A different spot per placement — clicking the same point twice would land the second click
  // inside the text box just placed there, which is "click an existing layer" territory, not an
  // armed-placement click.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4 + previousCount * 40);

  let content = '';
  await expect.poll(async () => {
    const store = await readStudioStore(page);
    if (!store) return -1;
    const layersByPage = JSON.parse(store.layersJson) as Record<string, { type: string; text?: { content: string } }[]>;
    const texts = Object.values(layersByPage).flat().filter(l => l.type === 'text');
    if (texts.length > previousCount) content = texts[texts.length - 1]?.text?.content ?? '';
    return texts.length;
  }, { timeout: 15_000 }).toBeGreaterThan(previousCount);
  return content;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('pasting a script lists every line, numbered', async ({ page }) => {
  await openTyperPanel(page);
  for (const line of LINES) {
    await expect(page.getByText(line, { exact: true })).toBeVisible();
  }
});

test('clicking a line jumps straight to it, not through the lines in between', async ({ page }) => {
  await openTyperPanel(page);
  // Jump straight to line 7 ("Golf") from the default line 1 — should place Golf, not Alpha.
  await page.getByText('Golf', { exact: true }).click();
  expect(await placeAndGetContent(page, 0)).toBe('Golf');
});

test('clicking a different line jumps again, in either direction', async ({ page }) => {
  await openTyperPanel(page);
  await page.getByText('Golf', { exact: true }).click(); // index 6
  expect(await placeAndGetContent(page, 0)).toBe('Golf');

  // Jump backward to line 3 ("Charlie") — a plain index set, not bounded by "only forward".
  await page.getByText('Charlie', { exact: true }).click();
  expect(await placeAndGetContent(page, 1)).toBe('Charlie');
});

test('sequential advance (placing a bubble) still works unmodified after a jump', async ({ page }) => {
  await openTyperPanel(page);
  await page.getByText('Charlie', { exact: true }).click(); // index 2
  expect(await placeAndGetContent(page, 0)).toBe('Charlie');

  // No further jump — placing again should advance sequentially to the next line, "Delta".
  expect(await placeAndGetContent(page, 1)).toBe('Delta');
});
