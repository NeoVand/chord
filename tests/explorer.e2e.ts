import { test, expect, type Page } from '@playwright/test';

const canvas = (page: Page) => page.locator('canvas[aria-label*="visualization"]').first();
async function load(page: Page, followSound = false) {
	await page.goto('/');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'preview', { timeout: 20_000 });
	const volume = page.getByRole('slider', { name: 'Volume', exact: true });
	if (await volume.isVisible()) await volume.fill('0');
	if (!followSound) await page.getByRole('button', { name: 'Follow sound', exact: true }).click();
}
async function visualFrame(page: Page) {
	return Number(await canvas(page).getAttribute('data-visual-frame'));
}

/** Finite piano-like decays make silence/re-articulation checks deterministic. */
async function sampledFixture(page: Page, seconds = 1) {
	const notes = [['C3', 48], ['E3', 52], ['G3', 55]] as const;
	const samples = notes.map(([name, midi]) => {
		const rate = 48000, length = rate * seconds, data = Buffer.alloc(44 + length * 2);
		data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
		data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
		data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
		data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(length * 2, 40);
		const frequency = 440 * 2 ** ((midi - 69) / 12);
		for (let i = 0; i < length; i++) {
			const phase = 2 * Math.PI * frequency * i / rate;
			data.writeInt16LE(Math.round(5000 * Math.exp(-3 * i / length) * (Math.sin(phase) + .25 * Math.sin(3 * phase))), 44 + i * 2);
		}
		return `"${name}":"data:audio/wav;base64,${data.toString('base64')}"`;
	});
	await page.route(/^https:\/\/.*\.js(?:\?.*)?$/, (route) => route.fulfill({
		status: 200, contentType: 'application/javascript', body: `MIDI.Soundfont.test = {\n${samples.join(',\n')},\n};`
	}));
}

