/** Shared contracts: sound, captured signals, and their independent visual clock. */
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
	push(chunk: SignalChunk): void;
	/** Ignore queued blocks from the preceding instrument until a new capture version arrives. */
	clearSignals(): void;
	/** Borrowed arrays from the same visual clock as the main plot. Do not mutate. */
	getDisplaySamples(): readonly { id: string; samples: Float32Array; cycles: number }[];
	/** Source-time position of the main highlight, shared by the miniature scopes. */
	getTraceProgress(): number;
	/** Smoothed audible activity for visual envelopes; 1 in Free run mode. */
	getSignalActivity(): number;
	zoom(factor: number): void;
	/** Frame the current curve without changing the viewing direction. */
	fitView(): void;
	/** Take a new complete, coherent window of the currently sounding voices. */
	recapture(): void;
	resetView(): void;
	dispose(): void;
}

export interface ScopeOptions {
	getState(): PlotState;
	/** Keep capture alive while avoiding GPU work in another workspace. */
	isVisible?(): boolean;
	getOutputLevel?(): number;
	onStatus?(status: 'webgpu' | 'webgl' | 'unavailable'): void;
	onZoom?(magnification: number): void;
	onCapture?(state: 'capturing' | 'ready' | 'preview' | 'idle'): void;
}
