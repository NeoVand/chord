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
	import Github from '@lucide/svelte/icons/github';
	let { name, size = 18 }: { name: string; size?: number } = $props();
	const icons = {
		play:Play, pause:Pause, stop:Square, chevron:ChevronDown, left:ChevronLeft, right:ChevronRight,
		volume:Volume2, midi:Cable, keyboard:Piano, typing:Keyboard, freeze:Pause, orbit:Orbit,
		reset:RotateCcw, 'zoom-in':Plus, 'zoom-out':Minus, capture:Scan, fit:Focus, expand:Maximize,
		collapse:Minimize, close:X, search:Search, wave:AudioWaveform, info:CircleHelp, panel:PanelLeft, check:Check, github:Github
	};
	const Glyph = $derived(icons[name as keyof typeof icons] ?? AudioWaveform);
</script>

<Glyph {size} strokeWidth={1.6} aria-hidden="true" />