test('Follow sound stops on a natural piano decay and mute, while Free run can inspect silence', async ({ page }) => {
	await sampledFixture(page, 3);
	await load(page, true);
	const follow = page.getByRole('button', { name: 'Follow sound', exact: true });
	await expect(follow).toHaveAttribute('aria-pressed', 'true');
	await expect(canvas(page)).toHaveAttribute('data-motion-state', 'silent');
	const preview = await visualFrame(page);
	await page.waitForTimeout(150);
	expect(await visualFrame(page)).toBe(preview);
	await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0.65');
	// Observe the entire attack/decay, including frames between Playwright calls.
	const observed = page.evaluate((initialFrame) => new Promise<{ peak: number; moved: boolean; ended: boolean }>((resolve) => {
		const plot = document.querySelector<HTMLCanvasElement>('canvas[aria-label*="visualization"]')!;
		const start = performance.now();
		let peak = 0, moved = false, heard = false;
		function inspect() {
			peak = Math.max(peak, Number(plot.dataset.signalActivity));
			moved ||= Number(plot.dataset.visualFrame) > initialFrame;
			heard ||= plot.dataset.motionState === 'following';
			const ended = heard && plot.dataset.motionState === 'silent';
			if (ended || performance.now() - start > 12_000) resolve({ peak, moved, ended });
			else requestAnimationFrame(inspect);
		}
		requestAnimationFrame(inspect);
	}), preview);
	await page.getByRole('button', { name: /Play this chord/ }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	const playback = await observed;
	expect(playback.peak).toBeGreaterThan(.1);
	expect(playback.moved).toBe(true);
	expect(playback.ended).toBe(true);
	await expect(canvas(page)).toHaveAttribute('data-motion-state', 'silent');
	await expect(page.getByRole('button', { name: 'C3', exact: true })).toHaveAttribute('aria-pressed', 'true');
	const stopped = await visualFrame(page);
	const geometry = await canvas(page).getAttribute('data-geometry-revision');
	await page.waitForTimeout(200);
	expect(await visualFrame(page)).toBe(stopped);
	await expect(canvas(page)).toHaveAttribute('data-geometry-revision', geometry!);
	await follow.click();
	await expect(follow).toHaveText('Free run');
	await expect(canvas(page)).toHaveAttribute('data-motion-state', 'free');
	await expect.poll(() => visualFrame(page)).toBeGreaterThan(stopped);
	await follow.click();
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-motion-state', 'following');
	await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0');
	await expect(canvas(page)).toHaveAttribute('data-motion-state', 'silent');
	await expect.poll(async () => Number(await canvas(page).getAttribute('data-signal-activity'))).toBe(0);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('manually editing a latched sampled chord captures fresh audio for every selected axis', async ({ page }) => {
	await sampledFixture(page);
	await load(page);
	await canvas(page).click({ position: { x: 15, y: 100 } });
	const peaks = async () => (await canvas(page).getAttribute('data-axis-peaks'))!.split(',').map(Number);
	await page.keyboard.press('a');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.waitForTimeout(1300);
	await page.keyboard.press('d');
	await expect.poll(async () => (await peaks()).length).toBe(2);
	await expect.poll(async () => Math.min(...await peaks())).toBeGreaterThan(.01);
	await page.waitForTimeout(1300);
	await page.keyboard.press('g');
	await expect.poll(async () => (await peaks()).length).toBe(3);
	await expect.poll(async () => Math.min(...await peaks())).toBeGreaterThan(.01);
	await expect.poll(async () => Number(await canvas(page).getAttribute('data-render-segments'))).toBeGreaterThan(500);
	await page.getByRole('button', { name: '2D', exact: true }).click();
	await page.waitForTimeout(1300);
	await canvas(page).click({ position: { x: 15, y: 100 } });
	await page.keyboard.press('g');
	await expect.poll(async () => (await peaks()).length).toBe(2);
	await expect.poll(async () => Math.min(...await peaks())).toBeGreaterThan(.01);
	await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: 'Instrument', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect.poll(async () => Math.min(...await peaks())).toBeGreaterThan(.01);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('opens silently, plays real captured tones, freezes and changes visual speed', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await load(page);
	await expect(page.getByText(/Silent.*preview/, { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: /Play this chord/ }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect.poll(async () => Number(await canvas(page).getAttribute('data-signal-peak'))).toBeGreaterThan(.02);
	await page.getByRole('button', { name: 'Freeze', exact: true }).click();
	const frozen = await visualFrame(page);
	await page.waitForTimeout(250);
	expect(await visualFrame(page)).toBe(frozen);
	await page.getByRole('button', { name: /Resume/ }).click();
	await page.getByRole('slider', { name: 'Sweep speed', exact: true }).fill('0.01');
	const slowStart = await visualFrame(page);
	await page.waitForTimeout(250);
	const slowDelta = (await visualFrame(page)) - slowStart;
	await page.getByRole('slider', { name: 'Sweep speed', exact: true }).fill('0.5');
	const fastStart = await visualFrame(page);
	await page.waitForTimeout(250);
	expect((await visualFrame(page)) - fastStart).toBeGreaterThan(slowDelta * 3);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(page.getByText('Sound stopped · Last capture', { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test('the complete curve stays fixed through sweeps, tail changes and deep zoom', async ({ page }) => {
	await load(page);
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: /Play this chord/ }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(canvas(page)).toHaveAttribute('data-source-points', '131072');
	const geometry = await canvas(page).getAttribute('data-geometry-revision');
	const segments = Number(await canvas(page).getAttribute('data-render-segments'));
	const before = await visualFrame(page);
	await page.getByRole('slider', { name: 'Tail length', exact: true }).fill('0.3');
	await page.waitForTimeout(300);
	expect(await visualFrame(page)).toBeGreaterThan(before);
	await expect(canvas(page)).toHaveAttribute('data-geometry-revision', geometry!);
	for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await expect.poll(async () => Number(await canvas(page).getAttribute('data-zoom'))).toBeGreaterThan(9);
	expect(Number(await canvas(page).getAttribute('data-render-segments'))).toBeGreaterThan(segments);
	await expect(canvas(page)).toHaveAttribute('data-geometry-revision', geometry!);
	const zoom = await canvas(page).getAttribute('data-zoom');
	const wedge = page.getByRole('button', { name: 'Play G major', exact: true });
	await wedge.click();
	expect(await wedge.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(canvas(page)).toHaveAttribute('data-zoom', zoom!);
	await page.getByRole('button', { name: '2D', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-zoom', '1.000');
	await page.getByRole('button', { name: '3D', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-zoom', zoom!);
	await page.getByRole('button', { name: 'Reset rotation', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-zoom', zoom!);
	await page.getByRole('button', { name: 'Fit curve', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-zoom', '1.000');
	await page.getByRole('button', { name: 'Waveform', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-source-points', '32768');
	const waveGeometry = await canvas(page).getAttribute('data-geometry-revision');
	await page.getByRole('slider', { name: 'Sweep speed', exact: true }).fill('0.005');
	await expect(page.getByText('200s', { exact: false }).first()).toBeVisible();
	await page.waitForTimeout(300);
	await expect(canvas(page)).toHaveAttribute('data-geometry-revision', waveGeometry!);
	await page.getByRole('button', { name: 'Freeze', exact: true }).click();
	const stopped = await visualFrame(page);
	await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-zoom', '1.250');
	await page.waitForTimeout(250);
	expect(await visualFrame(page)).toBe(stopped);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('an instrument capture holds until explicitly recaptured', async ({ page }) => {
	await load(page);
	await page.getByRole('button', { name: 'Synth', exact: true }).click();
	await page.getByRole('button', { name: /Play this chord/ }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	const revision = await canvas(page).getAttribute('data-capture-revision');
	await page.waitForTimeout(300);
	await expect(canvas(page)).toHaveAttribute('data-capture-revision', revision!);
	await page.getByRole('button', { name: 'Recapture', exact: true }).click();
	await expect.poll(async () => Number(await canvas(page).getAttribute('data-capture-revision'))).toBeGreaterThan(Number(revision));
	const geometry = await canvas(page).getAttribute('data-geometry-revision');
	await page.waitForTimeout(300);
	await expect(canvas(page)).toHaveAttribute('data-geometry-revision', geometry!);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('wheel, intervals, instrument search and keyboard share a consistent selection', async ({ page }) => {
	await load(page);
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: 'Play G major', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'G major', exact: true })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Key', exact: true })).toHaveValue('7');
	await page.getByRole('button', { name: 'Intervals', exact: true }).click();
	await page.getByRole('button', { name: /Perfect fifth/ }).click();
	await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: '2D', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await page.getByRole('button', { name: 'Instrument', exact: true }).click();
	await page.getByRole('button', { name: 'Choose instrument', exact: true }).click();
	await page.getByRole('searchbox', { name: 'Search instruments' }).fill('piano');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'idle');
	await page.getByRole('button', { name: '005 Electric Piano 1', exact: true }).click();
	await page.getByRole('button', { name: 'Synth', exact: true }).click();
	await canvas(page).click({ position: { x: 15, y: 100 } });
	await page.keyboard.press('a');
	await expect(page.getByRole('button', { name: 'C3', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await expect(page.getByRole('button', { name: 'C3', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.keyboard.press('Control+.');
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(page.getByText('Sound stopped · Last capture', { exact: true })).toBeVisible();
	const wedge = page.getByRole('group', { name: /Circle of fifths/ }).getByRole('button', { name: 'Play G major', exact: true });
	await wedge.click();
	await page.keyboard.press('a');
	await expect(page.getByRole('button', { name: 'C3', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await wedge.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('a');
	await expect(page.getByRole('button', { name: 'C3', exact: true })).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('mini scopes visibly animate, freeze with the main plot, and stay paused across view changes', async ({ page }) => {
	await load(page);
	const mini = page.locator('canvas.signal-traces');
	const hash = () => mini.evaluate((canvas: HTMLCanvasElement) => {
		const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
		let value = 0;
		for (let i = 0; i < data.length; i += 4) value = (Math.imul(value, 31) + data[i] + data[i + 3]) | 0;
		return value;
	});
	const initial = await hash();
	await expect.poll(hash).not.toBe(initial);
	await page.getByRole('button', { name: 'Freeze', exact: true }).click();
	await page.waitForTimeout(80);
	const paused = await hash();
	await page.waitForTimeout(250);
	expect(await hash()).toBe(paused);
	await page.getByRole('button', { name: 'Waveform', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
	const frame = await visualFrame(page);
	await page.waitForTimeout(250);
	expect(await visualFrame(page)).toBe(frame);
	await page.getByRole('button', { name: 'Resume', exact: true }).click();
	const resumed = await hash();
	await expect.poll(hash).not.toBe(resumed);
});

test('view selection persists through circle, interval, keyboard and release interactions', async ({ page }) => {
	await load(page);
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	for (const view of ['Waveform', '2D']) {
		const tab = page.getByRole('button', { name: view, exact: true });
		await tab.click();
		await page.getByRole('group', { name: /Circle of fifths/ }).getByRole('button', { name: 'Play D major', exact: true }).click();
		await expect(tab).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Chords', exact: true }).click();
		await page.getByRole('button', { name: 'Play Bm chord', exact: true }).click();
		await expect(tab).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Intervals', exact: true }).click();
		await page.getByRole('button', { name: /Perfect fifth/ }).click();
		await expect(tab).toHaveAttribute('aria-pressed', 'true');
		await canvas(page).click({ position: { x: 15, y: 100 } });
		await page.keyboard.press('a');
		await expect(tab).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
		await expect(tab).toHaveAttribute('aria-pressed', 'true');
	}
	await page.getByRole('button', { name: '3D', exact: true }).click();
	await page.getByRole('button', { name: 'Play G major', exact: true }).click();
	await page.getByRole('button', { name: 'Latch', exact: true }).click();
	await canvas(page).click({ position: { x: 15, y: 100 } });
	await page.keyboard.down('a');
	await page.keyboard.up('a');
	await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
	const stop = page.getByRole('button', { name: 'Stop all sound', exact: true });
	if (await stop.isEnabled()) await stop.click();
});

test('Freeze remains explicit while choosing new chords and comparing signal modes', async ({ page }) => {
	await load(page);
	await page.getByRole('button', { name: 'Synth', exact: true }).click();
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: 'Freeze', exact: true }).click();
	const frame = await visualFrame(page);
	await page.getByRole('group', { name: /Circle of fifths/ }).getByRole('button', { name: 'Play G major', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
	expect(await visualFrame(page)).toBe(frame);
	await page.getByRole('button', { name: 'Instrument', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.waitForTimeout(150);
	expect(await visualFrame(page)).toBe(frame);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await expect(page.getByText('Sound stopped · Last capture', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'idle');
	await expect(page.getByText('Ready to play', { exact: true })).toBeVisible();
	await page.getByRole('group', { name: /Circle of fifths/ }).getByRole('button', { name: 'Play D major', exact: true }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	expect(await visualFrame(page)).toBe(frame);
	await page.getByRole('button', { name: 'Resume', exact: true }).click();
	await expect.poll(() => visualFrame(page)).toBeGreaterThan(frame);
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
});

test('the mobile layout stays within the viewport and can play a chord', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await load(page);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
	await page.getByRole('button', { name: 'Pure tones', exact: true }).click();
	await page.getByRole('button', { name: /Play this chord/ }).click();
	await expect(canvas(page)).toHaveAttribute('data-sample-source', 'captured');
	await page.getByRole('button', { name: 'Stop all sound', exact: true }).click();
	await page.setViewportSize({ width: 320, height: 780 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	const targets = await page.locator('.camera-controls button').evaluateAll((buttons) => buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
	expect(targets.every((size) => size.width >= 40 && size.height >= 40)).toBe(true);
});
