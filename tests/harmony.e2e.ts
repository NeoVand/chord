import { test, expect, type Page } from '@playwright/test';

const harmonicCanvas = (page: Page) => page.locator('canvas[aria-label^="Interactive harmonic"]');
async function open(page: Page) {
	await page.goto('/');
	await expect(harmonicCanvas(page)).toHaveAttribute('data-sample-source', 'preview', { timeout: 20_000 });
	const volume = page.getByRole('slider', { name: 'Volume', exact: true });
	if (await volume.isVisible()) await volume.fill('0');
}

test('measured harmonics, live tuning and a frozen selection stay coherent across workspaces', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('GPUValidationError')) errors.push(message.text()); });
	await open(page);
	await page.getByRole('button', { name: 'Synth', exact: true }).click();
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: 'Play this chord', exact: true }).click();
	await expect(harmonicCanvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(harmonicCanvas(page)).toHaveAttribute('data-partial-count', '3');
	await page.getByRole('button', { name: 'Instrument', exact: true }).click();
	await expect(harmonicCanvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect.poll(async () => Number(await harmonicCanvas(page).getAttribute('data-partial-count'))).toBeGreaterThan(3);
	await page.getByRole('slider', { name: 'Tune E3', exact: true }).fill('-13.7');
	await expect(page.locator('.source-state')).toHaveText(/Measured spectrum/);
	await expect(page.locator('.note-chips')).toContainText('163.5 Hz');
	await page.getByRole('tab', { name: 'Tuning', exact: true }).click();
	await expect(page.getByRole('slider', { name: 'Tune E3', exact: true })).toHaveValue('-13.7');
	await expect(harmonicCanvas(page)).toHaveAttribute('data-surface-revision', /[1-9]/);
	await page.getByRole('button', { name: 'Freeze', exact: true }).click();
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	const scope = page.locator('.scope-canvas');
	await expect(scope).toHaveAttribute('data-sample-source', 'captured');
	await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
	const peaks = (await scope.getAttribute('data-axis-peaks'))!.split(',').map(Number);
	expect(peaks).toHaveLength(3); expect(Math.min(...peaks)).toBeGreaterThan(.001);
	await page.getByRole('button', { name: '2D', exact: true }).click();
	await page.getByRole('tab', { name: 'Overtones', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await expect(page.locator('.note-chips')).toContainText('E3');
	await expect(page.getByRole('button', { name: 'Replay selection', exact: true })).toBeVisible();
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
	expect(errors).toEqual([]);
});

test('the terrain edits real cents offsets and exposes equal and just references without autoplay', async ({ page }) => {
	await open(page);
	await page.getByRole('tab', { name: 'Tuning', exact: true }).click();
	await expect(harmonicCanvas(page)).toHaveAttribute('data-surface-revision', /[1-9]/);
	await page.getByRole('button', { name: 'Just', exact: true }).click();
	expect(Number(await page.getByRole('slider', { name: 'Tune E3', exact: true }).inputValue())).toBeCloseTo(-13.7, 0);
	expect(Number(await page.getByRole('slider', { name: 'Tune G3', exact: true }).inputValue())).toBeCloseTo(2, 0);
	const box = (await harmonicCanvas(page).boundingBox())!;
	await page.mouse.move(box.x + box.width * .5, box.y + box.height * .52);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * .57, box.y + box.height * .55, { steps: 6 });
	await page.mouse.up();
	const cents = Number(await page.getByRole('slider', { name: 'Tune E3', exact: true }).inputValue());
	expect(Math.abs(cents + 13.7)).toBeGreaterThan(.5);
	expect(Math.abs(cents)).toBeLessThanOrEqual(50);
	await expect(page.getByRole('button', { name: 'Stop all sound', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Equal', exact: true }).click();
	await expect(page.getByRole('slider', { name: 'Tune E3', exact: true })).toHaveValue('0');
	await expect(page.getByRole('slider', { name: 'Tune G3', exact: true })).toHaveValue('0');
});

test('Tonnetz transformations preserve common voices and the editable progression cancels on manual input', async ({ page }) => {
	await open(page);
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await page.getByRole('button', { name: /^Parallel/ }).click();
	await expect(page.getByRole('heading', { name: 'C minor', exact: true })).toBeVisible();
	await expect(page.getByText('2 shared notes', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Progression step 3: F', exact: true }).click();
	await page.getByRole('button', { name: /^Parallel/ }).click();
	await page.getByRole('button', { name: 'Use current chord in step 3', exact: true }).click();
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Progression step 3: Fm', exact: true })).toBeVisible();
	await page.getByRole('spinbutton', { name: 'Progression tempo', exact: true }).fill('200');
	await page.getByRole('spinbutton', { name: 'Progression tempo', exact: true }).press('Tab');
	await page.getByRole('button', { name: 'Play progression', exact: true }).click();
	await page.getByRole('tab', { name: 'Overtones', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'F minor', exact: true })).toBeVisible({ timeout: 7000 });
	await page.getByRole('group', { name: /Circle of fifths/ }).getByRole('button', { name: 'Play D major', exact: true }).click();
	await page.waitForTimeout(1600);
	await expect(page.getByRole('heading', { name: 'D major', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Play progression', exact: true })).toBeVisible();
});

test('mobile and tablet layouts keep tuning and chord tools reachable without horizontal overflow', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await open(page);
	for (const width of [390, 320, 900]) {
		await page.setViewportSize({ width, height: 844 });
		for (const name of ['Tuning', 'Chords', 'Overtones']) {
			await page.getByRole('tab', { name, exact: true }).click();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
			if (name === 'Chords') await expect(page.getByRole('button', { name: 'Play progression', exact: true })).toBeVisible();
			else { const slider = page.getByRole('slider', { name: 'Tune G3', exact: true }); await slider.fill('10'); await expect(slider).toHaveValue('10'); }
		}
	}
});

test('WebGL fallback preserves the harmonic canvas and respects reduced motion', async ({ page }) => {
	await page.addInitScript(() => { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await open(page);
	await expect(page.getByText('WebGL fallback', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
	const original = await harmonicCanvas(page).elementHandle();
	await page.getByRole('tab', { name: 'Tuning', exact: true }).click();
	await expect(harmonicCanvas(page)).toHaveAttribute('data-surface-revision', /[1-9]/);
	await page.getByRole('tab', { name: 'Chords', exact: true }).click();
	await page.getByRole('tab', { name: 'Scope', exact: true }).click();
	await page.getByRole('tab', { name: 'Overtones', exact: true }).click();
	expect(await harmonicCanvas(page).evaluate((canvas, previous) => canvas === previous, original)).toBe(true);
	await page.getByRole('button', { name: 'Resume', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Freeze', exact: true })).toHaveAttribute('aria-pressed', 'false');
	expect(errors).toEqual([]);
});
