/** Shared contracts: sound, captured signals, and their independent visual clock. */
import type { InspectionFrame } from './inspection/session';
export type SoundSource = 'sampled' | 'synth' | 'pure';
export type SignalMode = 'instrument' | 'pure';
export type PlotView = 'waveform' | '2d' | '3d';

export interface PlotNote {
	id: string;
	midi: number;
	frequency: number;
	label: string;
}

/** AudioWorklet blocks. Every channel shares the same sample clock. */
export interface SignalChunk {
	startFrame: number;
	sampleRate: number;
	channels: Float32Array[];
	voiceIds: (string | null)[];
	frequencies: number[];
	/** Changes when a slot is retriggered or changes its sound source. */
	versions?: number[];
}

export interface AudioStatus {
	state: 'idle' | 'loading' | 'ready' | 'fallback' | 'error';
	message: string;
}

export interface PlotState {
	view: PlotView;
	mode: SignalMode;
	/** Gate motion and modulate glow from the actual audible output. */
	followSound: boolean;
	notes: PlotNote[];
	/** Explicit note identities for X, Y and Z; waveform mode displays every note. */
	axisIds?: readonly string[];
	/** Highlight sweeps per second. This never changes the captured path. */
	speed: number;
	frozen: boolean;
	/** Fraction of the complete path illuminated behind the moving head. */
	trail: number;
	autoRotate: boolean;
	/** False means the explicitly labelled, silent pure-tone preview. */
	active: boolean;
}

export interface ScopeController {
	/** Source-time position of the main highlight, shared by the miniature scopes. */
	getTraceProgress(): number;
	zoom(factor: number): void;
	/** Frame the current curve without changing the viewing direction. */
	fitView(): void;
	resetView(): void;
	dispose(): void;
}

export interface ScopeOptions {
	getState(): PlotState;
	getInspection(): InspectionFrame;
	/** Avoid GPU work in another workspace. Acquisition belongs to the session. */
	isVisible?(): boolean;
	onStatus?(status: 'webgpu' | 'webgl' | 'unavailable'): void;
	onZoom?(magnification: number): void;
}
