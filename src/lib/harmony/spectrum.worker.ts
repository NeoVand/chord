import { analyseSpectrum } from './spectrum';
import type { PlotNote } from '../types';

self.onmessage = ({ data }: MessageEvent<{ key: string; notes: PlotNote[]; channels: Float32Array[]; sampleRate: number }>) => {
	const voices = data.notes.map((note, index) => ({ id: note.id, note, partials: analyseSpectrum(data.channels[index], data.sampleRate, note.frequency, note.id) }));
	self.postMessage({ key: data.key, voices });
};
