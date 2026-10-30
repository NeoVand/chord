import { describe, expect, it } from 'vitest';
import { analyseSpectrum, FFT_SIZE } from './spectrum';
import { roughness, roughnessPair, roughnessSurface } from './roughness';
import type { VoiceSpectrum } from './types';

const voice = (id: string, frequency: number): VoiceSpectrum => ({ id, note: { id, midi: 69, frequency, label: id },
	partials: Array.from({ length: 8 }, (_, i) => ({ id: `${id}:${i}`, voiceId: id, frequency: frequency * (i + 1), amplitude: 1 / (i + 1), order: i + 1 })) });

describe('measured harmonic analysis', () => {
	it('resolves off-bin fundamentals and inharmonic components without inventing harmonics', () => {
		const samples = Float32Array.from({ length: FFT_SIZE }, (_, i) => .5 * Math.sin(2 * Math.PI * 441.3 * i / 48000) + .12 * Math.sin(2 * Math.PI * 1341.7 * i / 48000));
		const peaks = analyseSpectrum(samples, 48000, 441.3, 'a');
		expect(peaks).toHaveLength(2);
		expect(Math.abs(peaks[0].frequency - 441.3)).toBeLessThan(.1);
		expect(Math.abs(peaks[1].frequency - 1341.7)).toBeLessThan(.1);
		expect(peaks[1].amplitude / peaks[0].amplitude).toBeCloseTo(.24, 1);
	});
	it('returns no peaks for silence', () => expect(analyseSpectrum(new Float32Array(FFT_SIZE), 48000, 440, 'a')).toEqual([]));
});

describe('local roughness model', () => {
	it('has zero beating at coincidence, is symmetric, and falls beyond the critical band', () => {
		expect(roughnessPair(440, 440)).toBe(0);
		expect(roughnessPair(440, 470)).toBe(roughnessPair(470, 440));
		expect(roughnessPair(440, 470)).toBeGreaterThan(roughnessPair(440, 700));
	});
	it('finds the harmonic fifth valley and produces finite bounded surfaces', () => {
		const voices = [voice('a', 220), voice('b', 330), voice('c', 550)];
		expect(roughness(voices.slice(0, 2))).toBeLessThan(roughness(voices.slice(0, 2), [0, 10]));
		const surface = roughnessSurface(voices, 9);
		expect(surface.values).toHaveLength(81);
		expect(surface.minimum).toBeGreaterThan(0);
		expect(surface.maximum).toBeGreaterThan(surface.minimum);
		expect([...surface.values].every(Number.isFinite)).toBe(true);
	});
});
