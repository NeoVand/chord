import { describe, it, expect } from 'vitest';
import { pathDistances, simplifyPath, sourceProgress } from './path';

describe('zoom-aware path tessellation', () => {
	it('retains bounded geometric error, endpoints, and fine harmonic detail on zoom', () => {
		const positions = Float32Array.from({ length: 32768 * 3 }, (_, i) => {
			const t = Math.floor(i / 3) / 32767;
			return i % 3 === 0 ? Math.sin(t * 12 * Math.PI) : i % 3 === 1 ? Math.sin(t * 15 * Math.PI) + .015 * Math.sin(t * 180 * Math.PI) : Math.sin(t * 18 * Math.PI);
		});
		const tolerance = .001;
		const indices = simplifyPath(positions, tolerance);
		expect(indices[0]).toBe(0);
		expect(indices.at(-1)).toBe(32767);
		expect(indices.length).toBeLessThan(32768 / 4);
		expect(simplifyPath(positions, tolerance / 32).length).toBeGreaterThan(indices.length * 3);
		let maxError = 0;
		for (let j = 0; j < indices.length - 1; j++) {
			const a = indices[j] * 3, b = indices[j + 1] * 3;
			const delta = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
			const norm = delta.reduce((sum, v) => sum + v * v, 0);
			for (let i = indices[j]; i <= indices[j + 1]; i++) {
				const p = [0, 1, 2].map((k) => positions[i * 3 + k] - positions[a + k]);
				const t = Math.max(0, Math.min(1, p.reduce((sum, v, k) => sum + v * delta[k], 0) / norm));
				maxError = Math.max(maxError, Math.hypot(...p.map((v, k) => v - t * delta[k])));
			}
		}
		expect(maxError).toBeLessThanOrEqual(tolerance);
	});
	it('normalizes cumulative distance without inventing an endpoint connector', () => {
		expect([...pathDistances(new Float32Array([0, 0, 0, 3, 0, 0, 3, 4, 0]))]).toEqual([0, expect.closeTo(3 / 7), 1]);
		expect([...pathDistances(new Float32Array(9))]).toEqual([0, 0, 0]);
	});
	it('keeps mini scopes aligned to source time as the head moves at constant spatial speed', () => {
		const distances = new Float32Array([0, .1, .9, 1]);
		expect(sourceProgress(distances, 0)).toBe(0);
		expect(sourceProgress(distances, .1)).toBeCloseTo(1 / 3);
		expect(sourceProgress(distances, .5)).toBeCloseTo(.5);
		expect(sourceProgress(distances, 1)).toBe(1);
		expect(sourceProgress(new Float32Array(0), .5)).toBe(0);
	});
});
