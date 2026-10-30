import { describe, expect, it } from 'vitest';
import { resolveAxisIds } from './axes';
const notes = ['c', 'e', 'g', 'b'].map((id, index) => ({ id, label: id, midi: 60 + index, frequency: 260 + index }));
describe('Scope note assignments', () => {
	it('preserves valid axes across tuning and only replaces missing notes', () => {
		expect(resolveAxisIds(notes, ['g', 'c', 'b'])).toEqual(['g', 'c', 'b']);
		expect(resolveAxisIds(notes.filter((note) => note.id !== 'g'), ['g', 'c', 'b'])).toEqual(['e', 'c', 'b']);
		expect(resolveAxisIds(notes.map((note) => ({ ...note, frequency: note.frequency * 1.01 })), ['g', 'c', 'b'])).toEqual(['g', 'c', 'b']);
	});
	it('bounds axes to available distinct voices, including incomplete selections', () => {
		expect(resolveAxisIds(notes, ['b', 'b', 'missing'])).toEqual(['b', 'c', 'e']);
		expect(resolveAxisIds(notes.slice(0, 2), ['g', 'e', 'b'])).toEqual(['c', 'e']);
		expect(resolveAxisIds([])).toEqual([]);
	});
});
