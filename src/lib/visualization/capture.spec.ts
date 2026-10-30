import { describe, it, expect } from 'vitest';
import type { PlotState } from '../types';
import { StableCapture } from './capture';

const state: PlotState = {
	view: '2d', mode: 'instrument', followSound: true, active: true, frozen: false, speed: .05, trail: .12, autoRotate: false,
	notes: [
		{ id: 'c', midi: 60, label: 'C4', frequency: 261.63 },
		{ id: 'g', midi: 67, label: 'G4', frequency: 392 }
	]
};
function push(capture: StableCapture, start: number, count: number, version = 1, amplitude = .4) {
	capture.history.push({ startFrame: start, sampleRate: 48000, voiceIds: ['c', 'g'], frequencies: [261.63, 392], versions: [version, version], channels: [261.63, 392].map((f) => Float32Array.from({ length: count }, (_, i) => amplitude * (Math.sin((start + i) * f * 2 * Math.PI / 48000) + .3 * Math.sin((start + i) * f * 6 * Math.PI / 48000)))) });
}

describe('complete fixed signal captures', () => {
	it('publishes no partial path, then stays unchanged as the ring buffer wraps', () => {
		const capture = new StableCapture();
		push(capture, 0, 1024);
		expect(capture.update(state)).toBeNull();
		push(capture, 1024, 8192);
		const snapshot = capture.update(state)!;
		expect(capture.status).toBe('ready');
		expect(snapshot.peak).toBeGreaterThan(.1);
		const sample = snapshot.sample(1, .02);
		push(capture, 9216, 100000, 1, .1);
		expect(capture.update({ ...state, speed: .5, trail: .35 })).toBe(snapshot);
		expect(snapshot.sample(1, .02)).toBe(sample);
	});
	it('recaptures atomically and preserves an independent stopped visual clock', () => {
		const capture = new StableCapture();
		push(capture, 0, 8192);
		const first = capture.update(state)!;
		capture.recapture();
		push(capture, 8192, 512, 1, .1);
		expect(capture.update({ ...state, frozen: true })).toBe(first);
		expect(capture.status).toBe('capturing');
		push(capture, 8704, 8192, 1, .1);
		const second = capture.update({ ...state, frozen: true })!;
		expect(second).not.toBe(first);
		expect(second.peak).toBeLessThan(first.peak / 2);
	});
	it('replaces a capture only once per new instrument generation', () => {
		const capture = new StableCapture();
		push(capture, 0, 8192);
		const first = capture.update(state)!;
		push(capture, 8192, 8192, 2, .2);
		const second = capture.update(state)!;
		expect(second.revision).toBeGreaterThan(first.revision);
		push(capture, 16384, 8192, 2, .1);
		expect(capture.update(state)).toBe(second);
		capture.clear();
		push(capture, 24576, 8192, 2);
		expect(capture.update(state)).toBeNull();
		push(capture, 32768, 8192, 3);
		expect(capture.update(state)).not.toBeNull();
	});
	it('keeps a frozen capture after released voices have left the input history', () => {
		const capture = new StableCapture();
		push(capture, 0, 8192);
		const snapshot = capture.update(state);
		capture.history.push({ startFrame: 100000, sampleRate: 48000, voiceIds: [], frequencies: [], channels: [] });
		expect(capture.update({ ...state, frozen: true })).toBe(snapshot);
		expect(capture.status).toBe('ready');
	});
});
