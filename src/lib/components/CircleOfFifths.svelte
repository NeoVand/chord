<script lang="ts">
	// MIDI Lab's playable wheel, reduced to its instrument surface. The wedge
	// geometry and arrow-key navigation are retained; both rings now play.
	import { FIFTHS } from '#lib/music/theory.ts';
	let { root = 0, scaleId = 'major', scaleLabel = 'Major', tonic = 'C', onselect }: {
		root?: number; scaleId?: string; scaleLabel?: string; tonic?: string;
		onselect: (root: number, scale: string) => void;
	} = $props();
	const center = 160;
	const step = Math.PI / 6;
	let keyboardNavigation = $state(false);
	const minor = $derived(scaleId === 'minor');
	const index = $derived(FIFTHS.findIndex((key) => key.root === (minor ? (root + 3) % 12 : root)));
	function polar(radius: number, item: number) {
		const angle = item * step - Math.PI / 2;
		return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
	}
	function wedge(item: number, inside: number, outside: number) {
		const begin = (item - 0.5) * step - Math.PI / 2 + 0.008;
		const end = (item + 0.5) * step - Math.PI / 2 - 0.008;
		const point = (radius: number, angle: number) => `${center + radius * Math.cos(angle)} ${center + radius * Math.sin(angle)}`;
		return `M ${point(inside, begin)} L ${point(outside, begin)} A ${outside} ${outside} 0 0 1 ${point(outside, end)} L ${point(inside, end)} A ${inside} ${inside} 0 0 0 ${point(inside, begin)} Z`;
	}
	function pick(item: number, isMinor: boolean) { onselect((FIFTHS[item].root + (isMinor ? 9 : 0)) % 12, isMinor ? 'minor' : 'major'); }
	function activate(event: MouseEvent, item: number, isMinor: boolean) {
		pick(item,isMinor);
		if(event.detail>0)(event.currentTarget as SVGElement).blur();
	}
	function navigate(event: KeyboardEvent, item: number, isMinor: boolean) {
		if (event.key === 'Enter' || event.key === ' ') { keyboardNavigation = true; event.preventDefault(); pick(item, isMinor); return; }
		const offset = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
		if (!offset && event.key !== 'Home') return;
		keyboardNavigation = true;
		event.preventDefault(); const target = event.key === 'Home' ? 0 : (item + offset + 12) % 12;
		(event.currentTarget as SVGElement).ownerSVGElement?.querySelector<SVGPathElement>(`[data-key="${target}-${isMinor}"]`)?.focus();
		pick(target, isMinor);
	}
</script>

<svelte:window onpointerdown={() => { keyboardNavigation = false; }} onkeydown={(event) => { if (event.key === 'Tab') keyboardNavigation = true; }} />

<svg class={['fifths-wheel', keyboardNavigation && 'keyboard-navigation']} viewBox="0 0 320 320" role="group" aria-label={`Circle of fifths. ${tonic} ${scaleLabel.toLowerCase()}. Outer ring major, inner ring minor. Use arrow keys to explore.`}>
	<defs>
		<radialGradient id="wheel-surface"><stop offset="0" stop-color="#2e2e2e" /><stop offset="1" stop-color="#171717" /></radialGradient>
		<linearGradient id="wheel-selection" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9ae7f1" /><stop offset="1" stop-color="#61c9dc" /></linearGradient>
	</defs>
	<circle cx={center} cy={center} r="153" fill="url(#wheel-surface)" stroke="#4c4c4c" stroke-width="0.6" />
	{#each FIFTHS as key, i (key.root)}
		{@const label = polar(129, i)}
		{@const minorLabel = polar(87, i)}
		{@const near = (index + 1) % 12 === i || (index + 11) % 12 === i}
		<g>
			<path d={wedge(i, 105, 153)} class={['wedge', index === i && !minor && 'selected', near && 'neighbor']}
				role="button" tabindex={index === i ? 0 : -1} data-key={`${i}-false`} aria-label={`Play ${key.label} major`} aria-pressed={index === i && !minor}
				onclick={(event) => activate(event, i, false)} onkeydown={(event) => navigate(event, i, false)} />
			<text x={label.x} y={label.y + 5} text-anchor="middle" class={['major-label', index === i && !minor && 'selected-label']} aria-hidden="true">{key.label}</text>
			<path d={wedge(i, 67, 104)} class={['wedge', 'minor-wedge', index === i && minor && 'selected']}
				role="button" tabindex={index === i ? 0 : -1} data-key={`${i}-true`} aria-label={`Play ${key.minor.replace(/m$/, "")} minor`} aria-pressed={index === i && minor}
				onclick={(event) => activate(event, i, true)} onkeydown={(event) => navigate(event, i, true)} />
			<text x={minorLabel.x} y={minorLabel.y + 4} text-anchor="middle" class={['minor-label', index === i && minor && 'selected-label']} aria-hidden="true">{key.minor.endsWith('m') ? key.minor : `${key.minor}m`}</text>
		</g>
	{/each}
	<circle cx={center} cy={center} r="65" fill="#181818" stroke="#434343" stroke-width="0.7" />
	<text x={center} y={center + 5} text-anchor="middle" class="tonic" aria-hidden="true">{tonic}</text>
	<text x={center} y={center + 27} text-anchor="middle" class="mode" aria-hidden="true">{scaleLabel.toLowerCase()}</text>
</svg>

<style>
	.fifths-wheel { display:block; width:100%; max-width:320px; margin:0 auto; overflow:visible; }
	/* SVG outlines follow the bounding box. The path's stroke is the focus ring. */
	.wedge { fill:transparent; stroke:#4c4c4c; stroke-width:.6; cursor:pointer; outline:none; }
	.wedge:focus { outline:none; }
	.wedge.neighbor { fill:#32323280; }
	.wedge:hover { fill:#4d4d4d; stroke:#acacac; }
	.wedge.selected { fill:url(#wheel-selection); stroke:#b4f2fa; stroke-width:1; }
	.keyboard-navigation .wedge:focus { stroke:#ffffff; stroke-width:2; }
	.minor-wedge { fill:#21212180; }
	.major-label,.minor-label,.tonic,.mode { pointer-events:none; user-select:none; fill:#e4e4e4; font-family:inherit; }
	.major-label { font-size:15px; font-weight:600; }
	.minor-label { font-size:10px; fill:#bababa; }
	.selected-label { fill:#102c33; font-weight:700; }
	.tonic { font-size:36px; font-weight:400; letter-spacing:-2px; }
	.mode { font-size:11px; fill:#afafaf; }
</style>
