import { test, expect } from '@playwright/test';
import { openStudio, sampleStageColor, openLayersPanel } from './studioFixture';

/**
 * Adjustment layers must respect their own position in the stack.
 *
 * The page is flat #808080 and a new raster layer is seeded with an opaque copy of it, so the
 * arithmetic is exact: `brightnessContrastFilter(50, 0)` is a pure `+50` offset (its contrast
 * factor is 1 at contrast 0), so 128 -> 178.
 *
 * Two of these encode long-standing lies that `AdjustmentPanel` used to apologise for in its own UI
 * copy: an adjustment only ever filtered the page background, so its stack position was ignored,
 * and its opacity did nothing at all.
 */

const GREY = 128;
const BRIGHTENED = 178;
const TOLERANCE = 4;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

const row = (page: import('@playwright/test').Page, name: string) =>
  page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first();

/**
 * A slider by its label text.
 *
 * Must be scoped: the dock shows two regions at once, so the Adjustment panel stays mounted
 * alongside the Layers panel and a bare `input[type=range]` finds Brightness, not layer Opacity.
 */
const slider = (page: import('@playwright/test').Page, label: string) =>
  page.locator('label').filter({ hasText: label }).locator('input[type=range]').first();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

/** Adds an adjustment layer and sets Brightness to +50. The dock auto-opens the Adjustment panel. */
async function addBrightness(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await slider(page, 'Brightness').waitFor({ state: 'visible' });
  await slider(page, 'Brightness').fill('50');
  await page.waitForTimeout(500);
}

test('an adjustment brightens the page', async ({ page }) => {
  await addBrightness(page);
  const c = await sampleStageColor(page);
  expect(near(c.r, BRIGHTENED), `expected ~${BRIGHTENED}, got ${c.r}`).toBe(true);
});

test('an adjustment affects the paint layer below it', async ({ page }) => {
  // Layer 1 is an opaque copy of the page, so it completely hides the background. If the
  // adjustment only ever filtered the background — the old behaviour — nothing would change here.
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await addBrightness(page);

  const c = await sampleStageColor(page);
  expect(near(c.r, BRIGHTENED), `expected ~${BRIGHTENED} (adjustment applies to the layer below), got ${c.r}`).toBe(true);
});

test('an adjustment does not affect a layer above it', async ({ page }) => {
  await addBrightness(page);
  await openLayersPanel(page);
  // A new raster layer lands on top of the adjustment, seeded with an unbrightened copy of the
  // page, and being opaque it hides everything under it. So the page reads back at its raw value.
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(near(c.r, GREY), `expected ~${GREY} (layer above is unaffected), got ${c.r}`).toBe(true);
});

test('an adjustment’s own opacity fades it toward the unadjusted image', async ({ page }) => {
  await addBrightness(page);
  await openLayersPanel(page);

  // Photoshop blends an adjustment's *result* with its unadjusted backdrop, so 50% lands halfway:
  // (128 + 178) / 2 = 153. This control did nothing at all before.
  // Selecting an adjustment row auto-switches the dock to the Adjustment panel, which shares the
  // `top` region with Layers — so the row's own opacity slider goes off screen with it. The row
  // stays expanded, so coming back to the Layers tab reveals it. (Clunky, but that's the app.)
  await row(page, 'Brightness/Contrast').click();
  await openLayersPanel(page);
  await slider(page, 'Opacity').fill('50');
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(near(c.r, 153), `expected ~153 (50% of the adjustment), got ${c.r}`).toBe(true);
});

test('hiding an adjustment removes it', async ({ page }) => {
  await addBrightness(page);
  await openLayersPanel(page);
  await page.locator('[aria-label="Hide Brightness/Contrast"]').click();
  await page.waitForTimeout(500);

  const c = await sampleStageColor(page);
  expect(near(c.r, GREY), `expected ~${GREY}, got ${c.r}`).toBe(true);
});

test('switching an adjustment to Threshold applies a hard black/white cutoff', async ({ page }) => {
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Threshold' });
  await slider(page, 'Threshold').waitFor({ state: 'visible' });

  // Page is flat grey 128. A threshold below that puts the page's own luminance "above" it -> white.
  await slider(page, 'Threshold').fill('100');
  await page.waitForTimeout(500);
  let c = await sampleStageColor(page);
  expect(near(c.r, 255), `expected white (255) at threshold 100, got ${c.r}`).toBe(true);

  // A threshold above the page's luminance flips it to "below" -> black.
  await slider(page, 'Threshold').fill('200');
  await page.waitForTimeout(500);
  c = await sampleStageColor(page);
  expect(near(c.r, 0), `expected black (0) at threshold 200, got ${c.r}`).toBe(true);
});

test('dragging a Curves control point brightens the canvas live', async ({ page }) => {
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Curves' });

  // The Adjustment panel shares one scrolling column with every other panel in the stack — too
  // little room by default to fit the 200px-tall curves graph without it running off-screen.
  // Collapsing the others hands the column to Adjustment instead (the same chevron toggle a user
  // would reach for), rather than resizing the browser viewport — which shifts the Stage's own
  // fit-to-screen layout and breaks sampleStageColor's "sample the page's on-screen center"
  // assumption. TypeR is included here because, unlike the old single-active-tab dock this panel
  // stack replaced, it now stays visible and expanded alongside Adjustment instead of being hidden
  // by the tab switch.
  await page.getByRole('button', { name: 'Collapse Color panel' }).click();
  await page.getByRole('button', { name: 'Collapse Layers panel' }).click();
  await page.getByRole('button', { name: 'Collapse TypeR panel' }).click();

  const graph = page.getByTestId('curves-graph');
  await graph.waitFor({ state: 'visible' });
  // Collapsing the panels above frees room, but doesn't guarantee the graph lands inside the
  // *current* scroll position of the stack's own scrolling column — a raw `page.mouse.click(x,y)`
  // (needed below, since it targets a specific point on the diagonal line, not just "the element")
  // bypasses Playwright's usual auto-scroll-into-view safety net that `locator.click()` gets for
  // free. Scrolling explicitly first, then measuring, makes this robust to exactly how much room
  // collapsing freed up.
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;

  // The page is flat grey 128, so clicking the graph's mid-x (input ~128) and raising the output
  // to ~200 brightens the whole page uniformly — no need to target a specific canvas position.
  const x = box.x + box.width / 2;
  const y = box.y + box.height * (1 - 200 / 255);
  await page.mouse.click(x, y);
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(c.r, `expected the page to brighten past ${GREY}, got ${c.r}`).toBeGreaterThan(GREY + 20);
});

test('an adjustment inside a group still applies', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(300);
  await addBrightness(page);
  await openLayersPanel(page);

  // Group the adjustment with the layer beneath it. A pass-through group changes nothing, and the
  // adjustment must still reach its sibling below.
  await row(page, 'Layer 1').click();
  await row(page, 'Brightness/Contrast').click({ modifiers: ['Control'] });
  await openLayersPanel(page); // selecting the adjustment swapped the dock away from Layers
  await page.getByRole('button', { name: 'Group layers' }).click();
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(near(c.r, BRIGHTENED), `expected ~${BRIGHTENED}, got ${c.r}`).toBe(true);
});
