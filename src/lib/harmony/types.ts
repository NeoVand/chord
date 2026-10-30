import type { PlotNote } from '../types';
import type { InspectionFrame } from '../inspection/session';

export type Workspace = 'overtones' | 'tuning' | 'chords' | 'scope';
export interface Partial {
	id: string;
	voiceId: string;
	/** Approximate harmonic number; measured peaks need not be exact harmonics. */
	order: number;
	frequency: number;
	amplitude: number;
}
export interface VoiceSpectrum {
	id: string;
	note: PlotNote;
	partials: Partial[];
}
export interface HarmonicSnapshot {
	revision: number;
	/** Identity of the exact shared PCM window behind these measured partials. */
	captureRevision: number | null;
	source: 'preview' | 'captured' | 'waiting';
	/** Frequencies projected from a previous measured spectrum during retuning. */
	projected: boolean;
	voices: VoiceSpectrum[];
}
export interface PartialPair {
	id: string;
	a: Partial;
	b: Partial;
	beatHz: number;
	cents: number;
	weight: number;
}
export interface HarmonySceneState {
	view: 'overtones' | 'tuning';
	notes: readonly PlotNote[];
	spectrum: HarmonicSnapshot;
	frozen: boolean;
	followSound: boolean;
	/** Visual time multiplier. Does not change audio pitch. */
	speed: number;
	selectedPair: string | null;
}
export interface HarmonySceneOptions {
	getState(): HarmonySceneState;
	getInspection(): InspectionFrame;
	onPickPair?(id: string): void;
	/** Atomic cents offsets keyed by voice identity. */
	onTune?(updates: { id: string; cents: number }[]): void;
	onStatus?(status: 'webgpu' | 'webgl' | 'unavailable'): void;
	onBusy?(busy: boolean): void;
}
export interface HarmonySceneController {
	fit(): void;
	zoom(factor: number): void;
	dispose(): void;
}
