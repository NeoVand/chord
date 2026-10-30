import type { Partial } from './types';

export const FFT_SIZE = 16384;

/** Hann-windowed radix-2 FFT. The worker retains actual spectral peaks, including
 * inharmonic components; it never replaces an instrument with harmonic sines.
 */
export function analyseSpectrum(samples: Float32Array, sampleRate: number, fundamental: number, id: string): Partial[] {
	const n = samples.length;
	if (n < 32 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
	const real = new Float64Array(n), imaginary = new Float64Array(n);
	let energy = 0;
	for (let i = 0; i < n; i++) {
		real[i] = samples[i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
		energy += samples[i] ** 2;
	}
	if (energy / n < 1e-10) return [];
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) [real[i], real[j]] = [real[j], real[i]];
	}
	for (let length = 2; length <= n; length *= 2) {
		const angle = -2 * Math.PI / length;
		const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
		for (let start = 0; start < n; start += length) {
			let wr = 1, wi = 0;
			for (let j = 0; j < length / 2; j++) {
				const a = start + j, b = a + length / 2;
				const tr = wr * real[b] - wi * imaginary[b], ti = wr * imaginary[b] + wi * real[b];
				real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
				real[a] += tr; imaginary[a] += ti;
				const next = wr * stepReal - wi * stepImaginary;
				wi = wr * stepImaginary + wi * stepReal; wr = next;
			}
		}
	}
	const magnitude = Float64Array.from({ length: n / 2 }, (_, i) => Math.hypot(real[i], imaginary[i]) * 4 / n);
	let peak = 0;
	for (const value of magnitude) peak = Math.max(peak, value);
	const found: Omit<Partial, 'id'>[] = [];
	for (let bin = Math.max(2, Math.floor(20 * n / sampleRate)); bin < Math.min(n / 2 - 1, 12000 * n / sampleRate); bin++) {
		const value = magnitude[bin];
		if (value < peak * .018 || value <= magnitude[bin - 1] || value <= magnitude[bin + 1]) continue;
		const left = Math.log(Math.max(1e-12, magnitude[bin - 1])), center = Math.log(value), right = Math.log(Math.max(1e-12, magnitude[bin + 1]));
		const offset = Math.max(-.5, Math.min(.5, .5 * (left - right) / (left - 2 * center + right)));
		const frequency = (bin + offset) * sampleRate / n;
		found.push({ voiceId: id, frequency, amplitude: Math.exp(center - .25 * (left - right) * offset), order: Math.max(1, Math.round(frequency / fundamental)) });
	}
	return found.sort((a, b) => b.amplitude - a.amplitude).slice(0, 16).sort((a, b) => a.frequency - b.frequency)
		.map((partial, index) => ({ ...partial, id: `${id}:${index}` }));
}
