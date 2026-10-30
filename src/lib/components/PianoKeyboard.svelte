<script lang="ts">
	// Adapted from MIDI Lab's Keyboard.svelte: physical key geometry, octave strip,
	// computer mapping and pointer-height velocity. Audio is supplied by the parent.
	import { onDestroy } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { noteName } from '#lib/music/theory.ts';
	let {
		active = [], scale = [], colors = {}, base = 36, keysEnabled = true, velocity = null,
		onNoteOn, onNoteOff, onOctave
	}: {
		active?: number[]; scale?: number[]; colors?: Record<number, string>; base?: number;
		keysEnabled?: boolean; velocity?: number | null;
		onNoteOn: (note: number, velocity: number, id: string) => void;
		onNoteOff: (id: string) => void; onOctave: (base: number) => void;
	} = $props();
	const TYPE_MAP: Record<string, number> = {
		KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
		KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
		KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17
	};
	const TYPE_CAP = Object.fromEntries(Object.entries(TYPE_MAP).map(([key, offset]) => [offset,
		key === 'Semicolon' ? ';' : key === 'Quote' ? "'" : key.replace('Key', '')]));
	const black = (note: number) => [1, 3, 6, 8, 10].includes(note % 12);
	const whites = Array.from({ length: 109 }, (_, note) => note).filter((note) => !black(note));
	const blacks = Array.from({ length: 109 }, (_, note) => note).filter(black);
	const NUDGE: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.15, 8: 0, 10: 0.15 };
	const width = 100 / whites.length;
	const offset = $derived((whites.findIndex((note) => note >= base) / whites.length) * 100);
	const typed = new SvelteMap<string, number>();
	const pointers = new SvelteMap<number, number>();
	const accessible = new SvelteSet<number>();
	let focused = $state(48);
	const focusNote = $derived(Math.max(base, Math.min(base + 36, focused)));
	let bed: HTMLDivElement | undefined;
	let keyboardNavigation=false;

	function captureBed(element: HTMLDivElement) { bed = element; return () => { bed = undefined; }; }
	function cap(note: number) { return keysEnabled ? TYPE_CAP[note - (base + 12)] ?? '' : ''; }
	function blackCenter(note: number) {
		return (whites.filter((white) => white < note).length + NUDGE[note % 12]) * width;
	}
	function hitVelocity(event: PointerEvent, element: HTMLElement) {
		if (velocity !== null) return velocity;
		const rect = element.getBoundingClientRect();
		const t = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
		return Math.round(24 + Math.pow(t, 0.85) * 103);
	}
	function pointerDown(note: number, event: PointerEvent) {
		if (event.button !== 0 && event.pointerType === 'mouse') return;
		event.preventDefault();
		(document.activeElement as HTMLElement)?.blur();
		const target = event.currentTarget as HTMLButtonElement;
		target.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, note);
		onNoteOn(note, hitVelocity(event, target), `pointer:${event.pointerId}:${note}`);
	}
	function pointerMove(event: PointerEvent) {
		const previous = pointers.get(event.pointerId);
		if (previous === undefined) return;
		const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-note]');
		if (!target || !bed?.contains(target)) return;
		const note = Number(target.dataset.note);
		if (note === previous) return;
		onNoteOff(`pointer:${event.pointerId}:${previous}`);
		pointers.set(event.pointerId, note);
		onNoteOn(note, hitVelocity(event, target), `pointer:${event.pointerId}:${note}`);
	}
	function pointerUp(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) return;
		onNoteOff(`pointer:${event.pointerId}:${pointers.get(event.pointerId)}`);
		pointers.delete(event.pointerId);
	}
	function releaseAll() {
		for (const [code,note] of typed) onNoteOff(`typing:${code}:${note}`);
		for (const [id,note] of pointers) onNoteOff(`pointer:${id}:${note}`);
		for (const note of accessible) onNoteOff(`accessible:${note}`);
		typed.clear(); pointers.clear(); accessible.clear();
	}
	function typingBlocked(event: KeyboardEvent) {
		return event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
			(event.target instanceof Element && (!!event.target.closest('input, select, textarea, dialog, [contenteditable="true"], [role="dialog"], [role="button"]:focus') || keyboardNavigation && !!event.target.closest('button:focus-visible')));
	}
	function keyDown(event: KeyboardEvent) {
		if(['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))keyboardNavigation=true;
		if (!keysEnabled || typingBlocked(event)) return;
		if (event.code === 'KeyZ' || event.code === 'KeyX') {
			event.preventDefault(); if (event.repeat) return;
			releaseAll(); onOctave(Math.max(0, Math.min(72, base + (event.code === 'KeyX' ? 12 : -12)))); return;
		}
		const semitones = TYPE_MAP[event.code];
		if (semitones === undefined || typed.has(event.code)) return;
		event.preventDefault(); const note = base + 12 + semitones;
		typed.set(event.code, note); onNoteOn(note, velocity ?? 96, `typing:${event.code}:${note}`);
	}
	function keyUp(event: KeyboardEvent) {
		if (!typed.has(event.code)) return;
		onNoteOff(`typing:${event.code}:${typed.get(event.code)}`); typed.delete(event.code);
	}
	function keyboardKey(event: KeyboardEvent, note: number) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault(); if (event.repeat || accessible.has(note)) return;
			accessible.add(note); onNoteOn(note, velocity ?? 96, `accessible:${note}`); return;
		}
		const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!delta) return;
		event.preventDefault(); focused = Math.max(base, Math.min(base + 36, note + delta));
		bed?.querySelector<HTMLButtonElement>(`[data-note="${focused}"]`)?.focus();
	}
	function accessibleOff(note: number) {
		if (accessible.delete(note)) onNoteOff(`accessible:${note}`);
	}
	onDestroy(releaseAll);
