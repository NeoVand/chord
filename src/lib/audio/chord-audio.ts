/**
 * Chord's audio instrument. Adapted from NeoVand/midilab's master bus, GM
 * soundfont strategy, and subtractive synth. Each note has a separate mono
 * bus; one AudioWorklet captures all buses on the same sample clock. The plot
 * therefore receives actual instrument harmonics, never reconstructed sines.
 */
import type { Smplr } from 'smplr';
import type { AudioStatus, SignalChunk, SoundSource } from '../types';
import { SampleBank } from './sample-bank';
import { presetForProgram } from './presets';
import { GM_PROGRAMS } from './programs';
import { synthVoice, makeNoise, type SoundingVoice } from './voice';

const VOICES = 8;
interface Request { id: string; note: number; velocity: number; frequency: number; revision: number }
interface Playing {
	request: Request;
	slot: number;
	version: number;
	voice: SoundingVoice;
	gate: GainNode;
	source: SoundSource;
	timer?: ReturnType<typeof setTimeout>;
}
interface AudioOptions {
	onChunk?: (chunk: SignalChunk) => void;
	onStatus?: (status: AudioStatus) => void;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const midiFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12);

export class ChordAudio {
	#context: AudioContext | null = null;
	#master: GainNode | null = null;
	#analyser: AnalyserNode | null = null;
	#levelBuffer = new Float32Array(8192);
	#capture: AudioWorkletNode | null = null;
	#merger: ChannelMergerNode | null = null;
	#buses: GainNode[] = [];
	#bank: SampleBank | null = null;
	#noise: AudioBuffer | null = null;
	#initializing: Promise<void> | null = null;
	#disposed = false;
	#source: SoundSource = 'sampled';
	#program = 0;
	#volume = 0.65;
	#revision = 0;
	#voiceVersion = 0;
	#held = new Map<string, Request>();
	#slots: (Playing | null)[] = Array(VOICES).fill(null);
	#readyPrograms = new Set<number>();
	#failedPrograms = new Set<number>();
	#status: AudioStatus = { state: 'idle', message: 'Play a note to start audio' };
	constructor(private options: AudioOptions = {}) {}

