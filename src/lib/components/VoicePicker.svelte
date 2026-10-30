<script lang="ts">
	// Adapted from MIDI Lab's grouped, searchable General MIDI VoicePicker.
	import { tick } from 'svelte';
	import { GM_PROGRAMS, GM_FAMILIES } from '#lib/audio/programs.ts';
	import Icon from './Icon.svelte';
	let { value = 0, disabled = false, synth = false, onchange }: { value?: number; disabled?: boolean; synth?: boolean; onchange: (program: number) => void } = $props();
	let open = $state(false);
	let query = $state('');
	let host: HTMLDivElement | undefined;
	let search: HTMLInputElement | undefined;
	const id = $props.id();
	const families = $derived(GM_FAMILIES.map((family, f) => ({ family, programs:
		Array.from({ length: synth ? 1 : 8 }, (_, i) => f * 8 + i).filter((program) => {
			const text = `${GM_PROGRAMS[program]} ${family}`.toLowerCase();
			return query.toLowerCase().trim().split(/\s+/).filter(Boolean).every((word) => text.includes(word) || Number(word) === program + 1);
		})
	})).filter((group) => group.programs.length));
	function attachHost(element: HTMLDivElement) { host = element; return () => { host = undefined; }; }
	function attachSearch(element: HTMLInputElement) { search = element; return () => { search = undefined; }; }
	async function toggle() { open = !open; query = ''; if (open) { await tick(); search?.focus(); } }
	function close() { open = false; host?.querySelector<HTMLButtonElement>('.voice-trigger')?.focus(); }
	function choose(program: number, event: MouseEvent) { onchange(program);if(event.detail===0)close();else {open=false;(document.activeElement as HTMLElement)?.blur();} }
	function outside(event: PointerEvent) { if (open && event.target instanceof Node && !host?.contains(event.target)) open = false; }
	function options() { return [...host?.querySelectorAll<HTMLButtonElement>('[data-voice-option]') ?? []]; }
	function searchKey(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); options().at(event.key === 'ArrowDown' ? 0 : -1)?.focus(); }
		if (event.key === 'Enter') { event.preventDefault(); options()[0]?.click(); }
	}
	function optionKey(event: KeyboardEvent) {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault(); const buttons = options(); const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
		if (event.key === 'Home') buttons[0]?.focus();
		else if (event.key === 'End') buttons.at(-1)?.focus();
		else if (event.key === 'ArrowUp' && index === 0) search?.focus();
		else buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
	}
</script>

<svelte:window onpointerdown={outside} onkeydown={(event) => { if (open && event.key === 'Escape') { event.preventDefault(); close(); } }} />
<div class="voice-picker" {@attach attachHost}>
	<button type="button" class="voice-trigger" {disabled} aria-expanded={open} aria-controls={`${id}-menu`} aria-label="Choose instrument" onclick={toggle}>
		<Icon name="keyboard" size={18} /><span>{synth ? `${GM_FAMILIES[Math.floor(value/8)]} synth` : GM_PROGRAMS[value] ?? 'Acoustic Grand Piano'}</span><Icon name="chevron" size={15} />
	</button>
	{#if open}
		<div class="voice-menu" id={`${id}-menu`} role="dialog" aria-label="Choose an instrument" tabindex="-1">
			<div class="search-row"><Icon name="search" size={17} /><input {@attach attachSearch} type="search" bind:value={query} placeholder="Search instruments or families…" aria-label="Search instruments" onkeydown={searchKey} autocomplete="off" /><button type="button" class="close-picker" aria-label="Close instrument picker" onclick={close}><Icon name="close" size={16} /></button></div>
			<div class="voice-results">
				{#each families as family (family.family)}
					<p class="family-name">{family.family}</p><div class="family-options">
					{#each family.programs as program (program)}
						<button type="button" data-voice-option class={['voice-option', (synth ? Math.floor(value/8)===Math.floor(program/8) : value === program) && 'chosen']} aria-pressed={synth ? Math.floor(value/8)===Math.floor(program/8) : value === program} onclick={(event) => choose(program,event)} onkeydown={optionKey}><span class="program-number">{String(program + 1).padStart(3, '0')}</span><span>{synth ? `${family.family} synth` : GM_PROGRAMS[program]}</span>{#if synth ? Math.floor(value/8)===Math.floor(program/8) : value === program}<Icon name="check" size={14} />{/if}</button>
					{/each}</div>
				{:else}<p class="no-results">No instruments found. Try a different name.</p>{/each}
			</div><div class="picker-footer">{synth ? '16 synthesized families' : '128 sampled instruments'} <span>↑ ↓ navigate · Enter select</span></div>
		</div>
	{/if}
</div>

<style>
	.voice-picker { position:relative; min-width:0; width:252px; }
	.voice-trigger { display:flex; align-items:center; gap:10px; width:100%; min-height:37px; padding:0 11px; background:#1e1e1e; border:1px solid #444444; border-radius:6px; color:#e9e9e9; font-size:11px; }
	.voice-trigger > span { flex:1; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.voice-trigger:disabled { opacity:.5; cursor:default; }
	.voice-menu { position:absolute; bottom:calc(100% + 14px); left:0; z-index:30; width:430px; max-width:calc(100vw - 36px); overflow:hidden; border:1px solid #4f4f4f; border-radius:12px; background:#1d1d1d; box-shadow:0 14px 80px #00000088; }
	.search-row { display:flex; align-items:center; gap:9px; padding:12px; border-bottom:1px solid #404040; color:#a5a5a5; }
	.search-row input { min-width:0; flex:1; padding:6px 0; color:#efefef; background:none; border:0; outline:none; font:inherit; font-size:12px; }
	.close-picker { display:grid; place-items:center; color:#b2b2b2; padding:4px; border:0; background:none; }
	.voice-results { padding:9px; overflow-y:auto; max-height:min(390px,52vh); }
	.family-name { margin:14px 7px 6px; font-size:11px; font-weight:600; color:#a3a3a3; }
	.family-options { display:grid; grid-template-columns:1fr 1fr; gap:3px; }
	.voice-option { display:flex; align-items:center; gap:7px; text-align:left; border:0; background:none; color:#e0e0e0; padding:8px 6px; font-size:11px; border-radius:4px; }
	.voice-option:hover,.voice-option:focus-visible { background:#383838; }
	.voice-option.chosen { color:#cecece; background:#323232; }
	.program-number { color:#8d8d8d; font-size:10px; font-variant-numeric:tabular-nums; }
	.picker-footer { display:flex; justify-content:space-between; gap:8px; padding:10px 13px; border-top:1px solid #383838; color:#a0a0a0; font-size:10px; }
	.picker-footer span { color:#b7b7b7; }
	.no-results { padding:24px 12px; font-size:12px; color:#bababa; }
	@media(max-width:600px) { .voice-picker { width:100%; } .voice-menu { position:fixed; left:12px; right:12px; bottom:12px; width:auto; max-width:none; z-index:60; } }
</style>
