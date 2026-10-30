/**
 * MIDI Lab's dual-oscillator, velocity-sensitive subtractive voice, adapted to
 * expose one output per played note. The shared presets retain the original
 * filter and amplitude envelopes. Source: NeoVand/midilab/audio/synth.ts.
 */
import type { Preset } from './presets';

export interface SoundingVoice {
	retune(frequency: number, time: number): void;
	release(time: number): number;
	stop(time: number): void;
	dispose(): void;
}

export function makeNoise(context: BaseAudioContext): AudioBuffer {
	const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
	const samples = buffer.getChannelData(0);
	for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
	return buffer;
}

export function synthVoice(
	context: BaseAudioContext,
	destination: AudioNode,
	frequency: number,
	velocity: number,
	time: number,
	preset: Preset,
	noise: AudioBuffer | null,
	pure = false
): SoundingVoice {
	const sources: AudioScheduledSourceNode[] = [];
	const nodes: AudioNode[] = [];
	const amp = context.createGain();
	const peak = Math.pow(velocity / 127, 1.5) * (pure ? 0.2 : preset.gain * 0.22);
	const attack = pure ? 0.004 : Math.max(0.001, preset.attack);
	const release = pure ? 0.045 : Math.max(0.01, preset.release);
	amp.gain.setValueAtTime(0, time);
	amp.gain.linearRampToValueAtTime(peak, time + attack);
	if (!pure) {
		amp.gain.setTargetAtTime(peak * preset.sustain, time + attack, Math.max(0.01, preset.decay / 3));
	}
	amp.connect(destination);
	nodes.push(amp);

	let input: AudioNode = amp;
	if (!pure) {
		const filter = context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = preset.resonance;
		const base = Math.max(40, Math.min(18000, preset.cutoff * (0.45 + (velocity / 127) * 0.55)));
		filter.frequency.setValueAtTime(base, time);
		filter.frequency.linearRampToValueAtTime(Math.min(18000, base * 2 ** preset.filterEnv), time + attack);
		filter.frequency.setTargetAtTime(base, time + attack, Math.max(0.02, preset.filterDecay / 3));
		filter.connect(amp);
		input = filter;
		nodes.push(filter);
	}

	const first = context.createOscillator();
	first.type = pure ? 'sine' : preset.osc1;
	first.frequency.value = frequency;
	first.connect(input);
	sources.push(first);
	nodes.push(first);
	if (!pure) {
		const second = context.createOscillator();
		second.type = preset.osc2;
		second.frequency.value = frequency;
		second.detune.value = preset.detune;
		const level = context.createGain();
		level.gain.value = preset.osc2Level;
		second.connect(level).connect(input);
		sources.push(second);
		nodes.push(second, level);
		if (preset.noise > 0 && noise) {
			const source = context.createBufferSource();
			source.buffer = noise;
			source.loop = true;
			const gain = context.createGain();
			gain.gain.value = preset.noise;
			source.connect(gain).connect(input);
			sources.push(source);
			nodes.push(source, gain);
		}
	}
	for (const source of sources) source.start(time);
	let released = false;
	let finish = Infinity;
	function stopSources(at: number) {
		for (const source of sources) {
			try { source.stop(at); } catch { /* A source may have ended already. */ }
		}
	}
	function hold(at: number) {
		if (typeof amp.gain.cancelAndHoldAtTime === 'function') amp.gain.cancelAndHoldAtTime(at);
		else {
			amp.gain.cancelScheduledValues(at);
			amp.gain.setValueAtTime(amp.gain.value, at);
		}
	}
	return {
		retune(next, at) {
			for (const source of sources) if (source instanceof OscillatorNode) {
				source.frequency.cancelScheduledValues(at);
				source.frequency.setTargetAtTime(next, at, .012);
			}
		},
		release(at) {
			if (released) return finish;
			released = true;
			hold(at);
			amp.gain.setTargetAtTime(0, at, release / 4);
			finish = at + release * 1.5;
			stopSources(finish);
			return finish;
		},
		stop(at) {
			released = true;
			hold(at);
			amp.gain.linearRampToValueAtTime(0, at + 0.005);
			finish = at + 0.006;
			stopSources(finish);
		},
		dispose() {
			stopSources(context.currentTime);
			for (const node of nodes) node.disconnect();
		}
	};
}
