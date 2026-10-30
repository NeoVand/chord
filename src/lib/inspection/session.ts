import type { PlotNote, SignalChunk, SignalMode } from '../types';
import type { HarmonicSnapshot } from '../harmony/types';
import { SpectrumCapture } from '../harmony/spectrum-capture';
import { FFT_SIZE } from '../harmony/spectrum';
import { StableCapture, type CaptureStatus, type SignalSnapshot } from '../visualization/capture';
import { SignalHistory } from '../visualization/signals';
import { EMPTY_TRANSPORT, InspectionTransport, type TransportFrame, type TransportState } from './transport';

export interface InspectionState extends TransportState {
	notes: readonly PlotNote[];
	mode: SignalMode;
	/** Has this selection been auditioned, rather than a silent modeled preview? */
	active: boolean;
}
export interface InspectionFrame {
	signal: SignalSnapshot | null;
	spectrum: HarmonicSnapshot;
	captureStatus: CaptureStatus;
	transport: Readonly<TransportFrame>;
}
export const EMPTY_INSPECTION_FRAME: InspectionFrame = {
	signal: null, spectrum: { revision: 0, captureRevision: null, source: 'preview', projected: false, voices: [] },
	captureStatus: 'idle', transport: EMPTY_TRANSPORT
};
interface InspectionOptions {
	getState(): InspectionState;
	getOutputLevel(): number;
	/** Only selection, capture, analysis and audible-state changes enter the UI. */
	onUpdate?(frame: InspectionFrame): void;
}

/** Per instrument instance. GPU views consume this session; none owns audio data. */
export class InspectionSession {
	private capture = new StableCapture(new SignalHistory(2), FFT_SIZE);
	private analysis = new SpectrumCapture();
	private transport = new InspectionTransport();
	private animation: number | null = null;
	private disposed = false;
	private publishedKey = '';
	frame: InspectionFrame = EMPTY_INSPECTION_FRAME;
	constructor(private options: InspectionOptions) {}
	push(chunk: SignalChunk): void { if (!this.disposed) this.capture.history.push(chunk); }
	/** Also exposed for deterministic tests, with no DOM, GPU or audio context. */
	update(now: number, visible = true): InspectionFrame {
		if (this.disposed) return this.frame;
		const state = this.options.getState();
		const signal = this.capture.update(state);
		const spectrum = this.analysis.read(state.notes, state.mode, state.active, signal, this.capture.status === 'capturing');
		const transport = this.transport.update(now, this.options.getOutputLevel(), state, visible);
		this.frame = { signal, spectrum, captureStatus: this.capture.status, transport };
		const key = `${signal?.revision}/${spectrum.revision}/${this.capture.status}/${transport.audible}/${transport.motion}`;
		if (key !== this.publishedKey) { this.publishedKey = key; this.options.onUpdate?.(this.frame); }
		return this.frame;
	}
	start(): void {
		if (this.animation !== null || this.disposed) return;
		const animate = (now: number) => {
			this.update(now, !document.hidden);
			if (!this.disposed) this.animation = requestAnimationFrame(animate);
		};
		this.animation = requestAnimationFrame(animate);
	}
	/** A source or note generation changed; reject queued blocks from the old one. */
	clear(): void { this.capture.clear(); this.analysis.clear(); }
	/** Pitch glides invalidate PCM while preserving a labelled spectral projection. */
	retune(): void { this.capture.clear(true); this.analysis.retune(); }
	recapture(): void { this.capture.recapture(); this.analysis.recapture(); }
	dispose(): void {
		this.disposed = true;
		if (this.animation !== null) cancelAnimationFrame(this.animation);
		this.capture.history.clear(); this.analysis.dispose();
	}
}
