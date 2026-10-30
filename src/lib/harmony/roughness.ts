import type { VoiceSpectrum } from './types';

/** Sethares' Plomp–Levelt kernel, with minimum-amplitude weighting.
 * https://sethares.engr.wisc.edu/comprog.html
 * This describes local sensory roughness, not musical quality or preference.
 */
export function roughnessPair(a: number, b: number): number {
	const separation = .24 * Math.abs(a - b) / (.0207 * Math.min(a, b) + 18.96);
	return Math.exp(-3.5 * separation) - Math.exp(-5.75 * separation);
}

export function roughness(voices: readonly VoiceSpectrum[], offsets: readonly number[] = []): number {
	let total = 0, weight = 0;
	for (let i = 0; i < voices.length; i++) for (let j = i + 1; j < voices.length; j++) {
		const first = 2 ** ((offsets[i] ?? 0) / 1200), second = 2 ** ((offsets[j] ?? 0) / 1200);
		for (const a of voices[i].partials) for (const b of voices[j].partials) {
			const amplitude = Math.min(a.amplitude, b.amplitude);
			total += amplitude * roughnessPair(a.frequency * first, b.frequency * second);
			weight += amplitude;
		}
	}
	return weight ? total / weight : 0;
}

export interface RoughnessSurface { size: number; values: Float32Array; minimum: number; maximum: number }

/** Surface axes retune voices 2 and 3, with every remaining voice held fixed.
 * Input spectra are referenced to equal temperament for those two voices.
 */
export function roughnessSurface(voices: readonly VoiceSpectrum[], size = 65): RoughnessSurface {
	const values = new Float32Array(size * size);
	let minimum = Infinity, maximum = -Infinity;
	const offsets = Array(voices.length).fill(0);
	for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
		offsets[1] = -50 + 100 * column / (size - 1);
		offsets[2] = -50 + 100 * row / (size - 1);
		const value = roughness(voices, offsets);
		values[row * size + column] = value;
		minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
	}
	return { size, values, minimum, maximum };
}