</script>

<svelte:window onpointerdown={()=>keyboardNavigation=false} onkeydown={keyDown} onkeyup={keyUp} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp} onblur={releaseAll} />
<svelte:document onvisibilitychange={() => { if (document.hidden) releaseAll(); }} />

<div class="keyboard-scroll">
	<div class="keybed" {@attach captureBed} role="group" aria-label="Musical keyboard. A through apostrophe play notes; Z and X change octave.">
		<div class="key-strip" style:width={`${(whites.length / 22) * 100}%`} style:transform={`translateX(-${offset}%)`}>
			<div class="white-keys">
				{#each whites as note (note)}
					{@const selected = active.includes(note)}
					<button type="button" class={['white-key', selected && 'sounding', scale.includes(note % 12) && 'in-scale']}
						data-note={note} aria-label={noteName(note)} aria-pressed={selected} tabindex={note === focusNote ? 0 : -1}
						style:--note-color={colors[note] ?? 'var(--cyan)'}
						onpointerdown={(event) => pointerDown(note, event)} onkeydown={(event) => keyboardKey(event, note)}
						onkeyup={(event) => { if (event.key === ' ' || event.key === 'Enter') accessibleOff(note); }} onblur={() => accessibleOff(note)}>
						<span class="scale-dot"></span>
						<span class="note-label">{note % 12 === 0 || selected ? noteName(note) : ''}</span>
						<span class="key-cap">{cap(note)}</span>
					</button>
				{/each}
			</div>
			{#each blacks as note (note)}
				{@const selected = active.includes(note)}
				<button type="button" class={['black-key', selected && 'sounding', scale.includes(note % 12) && 'in-scale']}
					data-note={note} aria-label={noteName(note)} aria-pressed={selected} tabindex={note === focusNote ? 0 : -1}
					style:left={`${blackCenter(note) - width * 0.583 / 2}%`} style:width={`${width * 0.583}%`}
					style:--note-color={colors[note] ?? 'var(--cyan)'}
					onpointerdown={(event) => pointerDown(note, event)} onkeydown={(event) => keyboardKey(event, note)}
					onkeyup={(event) => { if (event.key === ' ' || event.key === 'Enter') accessibleOff(note); }} onblur={() => accessibleOff(note)}>
					<span class="scale-dot"></span><span class="key-cap">{cap(note)}</span>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.keyboard-scroll { overflow-x:auto; scrollbar-width:thin; scrollbar-color:#505050 transparent; }
	.keybed { height:148px; min-width:650px; position:relative; overflow:hidden; touch-action:none; background:#101010; border:1px solid #090909; border-radius:0 0 6px 6px; }
	.key-strip { position:absolute; inset-block:0; left:0; transition:transform 280ms cubic-bezier(.2,.6,.3,1); }
	.white-keys { display:flex; height:100%; }
	.white-key { flex:1; min-width:0; position:relative; padding:0; border:0; border-right:1px solid #9b9b9b; border-radius:0 0 4px 4px; background:linear-gradient(#c2c2c2 0%,#e7e7e7 8%,#f3f3f3 88%,#c7c7c7 100%); box-shadow:inset 0 -4px 0 #94949466,inset -1px 0 3px #00000022; color:#3a3a3a; }
	.white-key:hover { background:linear-gradient(#d2d2d2,#ffffff 80%,#d6d6d6); }
	.white-key.sounding { color:#102126; background:linear-gradient(color-mix(in srgb,var(--note-color) 82%,#fff),var(--note-color) 85%,color-mix(in srgb,var(--note-color) 82%,#000)); border-right-color:#222; box-shadow:inset 0 2px 0 #ffffff66,inset 0 -4px 0 #0003; transform:translateY(1px); }
	.black-key { position:absolute; top:0; height:62%; padding:0; border:1px solid #090909; border-radius:0 0 4px 4px; background:linear-gradient(100deg,#303030,#191919 70%,#2f2f2f); box-shadow:0 4px 5px #00000088,inset 0 -4px 0 #3f3f3f; color:#c7c7c7; z-index:1; }
	.black-key:hover { background:linear-gradient(100deg,#454545,#282828); }
	.black-key.sounding { color:#102126; background:linear-gradient(color-mix(in srgb,var(--note-color) 84%,#fff),var(--note-color) 80%,color-mix(in srgb,var(--note-color) 75%,#000)); border-color:var(--note-color); box-shadow:0 3px 6px #0008,inset 0 -3px 0 #0004; transform:translateY(1px); }
	.key-cap { position:absolute; left:0; right:0; bottom:13px; font-size:11px; font-weight:600; line-height:1; pointer-events:none; }
	.note-label { position:absolute; left:0; right:0; bottom:35px; font-size:11px; font-weight:600; pointer-events:none; }
	.black-key .key-cap { bottom:11px; font-size:10px; }
	.scale-dot { position:absolute; width:3px; height:3px; border-radius:50%; left:calc(50% - 1.5px); bottom:57px; background:#3e3e3e60; opacity:0; pointer-events:none; }
	.in-scale .scale-dot { opacity:1; }
	.white-key.sounding .scale-dot { background:#11111188; }
	.black-key.sounding .scale-dot { background:#11111188; }
	.black-key .scale-dot { bottom:31px; background:#c0c0c04d; }
	button:focus-visible { outline:2px solid #979797; outline-offset:-3px; z-index:2; }
	@media (prefers-reduced-motion:reduce) { .key-strip { transition:none; } }
	@media (min-height:900px) { .keybed { height:168px; } }
</style>
