<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Square from '@lucide/svelte/icons/square';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import Cable from '@lucide/svelte/icons/cable';
	import Piano from '@lucide/svelte/icons/piano';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Orbit from '@lucide/svelte/icons/orbit';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Plus from '@lucide/svelte/icons/plus';
	import Minus from '@lucide/svelte/icons/minus';
	import Scan from '@lucide/svelte/icons/scan';
	import Focus from '@lucide/svelte/icons/focus';
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minimize from '@lucide/svelte/icons/minimize';
	import X from '@lucide/svelte/icons/x';
	import Search from '@lucide/svelte/icons/search';
	import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import Check from '@lucide/svelte/icons/check';
	let { name, size = 18 }: { name: string; size?: number } = $props();
	const icons = {
		play:Play, pause:Pause, stop:Square, chevron:ChevronDown, left:ChevronLeft, right:ChevronRight,
		volume:Volume2, midi:Cable, keyboard:Piano, typing:Keyboard, freeze:Pause, orbit:Orbit,
		reset:RotateCcw, 'zoom-in':Plus, 'zoom-out':Minus, capture:Scan, fit:Focus, expand:Maximize,
		collapse:Minimize, close:X, search:Search, wave:AudioWaveform, info:CircleHelp, panel:PanelLeft, check:Check
	};
	const Glyph = $derived(icons[name as keyof typeof icons] ?? AudioWaveform);
</script>

{#if name==='github'}
<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
{:else}<Glyph {size} strokeWidth={1.6} aria-hidden="true" />{/if}
