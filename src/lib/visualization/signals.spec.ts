import { describe, it, expect } from 'vitest';
import { SignalHistory, advanceSweep } from './signals';

describe('captured audio signals', () => {
	it('preserves coherent channels, harmonic samples, and fractional sampling', () => {
		const history = new SignalHistory(2);
		history.push({ startFrame: 100, sampleRate: 10, channels: [new Float32Array([0, 1, 0, -1]), new Float32Array([.5, .8, -.2, -.6])], voiceIds: ['x', 'y'], frequencies: [1, 2] });
		expect(history.range(['x', 'y'])).toEqual({ start: 100, end: 103 });
		expect(history.sampler('x')(100.5)).toBe(.5);
		expect(history.sampler('y')(102)).toBeCloseTo(-.2);
		expect(history.range(['missing'])).toBeNull();
	});
	it('does not join a released/retriggered voice across missing samples', () => {
		const history = new SignalHistory(1);
		const chunk = { sampleRate: 8, voiceIds: ['x'], frequencies: [1], channels: [new Float32Array([1, 2, 3, 4])] };
		history.push({ ...chunk, startFrame: 0 });
		history.push({ ...chunk, startFrame: 10 });
		expect(history.range(['x'])).toEqual({ start: 10, end: 13 });
		expect(history.sampler('x')(2)).toBe(0);
	});
	it('wraps bounded history without changing sample-clock alignment', () => {
		const history = new SignalHistory(1);
		history.push({ startFrame: 0, sampleRate: 4, channels: [new Float32Array([0, 1, 2, 3])], voiceIds: ['x'], frequencies: [1] });
		history.push({ startFrame: 4, sampleRate: 4, channels: [new Float32Array([4, 5, 6, 7])], voiceIds: ['x'], frequencies: [1] });
		expect(history.range(['x'])).toEqual({ start: 4, end: 7 });
		expect(history.sampler('x')(5.5)).toBe(5.5);
	});
	it('drops the previous instrument capture when the same note changes engine', () => {
		const history = new SignalHistory(1);
		const chunk = { sampleRate: 8, voiceIds: ['x'], frequencies: [1], channels: [new Float32Array([1, 2, 3, 4])] };
		history.push({ ...chunk, startFrame: 0, versions: [1] });
		history.push({ ...chunk, startFrame: 4, versions: [2] });
		expect(history.range(['x'])).toEqual({ start: 4, end: 7 });
	});
	it('rejects queued old-engine blocks after a source switch', () => {
		const history = new SignalHistory(1);
		const chunk = { sampleRate: 8, voiceIds: ['x'], frequencies: [1], channels: [new Float32Array([1, 2, 3, 4])] };
		history.push({ ...chunk, startFrame: 0, versions: [1] });
		history.invalidate();
		history.push({ ...chunk, startFrame: 4, versions: [1] });
		expect(history.range(['x'])).toBeNull();
		history.push({ ...chunk, startFrame: 8, versions: [2] });
		expect(history.range(['x'])).toEqual({ start: 8, end: 11 });
	});
	it('runs an independent sweep in seconds per loop and freezes without resetting', () => {
		expect(advanceSweep(0, 20, .05)).toBe(1);
		expect(advanceSweep(.73, 3, .05, true)).toBe(.73);
		expect(advanceSweep(.73, 0, .05)).toBe(.73);
		expect(advanceSweep(0, 200, .005)).toBe(1);
		expect(advanceSweep(1.9, 1, .5)).toBe(2.4);
	});
});
