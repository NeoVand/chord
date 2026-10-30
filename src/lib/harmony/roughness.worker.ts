import { roughnessSurface } from './roughness';
import type { VoiceSpectrum } from './types';
self.onmessage = ({ data }: MessageEvent<{ key: string; voices: VoiceSpectrum[] }>) => {
	const surface = roughnessSurface(data.voices);
	self.postMessage({ key: data.key, surface }, { transfer: [surface.values.buffer] });
};
