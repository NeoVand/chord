import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectionSession, type InspectionState } from './session';
import type { PlotNote } from '../types';
import type { VoiceSpectrum } from '../harmony/types';
import { analyseSpectrum, FFT_SIZE } from '../harmony/spectrum';

interface Job { key: string; notes: PlotNote[]; channels: Float32Array[]; sampleRate: number }
class TestWorker {
	static current: TestWorker;
	onmessage: ((event: MessageEvent<{ key: string; voices: VoiceSpectrum[] }>) => void) | null = null;
	jobs: Job[] = [];
	terminated = false;
	constructor() { TestWorker.current = this; }
	postMessage(job: Job) { this.jobs.push(job); }
	terminate() { this.terminated = true; }
	finish(index: number) {
		const job = this.jobs[index];
		const voices = job.notes.map((note, lane) => ({ id: note.id, note,
			partials: analyseSpectrum(job.channels[lane], job.sampleRate, note.frequency, note.id)
		}));
		this.onmessage?.({ data: { key: job.key, voices } } as MessageEvent<{ key: string; voices: VoiceSpectrum[] }>);
	}
}
const note: PlotNote = { id: 'a', midi: 69, frequency: 440, label: 'A4' };
function setup() {
	vi.stubGlobal('Worker', TestWorker);
	const state: InspectionState = { notes: [note], mode: 'instrument', active: true, frozen: false, followSound: false, speed: .1 };
	const update = vi.fn();
	const session = new InspectionSession({ getState: () => state, getOutputLevel: () => .02, onUpdate: update });
	return { session, state, worker: TestWorker.current, update };
}
function push(session: InspectionSession, version: number, start = 0, frequency = 440, amplitude = .4) {
	session.push({ startFrame: start, sampleRate: 48000,
		channels: [Float32Array.from({ length: 20000 }, (_, i) => amplitude * Math.sin((start + i) * frequency * 2 * Math.PI / 48000))],
		voiceIds: ['a'], frequencies: [frequency], versions: [version] });
}
afterEach(() => vi.unstubAllGlobals());

describe('shared inspection session', () => {
	it('publishes one aligned PCM window to geometry and FFT without a GPU view', () => {
		const { session, worker } = setup(); push(session, 1);
		const frame = session.update(0), signal = frame.signal!;
		expect(frame.captureStatus).toBe('ready');
		expect(signal.channels[0].length).toBeGreaterThanOrEqual(FFT_SIZE);
		expect(worker.jobs).toHaveLength(1);
		expect(signal.startFrame).toBe(2160);
		expect(worker.jobs[0].channels[0]).not.toBe(signal.channels[0]);
		expect(worker.jobs[0].channels[0][250]).toBe(signal.sample(0, 250 / signal.sampleRate));
		worker.finish(0);
		const measured = session.update(16);
		expect(measured.spectrum.source).toBe('captured');
		expect(measured.spectrum.captureRevision).toBe(signal.revision);
		expect(measured.spectrum.voices[0].partials[0].frequency).toBeCloseTo(440, 0);
		push(session, 1, 20000, 440, .1);
		expect(session.update(32).signal).toBe(signal);
		expect(worker.jobs).toHaveLength(1);
		session.dispose(); expect(worker.terminated).toBe(true);
	});
	it('keeps a new generation pending until analysis of that exact capture arrives', () => {
		const { session, worker } = setup(); push(session, 1); session.update(0); worker.finish(0);
		const first = session.update(16);
		push(session, 2, 20000); const pending = session.update(32);
		expect(pending.signal!.revision).toBeGreaterThan(first.signal!.revision);
		expect(pending.spectrum.source).toBe('waiting');
		worker.finish(1);
		const measured = session.update(48);
		expect(measured.spectrum.captureRevision).toBe(measured.signal!.revision);
		expect(measured.spectrum.source).toBe('captured'); session.dispose();
	});
	it('retuning projects measured partials and rejects pre-glide PCM in both views', () => {
		const { session, state, worker } = setup(); push(session, 1); session.update(0); worker.finish(0); session.update(16);
		const prior = session.frame.signal;
		session.retune(); state.notes = [{ ...note, frequency: 445 }];
		push(session, 1, 20000);
		const projection = session.update(32);
		expect(projection.signal).toBe(prior);
		expect(projection.captureStatus).toBe('capturing');
		expect(projection.spectrum.projected).toBe(true);
		expect(projection.spectrum.voices[0].partials[0].frequency).toBeCloseTo(445, 0);
		expect(worker.jobs).toHaveLength(1);
		push(session, 2, 40000, 445); session.update(48); worker.finish(1);
		const measured = session.update(64);
		expect(measured.spectrum.projected).toBe(false);
		expect(measured.signal!.notes[0].frequency).toBe(445);
		expect(measured.spectrum.captureRevision).toBe(measured.signal!.revision); session.dispose();
	});
	it('a superseded FFT result cannot restore the previous instrument', () => {
		const { session, state, worker } = setup(); push(session, 1); session.update(0);
		session.clear(); state.mode = 'pure'; push(session, 2, 20000); session.update(16);
		worker.finish(0);
		expect(session.update(32).spectrum.source).toBe('waiting');
		worker.finish(1);
		const fresh = session.update(48);
		expect(fresh.spectrum.source).toBe('captured');
		expect(fresh.signal!.mode).toBe('pure');
		expect(fresh.spectrum.captureRevision).toBe(fresh.signal!.revision); session.dispose();
	});
	it('recaptures both analyses from the same later window and preserves silence snapshots', () => {
		const { session, state, worker } = setup(); push(session, 1); const first = session.update(0).signal!;
		// Recapture must not cancel the still-valid result for the retained window.
		session.recapture(); worker.finish(0); session.update(16);
		push(session, 1, 20000, 440, .2); const second = session.update(32).signal!;
		expect(second.startFrame).toBe(20000);
		expect(second.revision).toBeGreaterThan(first.revision);
		worker.finish(1); expect(session.update(48).spectrum.captureRevision).toBe(second.revision);
		session.recapture(); push(session, 1, 40000, 440, 0);
		const silent = session.update(64);
		expect(silent.signal).toBe(second);
		expect(silent.spectrum.source).toBe('captured');
		// Retuning an ended recording must not relabel the old shape as a new capture.
		session.retune(); state.notes = [{ ...note, frequency: 445 }];
		push(session, 2, 60000, 445, 0);
		const pending = session.update(80);
		expect(pending.signal).toBe(second); expect(pending.captureStatus).toBe('capturing');
		expect(pending.spectrum.projected).toBe(true);
		expect(session.update(96).captureStatus).toBe('capturing');
		expect(worker.jobs).toHaveLength(2); session.dispose();
	});
	it('advances shared time without publishing PCM into reactive UI every frame', () => {
		const { session, state, update } = setup(); state.active = false;
		const first = session.update(0); session.update(16); const moving = session.update(32);
		expect(moving.transport.time).toBeGreaterThan(first.transport.time);
		expect(update).toHaveBeenCalledTimes(1);
		state.frozen = true; const frozen = session.update(48); session.update(96);
		expect(session.frame.transport.time).toBe(frozen.transport.time);
		expect(session.frame.transport.level).toBe(frozen.transport.level);
		expect(update).toHaveBeenCalledTimes(2); session.dispose();
	});
});
