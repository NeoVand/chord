import type { SampleAsset } from './sample-bank';
import type { SoundingVoice } from './voice';

/** GM regions decoded by smplr, played through retunable native buffer sources.
 * smplr's setDetune applies only to future notes. Owning this small playback
 * layer lets tuning glide without restarting a piano's attack or losing loops.
 */
export function sampleVoice(context: BaseAudioContext, destination: AudioNode, asset: SampleAsset,
	note: number, frequency: number, velocity: number, time: number): SoundingVoice {
	const sources: { source: AudioBufferSourceNode; base: number; envelope: GainNode; release: number }[] = [];
	const nodes: AudioNode[] = [];
	const inRange = (range: [number, number] | undefined, value: number) => !range || value >= range[0] && value <= range[1];
	for (const group of asset.preset.groups) for (const region of group.regions) {
		if (!inRange(group.keyRange, note) || !inRange(region.keyRange, note) || region.key !== undefined && region.key !== note
			|| !inRange(group.velRange, velocity) || !inRange(region.velRange, velocity)) continue;
		const buffer = asset.buffers.get(region.sample);
		if (!buffer) continue;
		const params = { ...asset.preset.defaults, ...group, ...region };
		const source = context.createBufferSource();
		source.buffer = buffer;
		const base = (note - (region.pitch ?? region.key ?? note) + (params.tune ?? 0)) * 100 + (params.detune ?? 0);
		source.detune.value = base + 1200 * Math.log2(frequency / (440 * 2 ** ((note - 69) / 12)));
		source.loop = Boolean(params.loop || region.loopAuto);
		source.loopStart = region.loopAuto ? region.loopAuto.startRatio * buffer.duration : params.loopStart ?? 0;
		source.loopEnd = region.loopAuto ? region.loopAuto.endRatio * buffer.duration : params.loopEnd ?? buffer.duration;
		const gain = context.createGain();
		// Preserve MIDI Lab/smplr Soundfont's velocity law and output gain.
		gain.gain.value = (velocity / 127) ** 2 * 10 ** ((params.volume ?? 0) / 20) * 5 * (100 / 127) ** 2;
		const envelope = context.createGain();
		const attack = params.ampAttack ?? 0;
		envelope.gain.setValueAtTime(attack > 0 ? 0 : 1, time);
		if (attack > 0) envelope.gain.linearRampToValueAtTime(1, time + attack);
		source.connect(gain).connect(envelope).connect(destination);
		nodes.push(source, gain, envelope);
		sources.push({ source, base, envelope, release: params.ampRelease ?? .25 });
		source.start(time, params.offset ?? 0);
	}
	if (!sources.length) throw new Error('No playable sample region');
	let finish = Infinity;
	const stop = (at: number, immediate: boolean) => {
		let end = at;
		for (const { source, envelope, release } of sources) {
			const until = at + (immediate ? .006 : release);
			if (until >= finish) continue;
			envelope.gain.cancelAndHoldAtTime(at);
			envelope.gain.linearRampToValueAtTime(0, until);
			try { source.stop(until); } catch { /* A finite recording may have ended. */ }
			end = Math.max(end, until);
		}
		finish = Math.min(finish, end);
		return finish;
	};
	return {
		retune(next, at) {
			const cents = 1200 * Math.log2(next / (440 * 2 ** ((note - 69) / 12)));
			for (const { source, base } of sources) {
				source.detune.cancelScheduledValues(at);
				source.detune.setTargetAtTime(base + cents, at, .012);
			}
		},
		release: (at) => stop(at, false),
		stop: (at) => { stop(at, true); },
		dispose() {
			for (const { source } of sources) try { source.stop(); } catch { /* Already ended. */ }
			for (const node of nodes) node.disconnect();
		}
	};
}
