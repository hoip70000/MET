import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Tool-group flyouts (`ToolFlyout.tsx`/`ToolGroupButton.tsx`) — right-click/long-press/arrow on a
 * grouped tool icon (Lasso, Gradient, etc.) opens a popup anchored to that icon, to the right of a
 * vertical rail or above a horizontal one, never over the canvas. Covers the three real gaps found
 * against the flyout's existing (already-correct) positioning: viewport-edge clamping, Esc-to-close,
 * and auto-close when a tool from outside this group becomes active.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('right-clicking a grouped tool icon opens a flyout to the right of the rail, not over the canvas', async ({ page }) => {
  const railButton = page.getByRole('button', { name: 'Lasso' });
  const railBox = (await railButton.boundingBox())!;

  await railButton.click({ button: 'right' });
  const polyLasso = page.getByRole('button', { name: 'Polygonal Lasso' });
  await expect(polyLasso).toBeVisible();
  const flyoutItemBox = (await polyLasso.boundingBox())!;
  expect(flyoutItemBox.x).toBeGreaterThan(railBox.x + railBox.width);
});

test('the browser native context menu never appears on a tool rail icon', async ({ page }) => {
  let nativeMenuFired = false;
  await page.exposeBinding('__nativeContextMenu', () => { nativeMenuFired = true; });
  await page.evaluate(() => {
    document.addEventListener('contextmenu', (e) => {
      if (!e.defaultPrevented) (window as unknown as { __nativeContextMenu: () => void }).__nativeContextMenu();
    });
  });
  await page.getByRole('button', { name: 'Lasso' }).click({ button: 'right' });
  await page.waitForTimeout(200);
  expect(nativeMenuFired).toBe(false);
});

test('Escape closes the flyout', async ({ page }) => {
  await page.getByRole('button', { name: 'Lasso' }).click({ button: 'right' });
  const polyLasso = page.getByRole('button', { name: 'Polygonal Lasso' });
  await expect(polyLasso).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(polyLasso).toBeHidden();
});

test('picking a tool from the flyout activates it and closes the flyout', async ({ page }) => {
  await page.getByRole('button', { name: 'Lasso' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Polygonal Lasso' }).click();

  // The flyout unmounts (only the rail's own icon remains, now showing Polygonal Lasso as this
  // group's active/shown tool) — exactly one match, positioned back at the rail, not floated.
  const relabeled = page.getByRole('button', { name: 'Polygonal Lasso' });
  await expect(relabeled).toHaveCount(1);
  const box = (await relabeled.boundingBox())!;
  const railBox = (await page.getByRole('button', { name: 'Move' }).boundingBox())!; // any rail icon, for an x reference
  expect(box.x).toBeLessThan(railBox.x + 60); // still inside the rail column, not off to the side
});

test('switching to a tool outside the group closes an open flyout', async ({ page }) => {
  // The default active tool is already 'select' (Move) on a fresh Studio, so switching *to* it
  // wouldn't actually change activeTool — pick a genuinely different, unrelated single-tool group.
  await page.getByRole('button', { name: 'Lasso' }).click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Polygonal Lasso' })).toBeVisible();

  await page.keyboard.press('e'); // Eraser, a different group entirely
  await expect(page.getByRole('button', { name: 'Polygonal Lasso' })).toBeHidden();
});

test('at a narrow (768px) viewport the flyout still opens clear of the canvas and within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  const railButton = page.getByRole('button', { name: 'Lasso' });
  const railBox = (await railButton.boundingBox())!;

  await railButton.click({ button: 'right' });
  const polyLasso = page.getByRole('button', { name: 'Polygonal Lasso' });
  await expect(polyLasso).toBeVisible();
  const box = (await polyLasso.boundingBox())!;

  expect(box.x).toBeGreaterThan(railBox.x + railBox.width);
  expect(box.x + box.width).toBeLessThanOrEqual(768);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
});
