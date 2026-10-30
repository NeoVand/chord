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
	const factors = Array.from({ length: size }, (_, i) => 2 ** ((-50 + 100 * i / (size - 1)) / 1200));
	const columns = new Float64Array(size), rows = new Float64Array(size);
	let constant = 0, weight = 0;
	// All pair terms except voices 2×3 are constant or one-dimensional. This
	// keeps eight-note chords responsive without approximating the model.
	for (let i = 0; i < voices.length; i++) for (let j = i + 1; j < voices.length; j++) {
		for (const a of voices[i].partials) for (const b of voices[j].partials) {
			const amplitude = Math.min(a.amplitude, b.amplitude); weight += amplitude;
			if (i === 1 && j === 2) {
				for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) values[row * size + column] += amplitude * roughnessPair(a.frequency * factors[column], b.frequency * factors[row]);
			} else if (i === 1 || j === 1) {
				for (let column = 0; column < size; column++) columns[column] += amplitude * roughnessPair(a.frequency * (i === 1 ? factors[column] : 1), b.frequency * (j === 1 ? factors[column] : 1));
			} else if (i === 2 || j === 2) {
				for (let row = 0; row < size; row++) rows[row] += amplitude * roughnessPair(a.frequency * (i === 2 ? factors[row] : 1), b.frequency * (j === 2 ? factors[row] : 1));
			} else constant += amplitude * roughnessPair(a.frequency, b.frequency);
		}
	}
	for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
		const value = weight ? (values[row * size + column] + columns[column] + rows[row] + constant) / weight : 0;
		values[row * size + column] = value;
		minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
	}
	return { size, values, minimum, maximum };
}
