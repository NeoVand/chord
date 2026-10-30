import { describe, expect, it } from 'vitest';
import { justCents, tunedFrequency, clampCents } from './tuning';

describe('shared note tuning', () => {
	it('makes the just major third and fifth exact frequency ratios', () => {
		const root = tunedFrequency(48);
		expect(tunedFrequency(52, justCents(52, 48)) / root).toBeCloseTo(5 / 4, 12);
		expect(tunedFrequency(55, justCents(55, 48)) / root).toBeCloseTo(3 / 2, 12);
		expect(justCents(52, 48)).toBeCloseTo(-13.6863, 4);
		expect(justCents(55, 48)).toBeCloseTo(1.955, 3);
	});
	it('retains octave equivalence and bounds invalid control input', () => {
		expect(justCents(64, 48)).toBe(justCents(52, 48));
		expect(clampCents(NaN)).toBe(0);
		expect(clampCents(300)).toBe(50);
		expect(clampCents(-300)).toBe(-50);
	});
});
