import type { HarmonicSnapshot, PartialPair } from './types';

/** Rank only cross-note interactions; duplicates of one note are not harmonies. */
export function partialPairs(snapshot: HarmonicSnapshot): PartialPair[] {
	const pairs: PartialPair[] = [];
	for (let i = 0; i < snapshot.voices.length; i++) for (let j = i + 1; j < snapshot.voices.length; j++) {
		for (const a of snapshot.voices[i].partials) for (const b of snapshot.voices[j].partials) {
			const cents = 1200 * Math.log2(a.frequency / b.frequency);
			if (Math.abs(cents) > 120) continue;
			pairs.push({ id: `${a.id}|${b.id}`, a, b, cents, beatHz: Math.abs(a.frequency - b.frequency), weight: Math.sqrt(a.amplitude * b.amplitude) / (1 + Math.abs(cents) / 25) });
		}
	}
	return pairs.sort((a, b) => b.weight - a.weight).slice(0, 24);
}
