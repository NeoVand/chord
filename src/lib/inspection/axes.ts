import type { PlotNote } from '../types';

/** Preserve each valid axis identity, then fill vacant slots without duplicates. */
export function resolveAxisIds(notes: readonly PlotNote[], requested: readonly string[] = []): string[] {
	const available = new Set(notes.map((note) => note.id));
	const used = new Set<string>();
	const axes = Array.from({ length: Math.min(3, notes.length) }, (_, index) => {
		const id = requested[index];
		if (!available.has(id) || used.has(id)) return '';
		used.add(id); return id;
	});
	return axes.map((id) => {
		if (id) return id;
		const replacement = notes.find((note) => !used.has(note.id))!.id;
		used.add(replacement); return replacement;
	});
}
