<script lang="ts">
	// Adapted from MIDI Lab Scope.svelte: audioMotion on the actual output bus,
	// logarithmic semitone bands and independent, correctly placed octave labels.
	import AudioMotionAnalyzer from 'audiomotion-analyzer';
	let { getSource }: { getSource: () => AudioNode | null } = $props();
	const minFreq = 40;
	const maxFreq = 16000;
	const octaves = Array.from({ length: 7 }, (_, i) => ({ label: `C${i + 2}`, frequency: 65.406 * 2 ** i })).map((tick) => ({...tick,left:Math.log2(tick.frequency/minFreq)/Math.log2(maxFreq/minFreq)*100}));
	function mount(element: HTMLDivElement) {
		let analyzer: AudioMotionAnalyzer | null = null;
		let frame = 0;
		const tick = () => {
			const source = getSource();
			if (source && !analyzer) {
				analyzer = new AudioMotionAnalyzer(element, {
					source, connectSpeakers:false, mode:2, frequencyScale:'log', minFreq, maxFreq,
					ansiBands:false, showScaleX:false, showScaleY:false, showBgColor:false, overlay:true,
					showPeaks:true, peakFadeTime:800, peakHoldTime:250, smoothing:.65, fftSize:8192,
					colorMode:'gradient', roundBars:false, alphaBars:false, channelLayout:'single', barSpace:.3
				});
				analyzer.registerGradient('chord', { bgColor:'transparent', colorStops:[{pos:0,color:'#d2d2d2'},{pos:.55,color:'#747474'},{pos:1,color:'#3b3b3b'}] });
				analyzer.gradient = 'chord';
			}
			if (!analyzer) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => { cancelAnimationFrame(frame); analyzer?.destroy(); };
	}
</script>

<div class="spectrum">
	<div class="spectrum-caption"><span>Output spectrum</span><span>Hz</span></div>
	<div class="spectrum-plot"><div class="spectrum-grid" aria-hidden="true">{#each octaves as tick (tick.label)}<i style:left={`${tick.left}%`}></i>{/each}</div><div class="spectrum-host" {@attach mount} role="img" aria-label="Live sound spectrum, one bar per semitone"></div></div>
	<div class="spectrum-scale" aria-hidden="true">{#each octaves as tick (tick.label)}<span style:left={`${tick.left}%`}>{tick.label}</span>{/each}</div>
</div>

<style>
	.spectrum { width:100%; pointer-events:none; }
	.spectrum-caption { display:flex; justify-content:space-between; color:#a8a8a8; font-size:10px; margin-bottom:7px; }
	.spectrum-caption span:last-child { color:#6a6a6a; }
	.spectrum-plot { height:63px; position:relative; border-bottom:1px solid #3e3e3e53; }
	.spectrum-host,.spectrum-grid { position:absolute; inset:0; }
	.spectrum-grid i { position:absolute; top:0; bottom:0; border-left:1px solid #40404029; }
	.spectrum-scale { height:14px; position:relative; }
	.spectrum-scale span { position:absolute; top:3px; transform:translateX(-50%); color:#a1a1a1; font-size:10px; }
</style>
