<script lang="ts">
	import HarmonyCanvas from './HarmonyCanvas.svelte';
	import TuningControls from './TuningControls.svelte';
	import Icon from './Icon.svelte';
	import VisualTransport from './VisualTransport.svelte';
	import type { InspectionFrame } from '#lib/inspection/session.ts';
	import { NOTE_COLORS } from '#lib/music/theory.ts';
	import { partialPairs } from '#lib/harmony/pairs.ts';
	import { centsOffset, MAX_CENTS } from '#lib/harmony/tuning.ts';
	import type { PlotNote } from '#lib/types.ts';
	import type { HarmonicSnapshot, HarmonySceneController, Partial } from '#lib/harmony/types.ts';
	let { view, notes, spectrum, title, frozen, followSound, speed, hasPlayed, sounding, getInspection, ontune, onfreeze, onfollow, onspeed, onplay, onstatus }: {
		view:'overtones'|'tuning';notes:readonly PlotNote[];spectrum:HarmonicSnapshot;title:string;
		frozen:boolean;followSound:boolean;speed:number;hasPlayed:boolean;sounding:boolean;
		getInspection:()=>InspectionFrame;ontune:(updates:{id:string;cents:number}[])=>void;
		onfreeze:()=>void;onfollow:()=>void;onspeed:(value:number)=>void;onplay:()=>void;onstatus:(status:string)=>void;
	}=$props();
	let controller=$state.raw<HarmonySceneController|null>(null);
	let selectedPair=$state<string|null>(null);
	let busy=$state(false);
	let unavailable=$state(false);
	const pairs=$derived(partialPairs(spectrum));
	const pair=$derived(pairs.find((item)=>item.id===selectedPair)??pairs[0]);
	const destination=$derived(pair?notes.find((note)=>note.id===pair.b.voiceId):undefined);
	const alignment=$derived(destination&&pair?centsOffset(destination)+pair.cents:0);
	const canAlign=$derived(!!destination&&Math.abs(alignment)<=MAX_CENTS);
	const sourceLabel=$derived(!notes.length?'Ready to play':spectrum.projected?'Tuning projection':spectrum.source==='preview'?'Modeled preview · Silent':spectrum.source==='waiting'?'Listening for a capture…':sounding?'Measured spectrum':'Measured spectrum · Sound stopped');
	function label(partial:Partial) { return notes.find((note)=>note.id===partial.voiceId)?.label??'Note'; }
	function color(id:string) { return NOTE_COLORS[Math.max(0,notes.findIndex((note)=>note.id===id))%3]; }
	function align() { if(pair&&destination&&canAlign)ontune([{id:destination.id,cents:alignment}]); }
