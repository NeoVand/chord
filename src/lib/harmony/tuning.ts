import { midiToFrequency } from '../music/theory';
import type { PlotNote } from '../types';

export const MAX_CENTS = 50;
export const clampCents = (value: number) => Number.isFinite(value) ? Math.max(-MAX_CENTS, Math.min(MAX_CENTS, value)) : 0;
export const tunedFrequency = (midi: number, cents = 0) => midiToFrequency(midi) * 2 ** (clampCents(cents) / 1200);
export const centsOffset = (note: PlotNote) => 1200 * Math.log2(note.frequency / midiToFrequency(note.midi));

/** A declared simple-ratio reference, not a universal optimum for every timbre. */
const RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
export function justCents(midi: number, rootMidi: number): number {
	const interval = ((midi - rootMidi) % 12 + 12) % 12;
	return 1200 * Math.log2(RATIOS[interval]) - interval * 100;
}
