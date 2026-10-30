<script lang="ts">
	import type { PlotNote } from '#lib/types.ts';
	import { NOTE_COLORS } from '#lib/music/theory.ts';
	import { centsOffset, justCents } from '#lib/harmony/tuning.ts';
	let { notes, ontune, presets=false }: {notes:readonly PlotNote[];ontune:(updates:{id:string;cents:number}[])=>void;presets?:boolean}=$props();
	const editable=$derived(notes.filter((note,i)=>notes.findIndex((other)=>other.midi===note.midi)===i));
	function reference(kind:'equal'|'just') { const root=notes[0]?.midi??48;ontune(notes.map((note)=>({id:note.id,cents:kind==='equal'?0:justCents(note.midi,root)}))); }
	function format(value:number) { return `${value>0?'+':''}${Math.abs(value)<.05?'0.0':value.toFixed(1)}`; }
</script>
<div class="tuning-controls">
	<div class="heading"><h3>Fine tuning</h3>{#if presets}<div class="references" aria-label="Tuning references"><button type="button" disabled={!notes.length} onclick={()=>reference('equal')} title="Reset all selected notes to equal temperament">Equal</button><button type="button" disabled={!notes.length} onclick={()=>reference('just')} title="Tune simple-ratio intervals relative to the first selected note">Just</button></div>{:else}<span>±50 cents</span>{/if}</div>
	{#each editable as note,i (note.id)}
		<label class="tune-row" style:--note-color={NOTE_COLORS[i%3]}>
			<span class="note-label"><i></i>{note.label}<small>{note.frequency.toFixed(1)} Hz</small><output>{format(centsOffset(note))} ¢</output></span>
			<input type="range" aria-label={`Tune ${note.label}`} aria-valuetext={`${format(centsOffset(note))} cents from equal temperament`} min="-50" max="50" step="0.1" value={centsOffset(note)} oninput={(event)=>ontune([{id:note.id,cents:Number(event.currentTarget.value)}])} />
			<span class="ticks" aria-hidden="true"><span>−50</span><span>0</span><span>+50</span></span>
		</label>
	{:else}<p>Play a note to begin tuning.</p>{/each}
	{#if presets}<p class="reference-note">Just uses simple ratios from {notes[0]?.label??'the first note'}. It is a reference, not a universal optimum.</p>{/if}
</div>
<style>
	.tuning-controls{min-width:0}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:17px}.heading h3{font-size:13px;font-weight:550;margin:0}.heading>span{font-size:10px;color:#929292}.references{display:flex;gap:4px}.references button{border:1px solid #363636;border-radius:4px;background:#1b1b1b;color:#d5d5d5;font-size:10px;padding:5px 8px}.references button:hover{background:#303030}.tune-row{display:block;margin-top:15px}.note-label{display:flex;align-items:center;gap:7px;font-size:12px}.note-label i{width:5px;height:5px;border-radius:50%;background:var(--note-color)}.note-label small{font-size:10px;color:#939393}.note-label output{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;color:var(--note-color)}input{display:block;width:100%;margin-top:14px}.ticks{display:flex;justify-content:space-between;color:#777;font-size:9px;margin-top:8px}.reference-note,p{font-size:10px;color:#8c8c8c;line-height:1.6;margin:15px 0 0}.tune-row input:focus-visible{outline-color:var(--note-color)}
</style>
