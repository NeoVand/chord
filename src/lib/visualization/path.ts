/** Full-resolution source stays intact; GPU tessellation is selected with a bounded error. */
export const CURVE_POINTS = 131_072;
export const WAVE_POINTS = 32_768;

/** Iterative Ramer–Douglas–Peucker in world space, retaining time/arc-length indices. */
export function simplifyPath(positions: Float32Array, tolerance: number): number[] {
	const count = positions.length / 3;
	if (tolerance <= 0) return Array.from({ length: count }, (_, i) => i);
	const keep = new Uint8Array(count);
	keep[0] = keep[count - 1] = 1;
	const stack = [0, count - 1];
	const limit = tolerance * tolerance;
	while (stack.length) {
		const end = stack.pop()!, start = stack.pop()!;
		const a = start * 3, b = end * 3;
		const dx = positions[b] - positions[a], dy = positions[b + 1] - positions[a + 1], dz = positions[b + 2] - positions[a + 2];
		const length = dx * dx + dy * dy + dz * dz;
		let farthest = 0, distance = limit;
		for (let i = start + 1; i < end; i++) {
			const j = i * 3;
			const px = positions[j] - positions[a], py = positions[j + 1] - positions[a + 1], pz = positions[j + 2] - positions[a + 2];
			const t = length === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / length));
			const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz;
			const d = ex * ex + ey * ey + ez * ez;
			if (d > distance) { farthest = i; distance = d; }
		}
		if (farthest) { keep[farthest] = 1; stack.push(start, farthest, farthest, end); }
	}
	const indices: number[] = [];
	for (let i = 0; i < count; i++) if (keep[i]) indices.push(i);
	return indices;
}

/** Constant world-space speed on a parametric path, including uneven harmonic detail. */
export function pathDistances(positions: Float32Array): Float32Array {
	const distances = new Float32Array(positions.length / 3);
	let total = 0;
	for (let i = 1; i < distances.length; i++) {
		const p = i * 3;
		total += Math.hypot(positions[p] - positions[p - 3], positions[p + 1] - positions[p - 2], positions[p + 2] - positions[p - 1]);
		distances[i] = total;
	}
	if (total) for (let i = 1; i < distances.length; i++) distances[i] /= total;
	return distances;
}

/** Invert cumulative arc length so the small scopes show the same instant as the head. */
export function sourceProgress(distances: Float32Array, progress: number): number {
	if (distances.length < 2) return 0;
	const target = Math.max(0, Math.min(1, progress));
	let lo = 0, hi = distances.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >>> 1;
		if (distances[mid] < target) lo = mid; else hi = mid;
	}
	const span = distances[hi] - distances[lo];
	return (lo + (span > 0 ? (target - distances[lo]) / span : 0)) / (distances.length - 1);
}
