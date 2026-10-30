import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { synthVoice } from './voice';
import { sampleVoice } from './sample-voice';
import { presetForProgram } from './presets';
import { ChordAudio } from './chord-audio';
import type { SignalChunk } from '../types';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function gesture(action: () => Promise<void>) {
	const button = document.createElement('button');
	button.textContent = 'Start test audio';
	let pending: Promise<void> | undefined;
	button.onclick = () => { pending = action(); };
	document.body.append(button);
	try {
		await page.getByRole('button', { name: 'Start test audio' }).click();
		await pending;
	} finally { button.remove(); }
}

/** Project the recorded audio onto a frequency; avoids a dependency on FFT code. */
function amplitude(samples: Float32Array, frequency: number, sampleRate = 48000) {
	let real = 0, imaginary = 0;
	for (let i = 0; i < samples.length; i++) {
		const phase = 2 * Math.PI * frequency * i / sampleRate;
		real += samples[i] * Math.cos(phase);
		imaginary += samples[i] * Math.sin(phase);
	}
	return Math.hypot(real, imaginary) / samples.length;
}

function sampleWav(frequency: number, thirdHarmonic: number) {
	const rate = 48000, length = rate;
	const bytes = new Uint8Array(44 + length * 2);
	const view = new DataView(bytes.buffer);
	const text = (at: number, value: string) => [...value].forEach((letter, i) => { bytes[at + i] = letter.charCodeAt(0); });
	text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
	view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
	for (let i = 0; i < length; i++) {
		const phase = 2 * Math.PI * frequency * i / rate;
		view.setInt16(44 + i * 2, Math.round(4000 * (Math.sin(phase) + thirdHarmonic * Math.sin(phase * 3))), true);
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return 'data:audio/wav;base64,' + btoa(binary);
}

describe('actual audio voices', () => {
	it('glides existing oscillator and sampled voices without restarting their audio clock', async () => {
		const context = new OfflineAudioContext(2, 48000, 48000);
		const merger = context.createChannelMerger(2); merger.connect(context.destination);
		const pure = context.createGain(), recorded = context.createGain();
		pure.connect(merger, 0, 0); recorded.connect(merger, 0, 1);
		const buffer = context.createBuffer(1, 48000, 48000);
		for (let i = 0; i < 48000; i++) buffer.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 440 * i / 48000);
		const first = synthVoice(context, pure, 440, 100, 0, presetForProgram(16), null, true);
		const second = sampleVoice(context, recorded, { buffers: new Map([['a', buffer]]), preset: {
			samples: { baseUrl: '', formats: [] }, groups: [{ regions: [{ sample: 'a', keyRange: [0, 127], pitch: 69, loop: true }] }]
		} }, 69, 440, 100, 0);
		first.retune(466.16, .4); second.retune(466.16, .4);
		const rendered = await context.startRendering();
		for (let channel = 0; channel < 2; channel++) {
			const samples = rendered.getChannelData(channel);
			const before = samples.slice(4800, 14400), after = samples.slice(28800, 43200);
			expect(amplitude(before, 440)).toBeGreaterThan(.04);
			expect(amplitude(after, 466.16) / amplitude(after, 440)).toBeGreaterThan(10);
		}
	});
	it('pure mode sounds as a sine while instrument mode retains its harmonics', async () => {
		const context = new OfflineAudioContext(2, 48000, 48000);
		const merger = context.createChannelMerger(2);
		merger.connect(context.destination);
		const pure = context.createGain();
		const instrument = context.createGain();
		pure.connect(merger, 0, 0); instrument.connect(merger, 0, 1);
		synthVoice(context, pure, 440, 100, 0, presetForProgram(16), null, true);
		synthVoice(context, instrument, 440, 100, 0, presetForProgram(16), null);
		const rendered = await context.startRendering();
		const sine = rendered.getChannelData(0).slice(12000, 36000);
		const organ = rendered.getChannelData(1).slice(12000, 36000);
		expect(amplitude(sine, 440)).toBeGreaterThan(0.04);
		expect(amplitude(sine, 1320) / amplitude(sine, 440)).toBeLessThan(0.001);
		expect(amplitude(organ, 1320) / amplitude(organ, 440)).toBeGreaterThan(0.1);
	});

	it('captures isolated tones, revoices held ids, and clears panic without resurrection', async () => {
		const chunks: SignalChunk[] = [];
		const audio = new ChordAudio({ onChunk: (chunk) => chunks.push(chunk) });
		audio.setSource('pure');
		audio.setVolume(0);
		try {
			await gesture(async () => { await Promise.all([audio.noteOn('root', 69, 100, 440), audio.noteOn('fifth', 76, 100, 660)]); });
			await pause(180);
			const full = chunks.filter((chunk) => chunk.voiceIds.includes('root') && chunk.voiceIds.includes('fifth'));
			expect(full.length).toBeGreaterThan(3);
			const latest = full.at(-1)!;
			const first = latest.channels[latest.voiceIds.indexOf('root')];
			const second = latest.channels[latest.voiceIds.indexOf('fifth')];
			expect(first.some((sample) => Math.abs(sample) > 0.05)).toBe(true);
			expect(first.some((sample, i) => Math.abs(sample - second[i]) > 0.05)).toBe(true);
			audio.setProgram(16);
			audio.setSource('synth');
			await pause(100);
			expect(chunks.at(-1)!.voiceIds.filter(Boolean).sort()).toEqual(['fifth', 'root']);
			audio.allNotesOff();
			await pause(40);
			const afterPanic = chunks.length;
			await pause(80);
			expect(chunks.length).toBe(afterPanic);
		} finally { audio.dispose(); }
	});

	it('does not start a note released while audio initialization is pending', async () => {
		const chunks: SignalChunk[] = [];
		const audio = new ChordAudio({ onChunk: (chunk) => chunks.push(chunk) });
		audio.setSource('pure');
		audio.setVolume(0);
		try {
			await gesture(() => {
				const pending = audio.noteOn('released', 60);
				audio.noteOff('released');
				return pending;
			});
			await pause(100);
			expect(chunks.some((chunk) => chunk.voiceIds.includes('released'))).toBe(false);
		} finally { audio.dispose(); }
	});

	it('decodes a soundfont once and captures sampled notes separately with their harmonics', async () => {
		const originalFetch = globalThis.fetch;
		let downloads = 0;
		const fixture = `MIDI.Soundfont.test = {\n"A4":${JSON.stringify(sampleWav(440, 0.35))},\n"E5":${JSON.stringify(sampleWav(440 * 2 ** (7 / 12), 0))},\n};`;
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
			if (String(input).startsWith('https:')) {
				downloads++;
				return Promise.resolve(new Response(fixture, { status: 200 }));
			}
			return originalFetch(input, init);
		});
		const chunks: SignalChunk[] = [];
		const audio = new ChordAudio({ onChunk: (chunk) => chunks.push(chunk) });
		audio.setVolume(0);
		try {
			await gesture(async () => { await Promise.all([audio.noteOn('sample-a', 69, 100, 440), audio.noteOn('sample-b', 76, 100, 660)]); });
			for (let tries = 0; tries < 100 && audio.status.state !== 'ready'; tries++) await pause(10);
			expect(audio.status.state).toBe('ready');
			chunks.length = 0;
			await pause(240);
			const full = chunks.filter((chunk) => chunk.voiceIds.includes('sample-a') && chunk.voiceIds.includes('sample-b'));
			const gather = (id: string) => Float32Array.from(full.flatMap((chunk) => Array.from(chunk.channels[chunk.voiceIds.indexOf(id)])));
			const a = gather('sample-a'), b = gather('sample-b');
			const rate = audio.context!.sampleRate;
			expect(downloads).toBe(1);
			expect(a.length).toBeGreaterThan(4096);
			expect(amplitude(a, 1320, rate) / amplitude(a, 440, rate)).toBeGreaterThan(0.25);
			expect(amplitude(a, 660, rate) / amplitude(a, 440, rate)).toBeLessThan(0.05);
			expect(amplitude(b, 440, rate) / amplitude(b, 660, rate)).toBeLessThan(0.05);
		} finally { audio.dispose(); fetch.mockRestore(); }
	});

	it('does not resurrect a released or revoiced note when an older sample request finishes', async () => {
		const originalFetch = globalThis.fetch;
		let finishDownload: (response: Response) => void = () => {};
		const delayed = new Promise<Response>((resolve) => { finishDownload = resolve; });
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https:') ? delayed : originalFetch(input, init));
		const chunks: SignalChunk[] = [];
		const audio = new ChordAudio({ onChunk: (chunk) => chunks.push(chunk) });
		audio.setVolume(0);
		try {
			await gesture(async () => { await Promise.all([audio.noteOn('released-sample', 69), audio.noteOn('held-sample', 76)]); });
			audio.noteOff('released-sample');
			audio.setSource('pure');
			const fixture = `MIDI.Soundfont.test = {\n"A4":${JSON.stringify(sampleWav(440, 0.35))},\n};`;
			finishDownload(new Response(fixture, { status: 200 }));
			await pause(150);
			expect(audio.status.message).toBe('Pure sine tones');
			expect(chunks.at(-1)!.voiceIds.filter(Boolean)).toEqual(['held-sample']);
			audio.allNotesOff();
			await pause(40);
			const count = chunks.length;
			await pause(40);
			expect(chunks.length).toBe(count);
		} finally { audio.dispose(); fetch.mockRestore(); }
	});

	it('measures actual output through sample endings, mute, and suspension even while keys remain held', async () => {
		const originalFetch = globalThis.fetch;
		const fixture = `MIDI.Soundfont.test = {\n"A4":${JSON.stringify(sampleWav(440, .3))},\n};`;
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https:')
			? Promise.resolve(new Response(fixture, { status: 200 })) : originalFetch(input, init));
		const audio = new ChordAudio();
		try {
			expect(audio.getOutputLevel()).toBe(0);
			await gesture(async () => {
				await audio.resume();
				// Silence the test's speaker connection after the application's meter.
				const sink = audio.context!.createGain(); sink.gain.value = 0;
				audio.output!.disconnect(); audio.output!.connect(sink).connect(audio.context!.destination);
				await audio.noteOn('held-piano', 69);
			});
			await expect.poll(() => audio.status.state).toBe('ready');
			await expect.poll(() => audio.getOutputLevel()).toBeGreaterThan(.005);
			await expect.poll(() => audio.getOutputLevel(), { timeout: 3000 }).toBeLessThan(.00001);
			// No noteOff was sent: sample completion, not key state, stopped the meter.
			audio.setSource('pure');
			await expect.poll(() => audio.getOutputLevel()).toBeGreaterThan(.005);
			audio.setVolume(0);
			await expect.poll(() => audio.getOutputLevel()).toBeLessThan(.00001);
			audio.setVolume(.65);
			await expect.poll(() => audio.getOutputLevel()).toBeGreaterThan(.005);
			await audio.context!.suspend();
			expect(audio.getOutputLevel()).toBe(0);
		} finally { audio.dispose(); fetch.mockRestore(); }
		expect(audio.getOutputLevel()).toBe(0);
	});

	it('rearticulates decayed latched voices together when adding and removing chord notes', async () => {
		const originalFetch = globalThis.fetch;
		const fixture = `MIDI.Soundfont.test = {\n"A4":${JSON.stringify(sampleWav(440, .3))},\n"E5":${JSON.stringify(sampleWav(440 * 2 ** (7 / 12), .15))},\n};`;
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https:')
			? Promise.resolve(new Response(fixture, { status: 200 })) : originalFetch(input, init));
		const chunks: SignalChunk[] = [];
		const audio = new ChordAudio({ onChunk: (chunk) => chunks.push(chunk) });
		audio.setVolume(0);
		const peak = (id: string) => {
			const chunk = chunks.at(-1)!;
			return chunk.channels[chunk.voiceIds.indexOf(id)]?.reduce((max, value) => Math.max(max, Math.abs(value)), 0) ?? 0;
		};
		try {
			await gesture(() => audio.noteOn('root', 69));
			await expect.poll(() => audio.status.state).toBe('ready');
			await expect.poll(() => peak('root')).toBeGreaterThan(.05);
			await expect.poll(() => peak('root'), { timeout: 3000 }).toBe(0);
			const old = chunks.at(-1)!;
			const oldVersion = old.versions![old.voiceIds.indexOf('root')];
			await audio.noteOn('fifth', 76, 96, undefined, { retriggerHeld: true });
			await expect.poll(() => Math.min(peak('root'), peak('fifth'))).toBeGreaterThan(.05);
			const fresh = chunks.at(-1)!;
			expect(fresh.versions![fresh.voiceIds.indexOf('root')]).toBeGreaterThan(oldVersion);
			await expect.poll(() => Math.max(peak('root'), peak('fifth')), { timeout: 3000 }).toBe(0);
			audio.noteOff('fifth');
			audio.retriggerHeld();
			await expect.poll(() => peak('root')).toBeGreaterThan(.05);
			expect(chunks.at(-1)!.voiceIds.filter(Boolean)).toEqual(['root']);
		} finally { audio.dispose(); fetch.mockRestore(); }
	});
});
