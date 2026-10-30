/**
 * MIDI Lab's smplr / General MIDI strategy, with decoded recordings shared by
 * isolated voice players so the oscilloscope can capture each note separately.
 * Source: NeoVand/midilab/src/lib/audio/gm.svelte.ts.
 */
import { Soundfont, getSoundfontNames, type SampleLoader, type SmplrPreset, type Smplr } from 'smplr';
import { GM_PROGRAMS } from './programs';

const RENAMED: Record<string, string> = {
	honky_tonk_piano: 'honkytonk_piano', clavi: 'clavinet',
	synthstrings_1: 'synth_strings_1', synthstrings_2: 'synth_strings_2',
	synth_voice: 'synth_choir', synthbrass_1: 'synth_brass_1', synthbrass_2: 'synth_brass_2',
	lead_8_bass_lead: 'lead_8_bass__lead', fx_8_sci_fi: 'fx_8_scifi', bag_pipe: 'bagpipe'
};
const available = new Set(getSoundfontNames());
export function soundfontName(program: number): string | null {
	const slug = GM_PROGRAMS[program & 127].toLowerCase().replace(/[()]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
	const name = RENAMED[slug] ?? slug;
	return available.has(name) ? name : null;
}

export interface SampleAsset { preset: SmplrPreset; buffers: Map<string, AudioBuffer> }

export class SampleBank {
	#cache = new Map<number, Promise<SampleAsset>>();
	#disposed = false;
	#loading = new Set<Smplr>();
	constructor(private context: AudioContext) {}

	load(program: number): Promise<SampleAsset> {
		const cached = this.#cache.get(program);
		if (cached) return cached;
		const promise = this.#load(program);
		this.#cache.set(program, promise);
		// An instrument contains many decoded recordings. Bound the retained
		// bank while active players keep their own buffers alive as needed.
		if (this.#cache.size > 4) this.#cache.delete(this.#cache.keys().next().value!);
		return promise;
	}

	async #load(program: number): Promise<SampleAsset> {
		const instrument = soundfontName(program);
		if (!instrument) throw new Error('No recording available for this General MIDI program');
		let asset: SampleAsset | undefined;
		// Soundfont parses and decodes the original soundfont once. Its documented
		// loader hook receives the resulting regions and ready AudioBuffers.
		const loader: SampleLoader = {
			async load(preset, options) {
				const buffers = typeof options === 'object' ? options.buffers : undefined;
				if (!buffers?.size) throw new Error('The soundfont contained no playable recordings');
				asset = { preset, buffers };
				return buffers;
			}
		};
		const sink = this.context.createGain();
		const seed = Soundfont(this.context, { instrument, destination: sink, loader });
		this.#loading.add(seed);
		try {
			await seed.ready;
			if (this.#disposed) throw new Error('Audio engine was disposed');
			if (!asset) throw new Error('No soundfont data was decoded');
			return asset;
		} finally {
			this.#loading.delete(seed);
			seed.dispose();
			sink.disconnect();
		}
	}

	dispose() {
		this.#disposed = true;
		for (const player of this.#loading) player.dispose();
		this.#loading.clear();
		this.#cache.clear();
	}
}
