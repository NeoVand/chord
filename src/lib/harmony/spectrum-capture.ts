import type { PlotNote, SignalChunk, SignalMode } from '../types';
import { SignalHistory } from '../visualization/signals';
import { FFT_SIZE } from './spectrum';
import type { HarmonicSnapshot, VoiceSpectrum } from './types';

export function previewSpectrum(notes: readonly PlotNote[], mode: SignalMode): VoiceSpectrum[] {
	return notes.map((note) => ({ id: note.id, note, partials: Array.from({ length: mode === 'pure' ? 1 : 10 }, (_, i) => ({
		id: `${note.id}:${i}`, voiceId: note.id, order: i + 1, frequency: note.frequency * (i + 1), amplitude: 1 / (i + 1) ** 1.3
	})) }));
}

/** One immutable settled spectrum per capture generation. All FFT work stays
 * off the interaction thread. Retuning projects the last measurement while a
 * fresh, fully settled window is acquired, and is explicitly labelled as such.
 */
export class SpectrumCapture {
	private history = new SignalHistory(.7);
	private worker = new Worker(new URL('./spectrum.worker.ts', import.meta.url), { type: 'module' });
	private epoch = 0;
	private revision = 0;
	private pending = '';
	private measuredKey = '';
	private lastKey = '';
	private measurement: VoiceSpectrum[] = [];
	private snapshot: HarmonicSnapshot = { revision: 0, source: 'preview', projected: false, voices: [] };
	constructor() {
		this.worker.onmessage = ({ data }: MessageEvent<{ key: string; voices: VoiceSpectrum[] }>) => {
			if (data.key !== this.pending) return;
			this.pending = '';
			this.measuredKey = data.key;
			// Keep the last meaningful capture after a finite sample has decayed.
			if (data.voices.every((voice) => voice.partials.length)) this.measurement = data.voices;
			this.lastKey = '';
		};
	}
	push(chunk: SignalChunk): void { this.history.push(chunk); }
	read(notes: readonly PlotNote[], mode: SignalMode, active: boolean): HarmonicSnapshot {
		const ids = notes.map((note) => note.id);
		const generation = this.history.generation(ids);
		const signature = `${this.epoch}/${mode}/${notes.map((note) => `${note.id}:${note.frequency}`).join(',')}`;
		const jobKey = `${signature}/${generation}`;
		const range = this.history.range(ids);
		if (active && range && generation && this.pending !== jobKey && this.measuredKey !== jobKey) {
			const start = range.start + Math.round(.045 * this.history.sampleRate);
			if (range.end >= start + FFT_SIZE) {
				const channels = ids.map((id) => {
					const sample = this.history.sampler(id);
					return Float32Array.from({ length: FFT_SIZE }, (_, i) => sample(start + i));
				});
				this.pending = jobKey;
				this.worker.postMessage({ key: jobKey, notes: [...notes], channels, sampleRate: this.history.sampleRate }, channels.map((channel) => channel.buffer));
			}
		}
		const key = `${signature}/${this.measuredKey}/${active}`;
		if (key === this.lastKey) return this.snapshot;
		this.lastKey = key;
		const matched = notes.length > 0 && notes.every((note) => this.measurement.some((voice) => voice.id === note.id));
		const voices = matched ? notes.map((note) => {
			const voice = this.measurement.find((candidate) => candidate.id === note.id)!;
			const ratio = note.frequency / voice.note.frequency;
			return { id: note.id, note, partials: voice.partials.map((partial) => ({ ...partial, frequency: partial.frequency * ratio })) };
		}) : previewSpectrum(notes, mode);
		this.snapshot = { revision: ++this.revision, source: matched ? 'captured' : active ? 'waiting' : 'preview',
			projected: matched && notes.some((note) => this.measurement.find((voice) => voice.id === note.id)!.note.frequency !== note.frequency), voices };
		return this.snapshot;
	}
	clear(): void {
		this.epoch++; this.history.invalidate(); this.measurement = []; this.pending = ''; this.measuredKey = ''; this.lastKey = '';
	}
	dispose(): void { this.worker.terminate(); this.history.clear(); }
}
