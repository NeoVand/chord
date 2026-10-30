import type { SignalChunk } from '../types';

/** Bounded PCM history. Coordinates always come from a shared audio sample clock. */
export class SignalHistory {
	readonly duration: number;
	sampleRate = 48000;
	latestFrame = 0;
	private voices = new Map<string, { data: Float32Array; first: number; end: number; version: number; generation: number }>();
	private nextGeneration = 0;
	private blockedVersions = new Map<string, number>();
	constructor(duration = 2) { this.duration = duration; }

	push(chunk: SignalChunk): void {
		if (chunk.sampleRate !== this.sampleRate) {
			this.voices.clear();
			this.sampleRate = chunk.sampleRate;
		}
		const capacity = Math.ceil(this.duration * this.sampleRate);
		const activeIds = new Set(chunk.voiceIds.filter((id): id is string => id !== null));
		for (const [id, voice] of this.voices) {
			if (!activeIds.has(id) && chunk.startFrame - voice.end > this.sampleRate) this.voices.delete(id);
		}
		chunk.channels.forEach((samples, channel) => {
			const id = chunk.voiceIds[channel];
			if (!id) return;
			let voice = this.voices.get(id);
			const version = chunk.versions?.[channel] ?? 0;
			const blocked = this.blockedVersions.get(id);
			if (blocked !== undefined && version <= blocked) return;
			this.blockedVersions.delete(id);
			if (!voice || voice.version !== version || chunk.startFrame > voice.end + 1 || chunk.startFrame < voice.end) {
				voice = { data: new Float32Array(capacity), first: chunk.startFrame, end: chunk.startFrame, version, generation: ++this.nextGeneration };
				this.voices.set(id, voice);
			}
			for (let i = 0; i < samples.length; i++) voice.data[(chunk.startFrame + i) % capacity] = samples[i];
			voice.end = chunk.startFrame + samples.length;
			voice.first = Math.max(voice.first, voice.end - capacity);
			this.latestFrame = Math.max(this.latestFrame, voice.end);
		});
	}

	/** Changes only on a new voice/source or a discontinuity, never as audio streams in. */
	generation(ids: string[]): string | null {
		if (!ids.length || ids.some((id) => !this.voices.has(id))) return null;
		return ids.map((id) => this.voices.get(id)!.generation).join('/');
	}

	range(ids: string[]): { start: number; end: number } | null {
		if (!ids.length) return null;
		let start = 0, end = Infinity;
		for (const id of ids) {
			const voice = this.voices.get(id);
			if (!voice) return null;
			start = Math.max(start, voice.first);
			end = Math.min(end, voice.end - 1);
		}
		return end > start ? { start, end } : null;
	}

	/** A sampler is allocation-free while building an entire frame of geometry. */
	sampler(id: string): (frame: number) => number {
		const voice = this.voices.get(id);
		if (!voice) return () => 0;
		const { data, first, end } = voice;
		return (frame) => {
			if (frame < first || frame > end - 1) return 0;
			const index = Math.floor(frame);
			const a = data[index % data.length];
			if (index === end - 1) return a;
			return a + (data[(index + 1) % data.length] - a) * (frame - index);
		};
	}
	invalidate(): void {
		for (const [id, voice] of this.voices) this.blockedVersions.set(id, voice.version);
		this.voices.clear();
		this.latestFrame = 0;
	}
	clear(): void { this.voices.clear(); this.blockedVersions.clear(); this.latestFrame = 0; }
}

/** Unbounded sweep clock: wrapping belongs in the shader, never in the geometry. */
export function advanceSweep(sweep: number, delta: number, speed: number, frozen = false): number {
	return frozen ? sweep : sweep + Math.max(0, delta) * Math.max(0, Math.min(.5, speed));
}
