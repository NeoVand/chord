import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Chunk { startFrame: number; channels: Float32Array[]; voiceIds: (string | null)[]; frequencies: number[] }
function captureHarness() {
	const chunks: Chunk[] = [];
	let Processor: new (options: object) => {
		port: { onmessage: (event: { data: object }) => void };
		process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
	};
	const context = vm.createContext({
		Float32Array, sampleRate: 48000, currentFrame: 0,
		AudioWorkletProcessor: class {
			port = { postMessage(chunk: Chunk) { chunks.push(chunk); }, onmessage: null };
		},
		registerProcessor(_name: string, type: typeof Processor) { Processor = type; }
	});
	vm.runInContext(readFileSync('static/worklets/voice-capture.js', 'utf8'), context);
	const processor = new Processor!({ processorOptions: { blockSize: 128, voices: 3 } });
	return {
		chunks,
		voice(slot: number, id: string | null, frame: number, version: number) {
			processor.port.onmessage({ data: { type: 'voice', slot, id, frame, version, frequency: slot ? 660 : 440 } });
		},
		process(start: number) {
			context.currentFrame = start;
			const inputs = [0, 1, 2].map((channel) => Float32Array.from({ length: 128 }, (_, i) => channel * 1000 + start + i));
			const output = new Float32Array(128).fill(99);
			processor.process([inputs], [[output]]);
			return output;
		}
	};
}

describe('per-voice audio capture', () => {
	it('keeps channels sample aligned and never sends audio to speakers twice', () => {
		const capture = captureHarness();
		capture.voice(0, 'C4', 0, 1);
		capture.voice(1, 'G4', 0, 2);
		const output = capture.process(0);
		expect(capture.chunks).toHaveLength(1);
		expect(capture.chunks[0].voiceIds).toEqual(['C4', 'G4', null]);
		expect(capture.chunks[0].channels[1][97] - capture.chunks[0].channels[0][97]).toBe(1000);
		expect(output.every((sample) => sample === 0)).toBe(true);
	});
	it('splits a block at the exact frame a slot changes notes', () => {
		const capture = captureHarness();
		capture.voice(0, 'old', 0, 1);
		capture.process(0);
		capture.voice(0, 'new', 192, 2);
		capture.process(128);
		capture.process(256);
		expect(capture.chunks[1].startFrame).toBe(128);
		expect(capture.chunks[1].voiceIds[0]).toBe('old');
		expect(capture.chunks[1].channels[0]).toHaveLength(64);
		expect(capture.chunks[2].startFrame).toBe(192);
		expect(capture.chunks[2].voiceIds[0]).toBe('new');
		expect(capture.chunks[2].channels[0][0]).toBe(192);
	});
	it('cancels a scheduled voice when panic arrives before its start', () => {
		const capture = captureHarness();
		capture.voice(0, 'scheduled', 128, 1);
		capture.voice(0, null, 0, 2);
		capture.process(0);
		capture.process(128);
		expect(capture.chunks).toHaveLength(0);
	});
});
