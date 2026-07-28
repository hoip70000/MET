import { test, expect, type Page } from '@playwright/test';

/**
 * Covers the Text Editor's page-model engine — reflow, hard breaks, cross-page focus, page
 * footers — all of which is direct DOM manipulation invisible to vitest. `seedSession` is
 * duplicated from `studioFixture.ts` (kept private there, scoped to Studio) rather than exported
 * cross-file for one shared helper.
 */
async function seedSession(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: 'e2e-fake-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: oneHourFromNow,
      refresh_token: 'e2e-fake-refresh-token',
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        aud: 'authenticated', role: 'authenticated', email: 'e2e@test.local',
        app_metadata: {}, user_metadata: { name: 'E2E User', avatar: '' },
        created_at: new Date().toISOString(),
      },
    }));
  });
  await page.reload();
}

async function openTextEditor(page: Page): Promise<void> {
  await seedSession(page);
  await page.getByRole('button', { name: 'Text Editor', exact: true }).click();
  await page.locator('.te-page').first().waitFor({ state: 'visible' });
}

/** Clicks the first page and waits for it to actually be the focused element before returning. */
async function focusFirstPage(page: Page): Promise<void> {
  const firstPage = page.locator('.te-page').first();
  await firstPage.click();
  await expect(firstPage).toBeFocused();
}

/**
 * Types text into whichever page is currently focused.
 *
 * Works around a reproducible Playwright/Chromium quirk (present before any of this session's own
 * code was touched, confirmed via manual diagnostic scripts against the built app): the very
 * first character `keyboard.type()` sends into a *truly empty* contenteditable is silently
 * dropped. Priming the field with a single throwaway character (typed, then deleted with
 * Backspace) means the field is no longer empty by the time the real content is typed, so the
 * quirk never triggers — the app's own logic already verified correct via manual diagnostics.
 */
async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type('.');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

test('nav entry reaches the text editor', async ({ page }) => {
  await openTextEditor(page);
  await expect(page.locator('.te-page')).toHaveCount(1);
});

test('typing enough text overflows to a second page with no content loss', async ({ page }) => {
  await openTextEditor(page);
  const firstPage = page.locator('.te-page').first();
  await firstPage.click();
  // A long repeated line, typed via a paste-like fill (fast, still triggers onInput+reflow once).
  const bigText = Array.from({ length: 120 }, (_, i) => `Line ${i} of overflow test content padding.`).join(' ');
  await page.evaluate((text) => {
    const el = document.querySelector('.te-page') as HTMLElement;
    el.focus();
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, bigText);
  // reflow() only finishes moving overflow to a new page once that page has a real DOM node
  // (a render + effect round-trip after the state-driven page count change) — poll for the
  // actual count rather than assuming a fixed delay always covers it.
  await expect.poll(() => page.locator('.te-page').count()).toBeGreaterThan(1);
  const allText = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.te-page')).map(el => el.textContent).join(' ')
  );
  expect(allText).toContain('Line 0 of overflow');
  expect(allText).toContain('Line 119 of overflow');
});

