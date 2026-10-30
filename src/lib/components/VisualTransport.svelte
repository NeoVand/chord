<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	let { frozen, followSound, speed, hasNotes, hasPlayed, showSweepDuration=false, onfreeze, onfollow, onspeed, onreplay, children }: {
		frozen:boolean;followSound:boolean;speed:number;hasNotes:boolean;hasPlayed:boolean;showSweepDuration?:boolean;
		onfreeze:()=>void;onfollow:()=>void;onspeed:(speed:number)=>void;onreplay:()=>void;children?:Snippet;
	}=$props();
	const seconds=$derived((1/speed).toFixed(speed>.1?1:0));
	function blurPointer(event:MouseEvent){if(event.detail>0&&event.currentTarget instanceof HTMLElement)event.currentTarget.blur();}
</script>
<div class="visual-transport" aria-label="Visual transport">
	<div class="transport-buttons">
		<button type="button" class={['freeze-button',frozen&&'selected']} aria-pressed={frozen} disabled={!hasNotes&&!frozen} title={frozen?'Resume visual motion':'Pause visual motion; sound continues'} onclick={(event)=>{onfreeze();blurPointer(event);}}><Icon name={frozen?'play':'freeze'} size={16}/>{frozen?'Resume':'Freeze'}</button>
		<button type="button" class={['follow-button',followSound&&'selected']} aria-label="Follow sound" aria-pressed={followSound} title="Motion and glow follow audible output. Turn off to replay captures in silence." onclick={(event)=>{onfollow();blurPointer(event);}}><Icon name="wave" size={15}/>{followSound?'Follow sound':'Free run'}</button>
		{#if hasPlayed}<button type="button" class="replay-button" disabled={!hasNotes} aria-label="Replay selection" title="Replay these notes with their current tuning" onclick={(event)=>{onreplay();blurPointer(event);}}><Icon name="play" size={14}/><span>Replay</span></button>{/if}
	</div>
	<label class="motion-speed"><span>Motion speed</span><input type="range" aria-label="Motion speed" aria-valuetext={`${speed.toFixed(3)} times visual speed${showSweepDuration?`, ${seconds} seconds per sweep`:''}`} min="0.005" max="0.5" step="0.001" value={speed} oninput={(event)=>onspeed(Number(event.currentTarget.value))}/><output>{speed.toFixed(speed<.01?3:2)}×{#if showSweepDuration}<small>{seconds}s / sweep</small>{/if}</output></label>
	{#if children}<div class="view-controls">{@render children()}</div>{/if}
</div>
<style>
	.visual-transport{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;padding:13px 19px;border-top:1px solid #2c2c2c;background:#0b0b0b;flex-shrink:0;min-width:0}.transport-buttons{display:flex;align-items:center;gap:6px}.transport-buttons button{display:flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 9px;border:1px solid #3c3c3c;border-radius:5px;background:#1a1a1a;color:#ccc;font-size:11px;white-space:nowrap}.transport-buttons button.selected{color:#f4f4f4;border-color:#595959;background:#2b2b2b}.transport-buttons button:hover:not(:disabled){background:#323232}.motion-speed{display:flex;align-items:center;gap:10px;flex:1 1 200px;min-width:0;color:#aaa;font-size:10px}.motion-speed>span{white-space:nowrap}.motion-speed input{flex:1;min-width:40px;width:100%}.motion-speed output{color:#d1d1d1;font-size:11px;min-width:39px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.motion-speed output small{display:block;color:#888;font-size:9px;margin-top:3px}.view-controls{display:flex;align-items:center;justify-content:flex-end;gap:7px;margin-left:auto;min-width:0}
	@media(max-width:1100px){.visual-transport{padding:11px 13px;gap:10px}.transport-buttons button{padding:7px;font-size:10px}.motion-speed{order:3;flex-basis:100%}.view-controls{margin-left:0}}
	@media(max-width:700px){.visual-transport{display:grid;grid-template-columns:1fr;gap:12px;padding:12px 15px}.transport-buttons{justify-content:space-between;gap:7px}.transport-buttons button{min-height:38px;padding:7px 10px;font-size:11px}.motion-speed{order:0;min-height:26px}.view-controls{justify-content:center;margin:0}.motion-speed output small{display:inline;margin-left:7px}}
</style>
