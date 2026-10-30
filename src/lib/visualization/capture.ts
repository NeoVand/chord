import type { PlotNote, PlotState } from '../types';
import { SignalHistory } from './signals';

export interface SignalSnapshot {
	revision: number;
	notes: PlotNote[];
	duration: number;
	peak: number;
	preview: boolean;
	/** Seconds relative to this immutable capture's start. */
	sample(lane: number, seconds: number): number;
}

/** A complete finite trajectory, not an assertion that equal-tempered pitches close. */
export function captureDuration(notes: PlotNote[]): number {
	return Math.min(.75, Math.max(.02, 24 / Math.max(25, Math.min(...notes.map((note) => note.frequency)))));
}

/** Publish only complete, aligned windows. Streaming blocks never mutate a published snapshot. */
export class StableCapture {
	readonly history = new SignalHistory();
	status: 'capturing' | 'ready' | 'preview' | 'idle' = 'idle';
	private signature = '';
	private generation: string | null = null;
	private start: number | null = null;
	private revision = 0;
	private pending = true;
	private snapshot: SignalSnapshot | null = null;

	update(state: PlotState): SignalSnapshot | null {
		const notes = state.notes.slice(0, 8);
		const signature = `${state.active}/${state.mode}/${notes.map((n) => `${n.id}:${n.frequency}`).join(',')}`;
		if (signature !== this.signature) {
			this.signature = signature;
			this.generation = null;
			this.start = null;
			this.snapshot = null;
			this.pending = true;
		}
		if (!notes.length) { this.status = 'idle'; return null; }
		const duration = captureDuration(notes);
		if (!state.active) {
			this.status = 'preview';
			this.snapshot ??= {
				revision: ++this.revision, notes, duration, peak: 1, preview: true,
				sample: (lane, seconds) => Math.sin(2 * Math.PI * notes[lane].frequency * seconds)
			};
			return this.snapshot;
		}
		const ids = notes.map((n) => n.id);
		const generation = this.history.generation(ids);
		const range = this.history.range(ids);
		if (!range || !generation) {
			// A frozen selection can outlive its released voices and input history.
			this.status = this.snapshot && !this.pending ? 'ready' : 'capturing';
			return this.snapshot;
		}
		if (generation !== this.generation) {
			this.generation = generation;
			// Leave the attack intact in the audio. Inspect a settled window after 45 ms.
			this.start = range.start + Math.round(.045 * this.history.sampleRate);
			this.pending = true;
		}
		if (!this.pending) { this.status = 'ready'; return this.snapshot; }
		this.status = 'capturing';
		const sampleRate = this.history.sampleRate;
		const count = Math.ceil(duration * sampleRate) + 1;
		this.start = Math.max(range.start, this.start ?? range.start);
		if (range.end < this.start + count - 1) return this.snapshot;
		const start = this.start;
		let peak = 0;
		const channels = ids.map((id) => {
			const sample = this.history.sampler(id);
			return Float32Array.from({ length: count }, (_, i) => {
				const value = sample(start + i);
				peak = Math.max(peak, Math.abs(value));
				return value;
			});
		});
		this.snapshot = {
			revision: ++this.revision, notes, duration, peak, preview: false,
			sample(lane, seconds) {
				const data = channels[lane];
				const frame = Math.min(data.length - 1, Math.max(0, seconds * sampleRate));
				const index = Math.floor(frame);
				return data[index] + (data[Math.min(index + 1, data.length - 1)] - data[index]) * (frame - index);
			}
		};
		this.pending = false;
		this.status = 'ready';
		return this.snapshot;
	}

	recapture(): void {
		this.pending = true;
		this.start = this.history.latestFrame;
	}

	clear(): void {
		this.history.invalidate(); this.signature = ''; this.snapshot = null;
		this.generation = null; this.start = null; this.pending = true;
	}
}
