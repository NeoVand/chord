import { describe, expect, it } from 'vitest';
import { diatonicChords, FIFTHS, midiToFrequency, scaleNames, scaleNotes } from './theory';

describe('musical selections', () => {
	it('preserves MIDI Lab circle order and enharmonic spellings', () => {
		expect(FIFTHS.map((k) => k.root)).toEqual([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);
		expect(scaleNames(1, 'major')).toEqual(['D♭', 'E♭', 'F', 'G♭', 'A♭', 'B♭', 'C']);
		expect(scaleNames(6, 'major')).toContain('E♯');
	});
	it('builds actual major and natural minor triads', () => {
		expect(diatonicChords(0).map((c) => c.name)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
		expect(diatonicChords(0)[0].notes).toEqual([48, 52, 55]);
		expect(diatonicChords(9, 'minor').map((c) => c.name)).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
	});
	it('keeps pentatonic chord selections within the chosen scale', () => {
		const allowed = scaleNotes(0, 'minor-pentatonic');
		expect(diatonicChords(0, 'minor-pentatonic').every((c) => c.notes.every((n) => allowed.includes(n % 12)))).toBe(true);
	});
	it('uses equal temperament without substituting pure ratios', () => {
		expect(midiToFrequency(69)).toBe(440);
		expect(midiToFrequency(76) / midiToFrequency(69)).toBeCloseTo(2 ** (7 / 12), 10);
	});
});