	get context() { return this.#context; }
	/** A real master-output tap; use connectSpeakers:false in audioMotion. */
	get output(): AudioNode | null { return this.#analyser; }
	get analyser() { return this.#analyser; }
	get status() { return this.#status; }

	/** Current post-volume, post-limiter RMS. Held keys are not evidence of audible sound. */
	getOutputLevel(): number {
		if (!this.#analyser || this.#context?.state !== 'running' || this.#disposed) return 0;
		this.#analyser.getFloatTimeDomainData(this.#levelBuffer);
		// The newest ~21 ms responds to the attack without the spectrum's long FFT window.
		let sum = 0;
		for (let i = this.#levelBuffer.length - 1024; i < this.#levelBuffer.length; i++) sum += this.#levelBuffer[i] ** 2;
		return Math.sqrt(sum / 1024);
	}

	async resume(): Promise<void> {
		if (this.#disposed) return;
		if (!this.#context) {
			if (typeof window === 'undefined') return;
			this.#context = new AudioContext({ latencyHint: 'interactive' });
			// Resume synchronously inside the user's gesture, before loading code.
			const start = this.#context.resume();
			this.#initializing = Promise.all([start, this.#initialize()]).then(() => {}).catch((error) => {
				if (!this.#disposed) this.#report('error', error instanceof Error ? error.message : 'Audio could not start');
				throw error;
			});
		} else if (this.#context.state === 'suspended') await this.#context.resume();
		await this.#initializing;
	}

	async #initialize() {
		const context = this.#context!;
		const master = context.createGain();
		master.gain.value = this.#volume;
		const limiter = context.createDynamicsCompressor();
		limiter.threshold.value = -6;
		limiter.knee.value = 6;
		limiter.ratio.value = 12;
		limiter.attack.value = 0.003;
		limiter.release.value = 0.15;
		const analyser = context.createAnalyser();
		analyser.fftSize = 8192;
		analyser.smoothingTimeConstant = 0.6;
		master.connect(limiter).connect(analyser).connect(context.destination);
		this.#master = master;
		this.#analyser = analyser;
		this.#noise = makeNoise(context);
		this.#bank = new SampleBank(context);
		const base = import.meta.env.BASE_URL;
		await context.audioWorklet.addModule(new URL(`${base}worklets/voice-capture.js`, window.location.href).href);
		if (this.#disposed) return;
		const merger = context.createChannelMerger(VOICES);
		const capture = new AudioWorkletNode(context, 'chord-voice-capture', {
			numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
			channelCount: VOICES, channelCountMode: 'explicit', channelInterpretation: 'discrete',
			processorOptions: { voices: VOICES, blockSize: 512 }
		});
		capture.port.onmessage = ({ data }: MessageEvent<SignalChunk>) => {
			if (!this.#disposed) this.options.onChunk?.(data);
		};
		capture.onprocessorerror = () => this.#report('error', 'Waveform capture stopped. Reload to restart audio.');
		// The processor outputs zeros. This connection keeps its capture graph
		// running without adding the signal to the speakers a second time.
		merger.connect(capture).connect(context.destination);
		this.#merger = merger;
		this.#capture = capture;
		this.#buses = Array.from({ length: VOICES }, (_, slot) => {
			const bus = context.createGain();
			bus.channelCount = 1;
			bus.channelCountMode = 'explicit';
			bus.channelInterpretation = 'speakers';
			bus.connect(master);
			bus.connect(merger, 0, slot);
			return bus;
		});
		this.#updateStatus();
		if (this.#source === 'sampled') this.#warmProgram();
	}

	async noteOn(id: string, note: number, velocity = 96, frequency = midiFrequency(note), options: { retriggerHeld?: boolean } = {}): Promise<void> {
		if (this.#disposed || !Number.isFinite(note) || !Number.isFinite(frequency) || frequency <= 0) return;
		if (velocity <= 0) { this.noteOff(id); return; }
		this.noteOff(id);
		const request: Request = {
			id, note: clamp(Math.round(note), 0, 127), velocity: clamp(velocity, 1, 127),
			frequency: clamp(frequency, 8, 20000), revision: ++this.#revision
		};
		this.#held.set(id, request);
		try {
			await this.resume();
			if (!this.#isCurrent(request) || !this.#capture) return;
			if (options.retriggerHeld) this.#restart();
			else this.#start(request);
		} catch {
			if (this.#held.get(id) === request) this.#held.delete(id);
		}
	}

	noteOff(id: string): void {
		this.#held.delete(id);
		const playing = this.#slots.find((voice) => voice?.request.id === id);
		if (!playing || !this.#context) return;
		const end = playing.voice.release(this.#context.currentTime);
		clearTimeout(playing.timer);
		playing.timer = setTimeout(() => {
			if (this.#slots[playing.slot] === playing) this.#remove(playing);
		}, Math.max(0, (end - this.#context.currentTime) * 1000 + 25));
	}

	allNotesOff(): void {
		this.#held.clear();
		for (const voice of this.#slots) if (voice) this.#remove(voice);
		this.#updateStatus();
	}

	/** Editing a latched chord starts its notes together, including decayed samples. */
	retriggerHeld(): void {
		if (!this.#disposed && this.#held.size) this.#restart();
	}

	setSource(source: SoundSource): void {
		if (source === this.#source || this.#disposed) return;
		this.#source = source;
		this.#restart();
		if (source === 'sampled') this.#warmProgram();
		this.#updateStatus();
	}
	setProgram(program: number): void {
		const next = clamp(Math.round(program), 0, 127);
		if (!Number.isFinite(next) || next === this.#program || this.#disposed) return;
		this.#program = next;
		if (this.#source !== 'pure') this.#restart();
		if (this.#source === 'sampled') this.#warmProgram();
		this.#updateStatus();
	}
	setVolume(volume: number): void {
		if (!Number.isFinite(volume)) return;
		this.#volume = clamp(volume, 0, 1);
		this.#master?.gain.setTargetAtTime(this.#volume, this.#context!.currentTime, 0.02);
	}

	#isCurrent(request: Request) { return !this.#disposed && this.#held.get(request.id) === request; }
	#time() {
		const context = this.#context!;
		return Math.ceil((context.currentTime + 0.018) * context.sampleRate / 128) * 128 / context.sampleRate;
	}
	#assign(slot: number, version: number, id: string | null, frequency: number, time: number) {
		this.#capture?.port.postMessage({ type: 'voice', slot, version, id, frequency, frame: Math.round(time * this.#context!.sampleRate) });
	}
	#slot(): number {
		const free = this.#slots.indexOf(null);
		if (free !== -1) return free;
		const released = this.#slots.findIndex((voice) => voice && !this.#held.has(voice.request.id));
		if (released !== -1) return released;
		return this.#slots.reduce((oldest, voice, index, slots) => voice!.version < slots[oldest]!.version ? index : oldest, 0);
	}
	#start(request: Request, time = this.#time()) {
		const existing = this.#slots.find((voice) => voice?.request.id === request.id);
		const slot = existing?.slot ?? this.#slot();
		const previous = this.#slots[slot];
		if (previous) {
			if (previous.request.id !== request.id) this.#held.delete(previous.request.id);
			this.#remove(previous);
		}
		const context = this.#context!;
		const gate = context.createGain();
		gate.connect(this.#buses[slot]);
		const source = this.#source === 'pure' ? 'pure' : 'synth';
		const voice = synthVoice(context, gate, request.frequency, request.velocity, time, presetForProgram(this.#program), this.#noise, source === 'pure');
		const playing: Playing = { request, slot, version: ++this.#voiceVersion, voice, gate, source };
		this.#slots[slot] = playing;
		this.#assign(slot, playing.version, request.id, request.frequency, time);
		if (this.#source === 'sampled') void this.#replaceWithSample(playing, this.#program, time);
		this.#updateStatus();
	}

	async #replaceWithSample(playing: Playing, program: number, scheduledTime: number) {
		const context = this.#context!;
		const gate = context.createGain();
		let sampler: Smplr | undefined;
		try {
			sampler = await this.#bank!.player(program, gate);
			this.#readyPrograms.add(program);
			if (!this.#isCurrent(playing.request) || this.#source !== 'sampled' || this.#program !== program || this.#slots[playing.slot] !== playing) {
				sampler.dispose(); gate.disconnect(); return;
			}
			// Cached recordings retain the chord's shared attack clock. A download
			// that completes later gets a fresh future start, never a backdated one.
			const time = scheduledTime >= context.currentTime + .004 ? scheduledTime : this.#time();
			const { request, slot } = playing;
			this.#remove(playing);
			gate.connect(this.#buses[slot]);
			const stop = sampler.start({
				note: request.note, velocity: request.velocity, time, stopId: request.id,
				detune: 1200 * Math.log2(request.frequency / midiFrequency(request.note)), ampRelease: 0.25
			});
			const player = sampler;
			let released = false;
			const voice: SoundingVoice = {
				release(at) { if (!released) { stop(at); released = true; } return at + 0.4; },
				stop(at) { stop(at); },
				dispose() { player.dispose(); }
			};
			const next: Playing = { request, slot, voice, gate, source: 'sampled', version: ++this.#voiceVersion };
			this.#slots[slot] = next;
			this.#assign(slot, next.version, request.id, request.frequency, time);
			this.#updateStatus();
		} catch {
			sampler?.dispose(); gate.disconnect();
			this.#failedPrograms.add(program);
			if (this.#program === program && !this.#disposed) this.#updateStatus();
		}
	}

	#remove(playing: Playing) {
		clearTimeout(playing.timer);
		playing.gate.disconnect();
		playing.voice.dispose();
		if (this.#slots[playing.slot] === playing) {
			this.#slots[playing.slot] = null;
			this.#assign(playing.slot, ++this.#voiceVersion, null, 0, this.#context!.currentTime);
		}
	}
	#restart() {
		const requests = [...this.#held.values()];
		for (const voice of this.#slots) if (voice) this.#remove(voice);
		const time = this.#capture ? this.#time() : undefined;
		for (const old of requests) {
			const request = { ...old, revision: ++this.#revision };
			this.#held.set(request.id, request);
			if (this.#capture) this.#start(request, time);
			else void this.resume().then(() => { if (this.#isCurrent(request) && this.#capture) this.#start(request); }).catch(() => {});
		}
	}
	#warmProgram() {
		if (!this.#bank || this.#disposed) return;
		const program = this.#program;
		void this.#bank.load(program).then(() => {
			this.#readyPrograms.add(program);
			if (this.#program === program && !this.#disposed) this.#updateStatus();
		}).catch(() => {
			this.#failedPrograms.add(program);
			if (this.#program === program && !this.#disposed) this.#updateStatus();
		});
	}
	#updateStatus() {
		if (this.#disposed) return;
		if (!this.#capture) { this.#report('idle', 'Play a note to start audio'); return; }
		if (this.#source === 'pure') { this.#report('ready', 'Pure sine tones'); return; }
		const name = GM_PROGRAMS[this.#program];
		if (this.#source === 'synth') { this.#report('ready', `${presetForProgram(this.#program).name} synth`); return; }
		if (this.#failedPrograms.has(this.#program)) { this.#report('fallback', `${name} unavailable · synth fallback`); return; }
		const pending = this.#slots.some((voice) => voice && this.#held.has(voice.request.id) && voice.source !== 'sampled');
		if (!this.#readyPrograms.has(this.#program) || pending) this.#report('loading', `Loading ${name} · synth playing`);
		else this.#report('ready', `${name} · sampled`);
	}
	#report(state: AudioStatus['state'], message: string) {
		if (state === this.#status.state && message === this.#status.message) return;
		this.#status = { state, message };
		this.options.onStatus?.(this.#status);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.allNotesOff();
		this.#disposed = true;
		this.#bank?.dispose();
		this.#capture?.port.close();
		this.#capture?.disconnect();
		this.#merger?.disconnect();
		for (const bus of this.#buses) bus.disconnect();
		void this.#context?.close();
	}
}
