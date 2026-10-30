import { test, expect, type Page } from '@playwright/test';

const harmonic = (page: Page) => page.locator('canvas[aria-label^="Interactive harmonic"]');
const scope = (page: Page) => page.locator('.scope-canvas');
async function open(page: Page) {
	await page.goto('/');
	await expect(harmonic(page)).toHaveAttribute('data-sample-source', 'preview');
	await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0');
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
}

test('Scope and Overtones share the same frozen time, capture and recapture', async ({ page }) => {
	await open(page);
	await page.getByRole('button', { name: 'Play this chord', exact: true }).click();
	await expect(harmonic(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.getByRole('button', { name: 'Follow sound', exact: true }).click();
	await page.getByRole('button', { name: 'Freeze', exact: true }).click();
	const time = await harmonic(page).getAttribute('data-visual-frame');
	const revision = await harmonic(page).getAttribute('data-capture-revision');
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await expect(scope(page)).toHaveAttribute('data-capture-revision', revision!);
	await expect(scope(page)).toHaveAttribute('data-visual-frame', time!);
	await page.getByRole('button', { name: 'Recapture', exact: true }).click();
	await expect.poll(async () => Number(await scope(page).getAttribute('data-capture-revision'))).toBeGreaterThan(Number(revision));
	const next = await scope(page).getAttribute('data-capture-revision');
	await page.getByRole('tab', { name: 'Overtones', exact: true }).click();
	await expect(harmonic(page)).toHaveAttribute('data-capture-revision', next!);
	await expect(harmonic(page)).toHaveAttribute('data-visual-frame', time!);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('Scope can inspect a different note pair, retune it, and replay the retained selection', async ({ page }) => {
	await open(page);
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	// Physical-key identities must survive Replay just like chord-pad identities.
	await page.keyboard.press('a'); await page.keyboard.press('d'); await page.keyboard.press('g');
	await expect(scope(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.getByRole('button', { name: '2D', exact: true }).click();
	const y = page.getByRole('combobox', { name: 'Y axis note', exact: true });
	const fifth = await y.getByRole('option', { name: /^G3/ }).getAttribute('value');
	await y.selectOption(fifth!);
	await expect.poll(async () => (await scope(page).getAttribute('data-axis-ids'))!.split(',')[1]).toBe(fifth);
	const axes = await scope(page).getAttribute('data-axis-ids');
	await page.getByRole('slider', { name: 'Tune G3', exact: true }).fill('12');
	await expect(scope(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(scope(page)).toHaveAttribute('data-axis-ids', axes!);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await page.getByRole('button', { name: 'Replay selection', exact: true }).click();
	await expect(page.getByRole('slider', { name: 'Tune G3', exact: true })).toHaveValue('12');
	await expect(scope(page)).toHaveAttribute('data-axis-ids', axes!);
	await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('an unlatched progression owns its timing across workspace changes', async ({ page }) => {
	await open(page);
	await page.getByRole('button', { name: 'Latch', exact: true }).click();
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await page.getByRole('spinbutton', { name: 'Progression tempo', exact: true }).fill('100');
	await page.getByRole('spinbutton', { name: 'Progression tempo', exact: true }).press('Tab');
	await page.getByRole('button', { name: 'Play progression', exact: true }).click();
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'A minor', exact: true })).toBeVisible({ timeout: 7000 });
	await expect(page.getByRole('heading', { name: 'F major', exact: true })).toBeVisible({ timeout: 7000 });
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Play progression', exact: true })).toBeVisible();
});

test('Scope inspector stays reachable on small screens and Stop retains notes acquired in another view', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 780 });
	await open(page);
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	const y = page.getByRole('combobox', { name: 'Y axis note', exact: true });
	await y.scrollIntoViewIfNeeded(); await expect(y).toBeVisible();
	await page.getByRole('slider', { name: 'Tune G3', exact: true }).fill('5');
	await expect(page.getByRole('slider', { name: 'Tune G3', exact: true })).toHaveValue('5');
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	// Never visit Scope during acquisition. Inspection is independent of its draw loop.
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await page.getByRole('button', { name: /^Parallel/ }).click();
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'C minor', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Replay selection', exact: true })).toBeVisible();
});

test('computer notes work after clicking workspace controls while form and keyboard focus stay protected', async ({ page }) => {
	await open(page);
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await page.keyboard.press('a');
	const c = page.getByRole('button', { name: 'C3', exact: true });
	await expect(c).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: '3D', exact: true }).click();
	await page.keyboard.press('d');
	await expect(page.getByRole('button', { name: 'E3', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('slider', { name: 'Tune E3', exact: true }).focus();
	await page.keyboard.press('a');
	await expect(c).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Freeze', exact: true }).focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('a');
	await expect(c).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await page.keyboard.press('a');
	await expect(c).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});