</script>
<div class="harmony-view">
	<div class="scene-column">
		<div class="scene-plot">
		<div class="scene-heading"><div><h1>{title}</h1><p>{view==='overtones'?'Hear what happens between the notes.':'Find the shape of a tuning.'}</p></div><span class="source-state">{sourceLabel}</span></div>
		<div class="note-chips">{#each notes as note,i (note.id)}<span style:--note-color={NOTE_COLORS[i%3]}>{note.label}<small>{note.frequency.toFixed(1)} Hz</small></span>{/each}</div>
		<div class="scene-canvas"><HarmonyCanvas options={{getState:()=>({view,notes,spectrum,frozen,followSound,speed,selectedPair:pair?.id??null}),getInspection,onPickPair:(id)=>selectedPair=id,onTune:ontune,onBusy:(value)=>busy=value,onStatus:(status)=>{unavailable=status==='unavailable';onstatus(status);}}} oncontroller={(value)=>controller=value} /></div>
		{#if unavailable}<div class="scene-message"><Icon name="info" /><p>The visualization could not start.</p><span>You can still play, inspect partials, and tune with the controls.</span></div>{:else if view==='tuning'&&notes.length<3}<div class="scene-message"><Icon name="wave" size={26} /><p>Play at least three notes.</p><span>The surface compares the tuning of the second and third notes.</span></div>{:else if !notes.length}<div class="scene-message"><p>Choose a chord or play a note.</p><button type="button" onclick={onplay}>Play a chord</button></div>{/if}
		{#if notes.length&&!hasPlayed}<button type="button" class="start-playing" onclick={(event)=>{onplay();if(event.detail>0)event.currentTarget.blur();}}><Icon name="play" size={14} />Play this chord</button>{/if}
		<div class="scene-footnote"><span>{view==='overtones'?'One turn = one octave · Select a linked pair':'Drag surface to tune · Drag outside to orbit'}{#if busy}<i>Calculating surface…</i>{/if}</span><span>{view==='tuning'?'Estimated roughness':'Log-frequency space'}</span></div>
		</div>
		<VisualTransport {frozen} {followSound} {speed} hasNotes={notes.length>0} {hasPlayed} {onfreeze} {onfollow} {onspeed} onreplay={onplay}>
			<div class="camera"><button type="button" aria-label="Zoom out" onclick={()=>controller?.zoom(.8)}><Icon name="zoom-out" size={15}/></button><button type="button" aria-label="Zoom in" onclick={()=>controller?.zoom(1.25)}><Icon name="zoom-in" size={15}/></button><button type="button" aria-label="Fit visualization" onclick={()=>controller?.fit()}><Icon name="fit" size={15}/><span>Fit</span></button></div>
		</VisualTransport>
	</div>
	<aside class="inspector" aria-label={view==='overtones'?'Overtone pair inspector':'Tuning inspector'}>
		{#if view==='overtones'}
			<h2>Overtone pair</h2>
			{#if pair}
				<div class="pair-notes">{#each [pair.a,pair.b] as partial (partial.id)}<div><span style:color={color(partial.voiceId)}><i style:background={color(partial.voiceId)}></i>{label(partial)} <small>× {partial.order}</small></span><strong>{partial.frequency.toFixed(1)} <small>Hz</small></strong></div>{/each}</div>
				<div class="difference"><span>Frequency difference</span><strong>{pair.beatHz.toFixed(2)} <small>Hz</small></strong><p>{Math.abs(pair.cents).toFixed(1)} cents apart</p></div>
				<button type="button" class="align-button" disabled={!canAlign} onclick={align} title={canAlign?`Tune ${destination?.label} to ${alignment.toFixed(1)} cents to align these peaks`:'Alignment is outside the ±50-cent tuning range'}><Icon name="fit" size={15} />Align partials</button>
				<p class="inspector-note">{spectrum.projected?'Projected from the last capture while tuning.':spectrum.source==='preview'?'A modeled harmonic preview. Play to inspect the instrument.':'Measured peaks can sit between exact harmonics.'}</p>
			{:else}<p class="empty-pairs">{notes.length<2?'Play two notes to compare their partials.':'No partials fall within 120 cents of one another. Try an instrument with more harmonics.'}</p>{/if}
			<div class="tuning-section"><TuningControls {notes} {ontune} /></div>
			{#if pairs.length>1}<div class="near-pairs"><h3>Nearby partials</h3>{#each pairs.slice(0,6) as item (item.id)}<button type="button" aria-pressed={pair?.id===item.id} class={pair?.id===item.id?'chosen':''} onclick={()=>selectedPair=item.id}><span><i style:background={color(item.a.voiceId)}></i>{label(item.a)} × {item.a.order}<small> / </small>{label(item.b)} × {item.b.order}</span><span>{item.beatHz.toFixed(1)} Hz</span></button>{/each}</div>{/if}
		{:else}
			<h2>Tuning terrain</h2><p class="terrain-intro">A landscape of interactions between partials. Lower valleys mean less estimated sensory roughness.</p>
			<div class="terrain-axes"><span style:color={NOTE_COLORS[1]}>X <b>{notes[1]?.label??'Second note'}</b></span><span style:color={NOTE_COLORS[2]}>Z <b>{notes[2]?.label??'Third note'}</b></span><span>Height <b>Relative roughness</b></span></div>
			<TuningControls {notes} {ontune} presets />
			<p class="model-note">This model estimates beating between partials. It describes a timbre and tuning, not how good a chord sounds.</p>
		{/if}
	</aside>
</div>
<style>
	.harmony-view{display:grid;grid-template-columns:minmax(0,1fr) 258px;height:100%;min-height:0;background:#000}.scene-column{display:flex;flex-direction:column;min-width:0;min-height:450px}.scene-plot{flex:1;position:relative;min-height:300px;overflow:hidden}.scene-heading{position:absolute;inset:26px 27px auto;z-index:2;pointer-events:none;display:flex;justify-content:space-between;gap:14px}.scene-heading h1{font-size:29px;letter-spacing:-1px;font-weight:450;margin:0}.scene-heading p{color:#aaa;font-size:11px;margin:8px 0 0}.source-state{font-size:10px;color:#939393;padding-top:8px;text-align:right;max-width:150px}.note-chips{position:absolute;top:104px;left:27px;right:20px;z-index:2;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none}.note-chips>span{display:flex;align-items:center;gap:10px;border:1px solid color-mix(in srgb,var(--note-color) 45%,transparent);background:#090909c9;color:var(--note-color);padding:6px 8px;font-size:12px;border-radius:4px}.note-chips small{font-size:10px}.scene-canvas{position:absolute;inset:0;min-height:300px}.scene-footnote{position:absolute;bottom:13px;left:22px;right:22px;pointer-events:none;z-index:2;display:flex;justify-content:space-between;gap:14px;color:#888;font-size:10px;line-height:1.5}.scene-footnote>span:last-child{text-align:right}.scene-footnote i{display:block;color:#ccc;font-style:normal;margin-top:5px}.camera{display:flex;gap:4px}.camera button,.start-playing,.align-button,.scene-message button{display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #393939;border-radius:5px;background:#1a1a1a;color:#d9d9d9;font-size:11px;padding:8px 10px;white-space:nowrap}.camera button{min-height:32px;padding:7px}.start-playing{position:absolute;bottom:48px;left:22px;z-index:3;background:#171717e8;padding:10px 16px}.scene-message{position:absolute;top:45%;left:12%;right:12%;z-index:2;display:flex;align-items:center;flex-direction:column;text-align:center;color:#bbb;gap:7px;font-size:12px;pointer-events:none}.scene-message p{margin:5px}.scene-message span{color:#888;font-size:11px;max-width:270px;line-height:1.6}.scene-message button{pointer-events:auto}
	.inspector{border-left:1px solid #2b2b2b;background:#0b0b0b;padding:26px 21px;overflow:auto;min-height:0;scrollbar-width:thin;scrollbar-color:#393939 transparent}.inspector h2{font-size:17px;font-weight:450;letter-spacing:-.3px;margin:0 0 22px}.pair-notes{border-top:1px solid #303030}.pair-notes>div{display:flex;align-items:center;justify-content:space-between;gap:9px;border-bottom:1px solid #303030;padding:17px 0}.pair-notes span{display:flex;align-items:center;gap:6px;font-size:13px}.pair-notes i,.near-pairs i{width:6px;height:6px;border-radius:50%;display:inline-block}.pair-notes small{font-size:11px;font-weight:400}.pair-notes strong{font-size:12px;font-weight:450;color:#ddd;font-variant-numeric:tabular-nums}.difference{padding:23px 0 17px}.difference>span{display:block;font-size:11px;color:#aaa}.difference strong{display:block;font-size:30px;letter-spacing:-1px;font-weight:400;margin-top:8px}.difference strong small{font-size:15px;letter-spacing:0;color:#aaa}.difference p{font-size:10px;color:#777;margin:6px 0 0}.align-button{width:100%;margin-bottom:11px}.inspector-note,.empty-pairs,.terrain-intro,.model-note{font-size:11px;line-height:1.7;color:#999}.tuning-section{padding-top:22px;margin-top:21px;border-top:1px solid #303030}.near-pairs{margin-top:25px;border-top:1px solid #303030;padding-top:18px}.near-pairs h3{font-size:12px;font-weight:500;margin:0 0 11px}.near-pairs button{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:1px solid transparent;background:none;border-radius:4px;padding:8px 6px;color:#aaa;font-size:10px}.near-pairs button>span:first-child{display:flex;align-items:center;gap:5px}.near-pairs button>span:last-child{white-space:nowrap;color:#858585;font-variant-numeric:tabular-nums}.near-pairs button.chosen{border-color:#3d3d3d;background:#202020;color:#eee}.near-pairs button:hover{background:#242424}.terrain-intro{margin:0 0 20px}.terrain-axes{display:grid;gap:12px;border-block:1px solid #2c2c2c;padding:18px 0;margin-bottom:25px;font-size:11px}.terrain-axes span{display:flex;justify-content:space-between}.terrain-axes b{font-weight:450}.model-note{border-top:1px solid #303030;padding-top:18px;margin-top:24px;font-size:10px}
	@media(max-width:1250px){.harmony-view{grid-template-columns:minmax(0,1fr) 225px}.inspector{padding:24px 17px}.scene-heading{inset-inline:21px}.note-chips{left:21px}.source-state{max-width:115px}}
	@media(min-width:701px) and (max-width:1050px){.harmony-view{grid-template-columns:minmax(0,1fr) 210px}.inspector{padding:21px 14px}.scene-heading{display:block}.source-state{display:block;text-align:left;padding-top:7px;max-width:none}.scene-heading h1{font-size:24px}.scene-heading p{display:none}.note-chips{top:103px;gap:4px}.note-chips>span{font-size:10px;padding:5px}.note-chips small{display:none}.scene-footnote>span:last-child{display:none}}
	@media(max-width:700px){.harmony-view{display:flex;flex-direction:column;height:auto}.scene-column{min-height:540px;height:65vh;max-height:690px}.scene-plot{min-height:330px}.inspector{display:block;border-left:0;border-top:1px solid #303030;overflow:visible;padding:23px 22px}.scene-heading{inset:23px 20px auto}.scene-heading h1{font-size:26px}.source-state{max-width:110px;font-size:9px}.scene-heading p{max-width:180px;line-height:1.5}.note-chips{top:110px;left:20px}.scene-footnote{font-size:9px;left:15px;right:15px;bottom:12px}.start-playing{bottom:48px;left:15px}.near-pairs{display:grid;grid-template-columns:1fr 1fr;gap:4px}.near-pairs h3{grid-column:1/-1}.pair-notes>div{padding:14px 0}.tuning-section{margin-top:18px;padding-top:18px}.camera{gap:6px}.camera button{min-width:38px;min-height:38px}}
</style>
