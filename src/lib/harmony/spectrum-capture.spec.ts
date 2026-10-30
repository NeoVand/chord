import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpectrumCapture } from './spectrum-capture';
import type { PlotNote } from '../types';
import type { VoiceSpectrum } from './types';

interface Job { key: string; notes: PlotNote[]; channels: Float32Array[]; sampleRate: number }
class TestWorker {
	static current: TestWorker;
	onmessage: ((event: MessageEvent<{ key: string; voices: VoiceSpectrum[] }>) => void) | null = null;
	jobs: Job[] = [];
	constructor() { TestWorker.current = this; }
	postMessage(job: Job) { this.jobs.push(job); }
	terminate() { /* No native thread in this deterministic state-machine test. */ }
	finish(index: number, partials = 1) {
		const job = this.jobs[index];
		const voices = job.notes.map((note) => ({ id: note.id, note, partials: Array.from({ length: partials }, (_, i) => ({
			id: `${note.id}:${i}`, voiceId: note.id, frequency: note.frequency * (i + 1), amplitude: 1 / (i + 1), order: i + 1
		})) }));
		this.onmessage?.({ data: { key: job.key, voices } } as MessageEvent<{ key: string; voices: VoiceSpectrum[] }>);
	}
}
const note: PlotNote = { id: 'a', midi: 69, frequency: 440, label: 'A4' };
const push = (capture: SpectrumCapture, version: number, start = 0) => capture.push({ startFrame: start, sampleRate: 48000,
	channels: [new Float32Array(20000).fill(.1)], voiceIds: ['a'], frequencies: [440], versions: [version] });

afterEach(() => vi.unstubAllGlobals());
describe('spectral capture generations', () => {
	it('labels a new sample generation as pending until its own measurement arrives', () => {
		vi.stubGlobal('Worker', TestWorker);
		const capture = new SpectrumCapture(); push(capture, 1);
		expect(capture.read([note], 'instrument', true).source).toBe('waiting');
		TestWorker.current.finish(0);
		expect(capture.read([note], 'instrument', true).source).toBe('captured');
		push(capture, 2, 20000);
		expect(capture.read([note], 'instrument', true).source).toBe('waiting');
		TestWorker.current.finish(1, 4);
		const measured = capture.read([note], 'instrument', true);
		expect(measured.source).toBe('captured');
		expect(measured.voices[0].partials).toHaveLength(4);
		capture.dispose();
	});
	it('retuning projects the last capture and blocks queued PCM from before the glide', () => {
		vi.stubGlobal('Worker', TestWorker);
		const capture = new SpectrumCapture(); push(capture, 1); capture.read([note], 'instrument', true); TestWorker.current.finish(0);
		capture.retune();
		const tuned = { ...note, frequency: 445 };
		push(capture, 1, 20000);
		const projection = capture.read([tuned], 'instrument', true);
		expect(projection.projected).toBe(true);
		expect(projection.voices[0].partials[0].frequency).toBeCloseTo(445, 10);
		expect(TestWorker.current.jobs).toHaveLength(1);
		push(capture, 2, 40000); capture.read([tuned], 'instrument', true); TestWorker.current.finish(1);
		expect(capture.read([tuned], 'instrument', true).projected).toBe(false);
		capture.dispose();
	});
	it('a superseded worker result cannot restore the previous source', () => {
		vi.stubGlobal('Worker', TestWorker);
		const capture = new SpectrumCapture(); push(capture, 1); capture.read([note], 'instrument', true);
		capture.clear(); push(capture, 2, 20000); capture.read([note], 'pure', true);
		TestWorker.current.finish(0, 4);
		expect(capture.read([note], 'pure', true).source).toBe('waiting');
		TestWorker.current.finish(1);
		const fresh = capture.read([note], 'pure', true);
		expect(fresh.source).toBe('captured'); expect(fresh.voices[0].partials).toHaveLength(1);
		capture.dispose();
	});
});
