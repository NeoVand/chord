import { describe, expect, it } from 'vitest';
import { SoundActivity } from './activity';

describe('sound-following motion', () => {
	it('starts on an audible attack and settles completely after a natural decay', () => {
		const activity = new SoundActivity();
		activity.update(0, 1 / 60);
		expect(activity.audible).toBe(false);
		activity.update(.05, 1 / 60);
		expect(activity.audible).toBe(true);
		expect(activity.level).toBeGreaterThan(.5);
		for (let i = 0; i < 60; i++) activity.update(.05 * Math.exp(-i / 4), 1 / 60);
		expect(activity.audible).toBe(false);
		expect(activity.level).toBe(0);
	});

	it('ignores brief quiet gaps without flickering, then stops after sustained silence', () => {
		const activity = new SoundActivity();
		activity.update(.01, 1 / 60);
		for (let i = 0; i < 4; i++) activity.update(0, 1 / 60);
		expect(activity.audible).toBe(true);
		activity.update(.0007, 1 / 60);
		expect(activity.audible).toBe(true);
		for (let i = 0; i < 8; i++) activity.update(0, 1 / 60);
		expect(activity.audible).toBe(false);
		activity.update(.0007, 1 / 60);
		expect(activity.audible).toBe(false);
		activity.update(.002, 1 / 60);
		expect(activity.audible).toBe(true);
	});

	it('treats invalid readings as silence and bounds the visual envelope', () => {
		const activity = new SoundActivity();
		for (let i = 0; i < 10; i++) activity.update(100, .1);
		expect(activity.level).toBeLessThanOrEqual(1);
		for (let i = 0; i < 10; i++) activity.update(NaN, .1);
		expect(activity.audible).toBe(false);
		expect(activity.level).toBe(0);
	});
});
