import type { PlotNote, SignalMode } from '../types';
import type { SignalSnapshot } from '../visualization/capture';
import { FFT_SIZE } from './spectrum';
import type { HarmonicSnapshot, VoiceSpectrum } from './types';

export function previewSpectrum(notes: readonly PlotNote[], mode: SignalMode): VoiceSpectrum[] {
	return notes.map((note) => ({ id: note.id, note, partials: Array.from({ length: mode === 'pure' ? 1 : 10 }, (_, i) => ({
		id: `${note.id}:${i}`, voiceId: note.id, order: i + 1, frequency: note.frequency * (i + 1), amplitude: 1 / (i + 1) ** 1.3
	})) }));
}

/** Analyse the session's immutable capture. No second audio history or window. */
export class SpectrumCapture {
	private worker = new Worker(new URL('./spectrum.worker.ts', import.meta.url), { type: 'module' });
	private epoch = 0;
	private revision = 0;
	private pending = '';
	private pendingRevision = 0;
	private pendingMode: SignalMode = 'instrument';
	private requestedRevision = -1;
	private measuredRevision = -1;
	private measuredMode: SignalMode = 'instrument';
	private selection = '';
	private lastKey = '';
	private measurement: VoiceSpectrum[] = [];
	private snapshot: HarmonicSnapshot = { revision: 0, captureRevision: null, source: 'preview', projected: false, voices: [] };
	constructor() {
		this.worker.onmessage = ({ data }: MessageEvent<{ key: string; voices: VoiceSpectrum[] }>) => {
			if (data.key !== this.pending) return;
			this.pending = '';
			if (data.voices.length && data.voices.every((voice) => voice.partials.length)) {
				this.measurement = data.voices;
				this.measuredRevision = this.pendingRevision;
				this.measuredMode = this.pendingMode;
			}
			this.lastKey = '';
		};
	}
	read(notes: readonly PlotNote[], mode: SignalMode, active: boolean, signal: SignalSnapshot | null, capturing = false): HarmonicSnapshot {
		// Plain values cross the worker boundary; Svelte proxies never do.
		notes = notes.map(({ id, midi, frequency, label }) => ({ id, midi, frequency, label }));
		const selection = `${mode}/${notes.map((note) => `${note.id}:${note.frequency}`).join(',')}`;
		if (selection !== this.selection) { this.selection = selection; this.pending = ''; }
		const aligned = signal && signal.mode === mode && signal.notes.length === notes.length
			&& signal.notes.every((note, index) => note.id === notes[index].id && note.frequency === notes[index].frequency);
		if (active && aligned && !signal.preview && signal.revision !== this.requestedRevision && signal.channels.every((channel) => channel.length >= FFT_SIZE)) {
			this.requestedRevision = signal.revision;
			this.pendingRevision = signal.revision; this.pendingMode = mode;
			const channels = signal.channels.map((channel) => channel.slice(0, FFT_SIZE));
			this.pending = `${this.epoch}/${signal.revision}/${selection}`;
			this.worker.postMessage({ key: this.pending, notes, channels, sampleRate: signal.sampleRate }, channels.map((channel) => channel.buffer));
		}
		const key = `${selection}/${signal?.revision}/${this.measuredRevision}/${this.pending}/${active}/${capturing}`;
		if (key === this.lastKey) return this.snapshot;
		this.lastKey = key;
		const matched = active && this.measuredMode === mode && notes.length > 0 && notes.every((note) => this.measurement.some((voice) => voice.id === note.id));
		const voices = matched ? notes.map((note) => {
			const voice = this.measurement.find((candidate) => candidate.id === note.id)!;
			const ratio = note.frequency / voice.note.frequency;
			return { id: note.id, note, partials: voice.partials.map((partial) => ({ ...partial, frequency: partial.frequency * ratio })) };
		}) : previewSpectrum(notes, mode);
		const current = matched && aligned && this.measuredRevision === signal.revision && !capturing;
		this.snapshot = {
			revision: ++this.revision, captureRevision: matched ? this.measuredRevision : null,
			source: current ? 'captured' : active ? 'waiting' : 'preview',
			projected: matched && notes.some((note) => this.measurement.find((voice) => voice.id === note.id)!.note.frequency !== note.frequency), voices
		};
		return this.snapshot;
	}
	clear(): void { this.retune(); this.measurement = []; this.measuredRevision = -1; }
	/** Cancel obsolete work, retaining measured partials for an explicit projection. */
	retune(): void { this.epoch++; this.pending = ''; this.lastKey = ''; }
	// The current window is still valid while its replacement is acquired.
	recapture(): void { this.lastKey = ''; }
	dispose(): void { this.worker.terminate(); }
}
