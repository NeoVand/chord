/** Sample-aligned, per-voice PCM tap. Audio is heard through the separate master bus. */
class VoiceCapture extends AudioWorkletProcessor {
	constructor(options) {
		super();
		this.size = options.processorOptions?.blockSize ?? 512;
		this.count = options.processorOptions?.voices ?? 8;
		this.ids = Array(this.count).fill(null);
		this.frequencies = Array(this.count).fill(0);
		this.versions = Array(this.count).fill(-1);
		this.events = [];
		this.fill = 0;
		this.buffers = Array.from({ length: this.count }, () => new Float32Array(this.size));
		this.startFrame = 0;
		this.port.onmessage = ({ data }) => {
			if (data.type !== 'voice' || data.slot < 0 || data.slot >= this.count) return;
			this.events = this.events.filter((event) => event.slot !== data.slot || event.version > data.version);
			this.events.push(data);
			this.events.sort((a, b) => a.frame - b.frame);
		};
	}
	flush() {
		if (!this.fill) return;
		if (this.ids.some((id) => id !== null)) {
			const channels = this.buffers.map((buffer) => buffer.slice(0, this.fill));
			this.port.postMessage({
				startFrame: this.startFrame,
				sampleRate,
				channels,
				voiceIds: this.ids.slice(),
				frequencies: this.frequencies.slice(),
				versions: this.versions.slice()
			}, channels.map((channel) => channel.buffer));
		}
		this.fill = 0;
	}
	process(inputs, outputs) {
		const input = inputs[0] ?? [];
		const output = outputs[0]?.[0];
		const length = output?.length ?? input[0]?.length ?? 128;
		if (output) output.fill(0);
		for (let i = 0; i < length; i++) {
			const frame = currentFrame + i;
			while (this.events.length && this.events[0].frame <= frame) {
				const event = this.events.shift();
				if (event.version < this.versions[event.slot]) continue;
				this.flush();
				this.versions[event.slot] = event.version;
				this.ids[event.slot] = event.id;
				this.frequencies[event.slot] = event.frequency;
			}
			if (!this.fill) this.startFrame = frame;
			for (let channel = 0; channel < this.count; channel++) {
				this.buffers[channel][this.fill] = input[channel]?.[i] ?? 0;
			}
			if (++this.fill === this.size) this.flush();
		}
		return true;
	}
}
registerProcessor('chord-voice-capture', VoiceCapture);
