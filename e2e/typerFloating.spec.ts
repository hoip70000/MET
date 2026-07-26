import { test, expect, type Page } from '@playwright/test';
import { openStudio, navigateToStudio } from './studioFixture';

/**
 * TypeR as a detached floating window — the first floating panel anywhere in this app. Popping it
 * out replaces the docked tab's content with a "Dock it back" placeholder (never two mounted
 * TyperPanel instances at once, so typerIndex/typerArmed/script state can't fork); dragging its
 * strip moves it; docking back restores the panel in the strip with the same content; the floating
 * state and position persist across a reload of the same chapter.
 */

async function openTyperTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'TypeR' }).or(page.getByText('TypeR', { exact: true })).first().click();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('popping TypeR out shows a floating window and a docked placeholder', async ({ page }) => {
  await openTyperTab(page);
  await expect(page.getByPlaceholder(/Paste a script/)).toBeVisible();

  await page.getByRole('button', { name: 'Float TypeR' }).click();

  await expect(page.getByText('TypeR is floating.')).toBeVisible();
  await expect(page.getByPlaceholder(/Paste a script/)).toBeVisible(); // now inside the floating window
  await expect(page.getByTestId('typer-float-strip')).toBeVisible();
});

test('dragging the floating window strip moves it', async ({ page }) => {
  await openTyperTab(page);
  await page.getByRole('button', { name: 'Float TypeR' }).click();

  const strip = page.getByTestId('typer-float-strip');
  const before = (await strip.boundingBox())!;

  const dx = 120, dy = 80;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + dx, before.y + before.height / 2 + dy, { steps: 10 });
  await page.mouse.up();

  const after = (await strip.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(dx * 0.5);
  expect(after.y - before.y).toBeGreaterThan(dy * 0.5);
});

test('docking back restores the panel in the strip with the same script content', async ({ page }) => {
  await openTyperTab(page);
  await page.getByRole('button', { name: 'Float TypeR' }).click();

  const script = 'Hello from the floating window';
  await page.getByPlaceholder(/Paste a script/).fill(script);

  await page.getByRole('button', { name: 'Dock TypeR back into the panel' }).click();

  await expect(page.getByText('TypeR is floating.')).toHaveCount(0);
  await expect(page.getByPlaceholder(/Paste a script/)).toHaveValue(script);
});

test('floating state and position persist across a reload', async ({ page }) => {
  await openTyperTab(page);
  await page.getByRole('button', { name: 'Float TypeR' }).click();

  const strip = page.getByTestId('typer-float-strip');
  const dx = 100, dy = 60;
  const before = (await strip.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + dx, before.y + before.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600); // persistence is debounced

  const movedBox = (await strip.boundingBox())!;

  // This is a client-side SPA with no per-chapter URL — a plain reload lands back on the Library,
  // not the Studio, so re-navigate through it the same way openStudio's own setup does.
  await page.reload();
  await navigateToStudio(page);

  await expect(page.getByTestId('typer-float-strip')).toBeVisible();
  const restoredBox = (await page.getByTestId('typer-float-strip').boundingBox())!;
  expect(Math.abs(restoredBox.x - movedBox.x)).toBeLessThan(20);
  expect(Math.abs(restoredBox.y - movedBox.y)).toBeLessThan(20);
});
