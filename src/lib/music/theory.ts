/** Adapted from MIDI Lab's harmony.ts: circle ordering, spelling, and triad construction. */
export const NOTE_COLORS = ['#77dbea', '#f4aa91', '#b3a2f4'];
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FIFTHS = [
	{ root: 0, label: 'C', minor: 'Am' }, { root: 7, label: 'G', minor: 'Em' },
	{ root: 2, label: 'D', minor: 'Bm' }, { root: 9, label: 'A', minor: 'F♯m' },
	{ root: 4, label: 'E', minor: 'C♯m' }, { root: 11, label: 'B', minor: 'G♯m' },
	{ root: 6, label: 'F♯', minor: 'D♯m' }, { root: 1, label: 'D♭', minor: 'B♭m' },
	{ root: 8, label: 'A♭', minor: 'Fm' }, { root: 3, label: 'E♭', minor: 'Cm' },
	{ root: 10, label: 'B♭', minor: 'Gm' }, { root: 5, label: 'F', minor: 'Dm' }
];
export const SCALES = [
	{ id: 'major', label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
	{ id: 'minor', label: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
	{ id: 'dorian', label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
	{ id: 'phrygian', label: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
	{ id: 'lydian', label: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
	{ id: 'mixolydian', label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
	{ id: 'locrian', label: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
	{ id: 'harmonic-minor', label: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
	{ id: 'major-pentatonic', label: 'Major pentatonic', intervals: [0, 2, 4, 7, 9] },
	{ id: 'minor-pentatonic', label: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] }
];
export const INTERVALS = [
	{ semitones: 0, label: 'Unison', short: 'P1' },
	{ semitones: 1, label: 'Minor second', short: 'm2' },
	{ semitones: 2, label: 'Major second', short: 'M2' },
	{ semitones: 3, label: 'Minor third', short: 'm3' },
	{ semitones: 4, label: 'Major third', short: 'M3' },
	{ semitones: 5, label: 'Perfect fourth', short: 'P4' },
	{ semitones: 6, label: 'Tritone', short: 'TT' },
	{ semitones: 7, label: 'Perfect fifth', short: 'P5' },
	{ semitones: 8, label: 'Minor sixth', short: 'm6' },
	{ semitones: 9, label: 'Major sixth', short: 'M6' },
	{ semitones: 10, label: 'Minor seventh', short: 'm7' },
	{ semitones: 11, label: 'Major seventh', short: 'M7' },
	{ semitones: 12, label: 'Octave', short: 'P8' }
];
const TRIADS: Record<string, number[]> = {
	major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6],
	augmented: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7]
};
const SUFFIX: Record<string, string> = { major: '', minor: 'm', diminished: 'dim', augmented: '+', sus2: 'sus2', sus4: 'sus4' };
const mod = (v: number) => ((v % 12) + 12) % 12;
export const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const noteName = (midi: number) => `${NOTE_NAMES[mod(midi)]}${Math.floor(midi / 12) - 1}`;
export const scaleNotes = (root: number, scaleId: string) =>
	(SCALES.find((scale) => scale.id === scaleId) ?? SCALES[0]).intervals.map((v) => mod(root + v));
export function chordNotes(root: number, quality = 'major', octave = 3): number[] {
	return (TRIADS[quality] ?? TRIADS.major).map((v) => 12 * (octave + 1) + mod(root) + v);
}

/** Spell each degree with its proper letter, retaining E♯ in F♯ major, etc. */
export function scaleNames(root: number, scaleId: string): string[] {
	const scale = SCALES.find((s) => s.id === scaleId) ?? SCALES[0];
	const tonic = FIFTHS.find((key) => key.root === mod(root))?.label ?? 'C';
	const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
	const natural = [0, 2, 4, 5, 7, 9, 11];
	const start = letters.indexOf(tonic[0]);
	const degrees = scaleId === 'major-pentatonic' ? [0, 1, 2, 4, 5]
		: scaleId === 'minor-pentatonic' ? [0, 2, 3, 4, 6] : [0, 1, 2, 3, 4, 5, 6];
	return scale.intervals.map((offset, i) => {
		const letter = (start + degrees[i]) % 7;
		let delta = mod(root + offset - natural[letter]);
		if (delta > 6) delta -= 12;
		return letters[letter] + (delta > 0 ? '♯'.repeat(delta) : '♭'.repeat(-delta));
	});
}

export interface Chord { name: string; roman: string; notes: number[]; quality: string }
export function diatonicChords(root: number, scaleId = 'major', octave = 3): Chord[] {
	const scale = SCALES.find((s) => s.id === scaleId) ?? SCALES[0];
	const names = scaleNames(root, scaleId);
	const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
	return scale.intervals.flatMap((offset, degree) => {
		let quality: string | undefined;
		if (scale.intervals.length === 7) {
			const third = mod(scale.intervals[(degree + 2) % 7] - offset);
			const fifth = mod(scale.intervals[(degree + 4) % 7] - offset);
			quality = Object.keys(TRIADS).find((q) => TRIADS[q][1] === third && TRIADS[q][2] === fifth);
		} else {
			quality = Object.keys(TRIADS).find((q) => TRIADS[q].every((v) => scale.intervals.includes(mod(offset + v))));
		}
		if (!quality) return [];
		const roman = quality === 'minor' || quality === 'diminished' ? romans[degree].toLowerCase() : romans[degree];
		return [{ name: names[degree] + SUFFIX[quality], roman: roman + (quality === 'diminished' ? '°' : quality === 'augmented' ? '+' : ''), notes: chordNotes(root + offset, quality, octave), quality }];
	});
}