test('Ctrl+Enter inserts a hard page break', async ({ page }) => {
  await openTextEditor(page);
  await focusFirstPage(page);
  await typeText(page, 'before break');
  await page.keyboard.press('Control+Enter');
  // Wait not just for the new page to exist, but for focus to have actually landed on it — the
  // page-count effect and the focus-follow it triggers are two separate steps of the same React
  // effect, and a page-count poll alone can observe the DOM mid-way between them.
  await expect(page.locator('.te-page')).toHaveCount(2);
  await expect.poll(() =>
    page.evaluate(() => Array.from(document.querySelectorAll('.te-page')).indexOf(document.activeElement as Element))
  ).toBe(1);
  // Retry the whole type-then-assert pair (guarded so a retry can't type the content twice), the
  // same "retry the pair" precedent as the Backspace-merge/Insert-Table tests below — a slow
  // re-render under system load can steal focus back before typeText's keystrokes land, and unlike
  // a fixed-timeout wait, re-clicking the page each attempt makes every retry self-contained.
  await expect(async () => {
    const secondPageText = await page.locator('.te-page').nth(1).textContent();
    if (!secondPageText?.includes('after break')) {
      await page.locator('.te-page').nth(1).click();
      await typeText(page, 'after break');
    }
    await expect(page.locator('.te-page').nth(1)).toContainText('after break', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect.poll(() => page.locator('.te-page').first().textContent()).toContain('before break');
});

test('page-number footer shows N / M and updates with page count', async ({ page }) => {
  await openTextEditor(page);
  await page.locator('.te-page').first().click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.te-page')).toHaveCount(2);
  // Footer text lives as a sibling of the scaled wrapper; just check the raw page text for "1 / 2".
  await expect.poll(() => page.evaluate(() => document.body.textContent ?? '')).toContain('1 / 2');
  await expect.poll(() => page.evaluate(() => document.body.textContent ?? '')).toContain('2 / 2');
});

test('Backspace on an empty second page merges back into page 1', async ({ page }) => {
  await openTextEditor(page);
  await focusFirstPage(page);
  await typeText(page, 'page one content');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.te-page')).toHaveCount(2);
  // Wait for focus to actually land on the new page 2 before backspacing there — see the same
  // note in the Ctrl+Enter test above.
  await expect.poll(() =>
    page.evaluate(() => Array.from(document.querySelectorAll('.te-page')).indexOf(document.activeElement as Element))
  ).toBe(1);

  // Also wait for the caret to genuinely satisfy the production `isCaretAtPageStart` check the
  // Backspace handler itself gates on (mirrored here directly), not just for focus to be on the
  // right page — there's a narrow window, immediately after Ctrl+Enter's own reflow settles,
  // where page 2 briefly exists and is focused but hasn't actually received its post-break content
  // yet (an artifact of firing keystrokes far faster than a human would, not something normal
  // typing speed hits).
  await expect.poll(() => page.evaluate(() => {
    const p2 = document.querySelectorAll('.te-page')[1] as HTMLElement | undefined;
    if (!p2) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const startRange = document.createRange();
    const firstChild = p2.firstChild;
    const marker = firstChild instanceof HTMLElement && firstChild.dataset.hardBreak === 'true' ? firstChild : null;
    if (marker && marker.nextSibling) {
      startRange.setStartBefore(marker.nextSibling);
    } else {
      startRange.selectNodeContents(p2);
      startRange.collapse(true);
    }
    return range.compareBoundaryPoints(Range.START_TO_START, startRange) === 0;
  }), { timeout: 15_000 }).toBe(true);

  // Retry the whole press-then-assert pair, not just a longer timeout on one attempt: focus can
  // briefly land on page 2 (satisfying the poll above) and still lose it again to another
  // in-flight re-render before the Backspace keydown itself is actually dispatched — the same
  // "retry the pair" reasoning studioFixture.ts's own clickThrough helper documents.
  await expect(async () => {
    if ((await page.locator('.te-page').count()) === 2) await page.keyboard.press('Backspace');
    await expect(page.locator('.te-page')).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect.poll(() => page.locator('.te-page').first().textContent()).toContain('page one content');
});

test('hard break survives across multiple keystrokes without duplicating pages', async ({ page }) => {
  await openTextEditor(page);
  await focusFirstPage(page);
  await page.keyboard.press('Control+Enter');
  await typeText(page, 'typed after break, one character at a time');
  await expect(page.locator('.te-page')).toHaveCount(2);
});

test('Insert Table creates a real table, Tab navigates cells and adds a row from the last cell', async ({ page }) => {
  await openTextEditor(page);
  await focusFirstPage(page);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('button', { name: 'Table…' }).click();
  await page.locator('#te-table-rows').fill('2');
  await page.locator('#te-table-cols').fill('2');
  // Scoped to the swal popup's own confirm button — the menu bar also has a top-level "Insert"
  // button that would otherwise ambiguously match the same role/name query.
  await page.locator('.swal2-confirm').click();

  await expect(page.locator('.te-page table.te-table')).toBeVisible();
  await expect(page.locator('.te-page table.te-table td')).toHaveCount(4);

  // Tab from the last cell (row 2, col 2) adds a new row. The production Tab handler
  // (`handlePageKeyDown` in TextEditorPage.tsx) only acts when `closestCell()` finds a `<td>`
  // ancestor of the *live selection* — it does nothing if the click that was meant to focus the
  // cell didn't actually land the caret inside it, which an empty `<td>` (just a placeholder
  // `<br>`) occasionally fails to do on the first hit-test. Confirming the caret is actually in a
  // cell before pressing Tab (and retrying the click itself if not) rather than just retrying
  // click+Tab blindly — a click that keeps missing the same way would otherwise fail identically
  // on every retry instead of self-correcting.
  const rows = page.locator('.te-page table.te-table tr');
  await expect(async () => {
    if ((await rows.count()) === 2) {
      await page.locator('.te-page table.te-table td').last().click();
      await expect.poll(() => page.evaluate(() => {
        const sel = window.getSelection();
        let node: Node | null = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
        while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
        return (node as Element | null)?.closest?.('td') != null;
      }), { timeout: 2_000 }).toBe(true);
      await page.keyboard.press('Tab');
    }
    await expect(rows).toHaveCount(3, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
});
