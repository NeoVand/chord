import { describe, expect, it } from 'vitest';
import { InspectionTransport } from './transport';

describe('shared visual transport', () => {
	it('freezes phase and brightness, follows decay, and explicitly permits silent inspection', () => {
		const clock = new InspectionTransport();
		const state = { speed: .1, frozen: false, followSound: true };
		clock.update(0, .05, state); const playing = clock.update(50, .05, state);
		expect(playing.moving).toBe(true);
		const frozen = clock.update(100, .05, { ...state, frozen: true });
		for (let time = 150; time <= 1000; time += 50) clock.update(time, 0, { ...state, frozen: true });
		expect(clock.frame.time).toBe(frozen.time); expect(clock.frame.level).toBe(frozen.level);
		const silent = clock.update(1050, 0, state);
		expect(silent.motion).toBe('silent'); expect(silent.moving).toBe(false);
		const inspecting = clock.update(1100, 0, { ...state, followSound: false });
		expect(inspecting.time).toBeGreaterThan(silent.time); expect(inspecting.level).toBe(1);
	});
	it('does not jump after a hidden tab and isolates independent instrument instances', () => {
		const state = { speed: .1, frozen: false, followSound: false };
		const first = new InspectionTransport(), second = new InspectionTransport();
		first.update(0, 0, state); const before = first.update(50, 0, state);
		first.update(100, 0, state, false); first.update(5000, 0, state, false);
		expect(first.update(10000, 0, state).time).toBe(before.time);
		expect(first.update(10050, 0, state).time).toBeCloseTo(before.time + .005);
		expect(second.update(10050, 0, state).time).toBe(0);
	});
});
