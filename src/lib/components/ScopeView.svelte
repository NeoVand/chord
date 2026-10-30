<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import VisualTransport from './VisualTransport.svelte';
	import TuningControls from './TuningControls.svelte';
	import SignalTraces from './SignalTraces.svelte';
	import Spectrum from './Spectrum.svelte';
	import { NOTE_COLORS } from '#lib/music/theory.ts';
	import { resolveAxisIds } from '#lib/inspection/axes.ts';
	import type { InspectionFrame } from '#lib/inspection/session.ts';
	import type { PlotNote, PlotView, ScopeController, SignalMode } from '#lib/types.ts';
	let { visible, notes, title, mode, frame, hasPlayed, frozen, followSound, speed, getInspection, getOutput, onfreeze, onfollow, onspeed, onplay, ontune, onstatus }: {
		visible:boolean;notes:PlotNote[];title:string;mode:SignalMode;frame:InspectionFrame;hasPlayed:boolean;frozen:boolean;followSound:boolean;speed:number;
		getInspection:()=>InspectionFrame;getOutput:()=>AudioNode|null;onfreeze:()=>void;onfollow:()=>void;onspeed:(value:number)=>void;onplay:()=>void;ontune:(updates:{id:string;cents:number}[])=>void;onstatus:(status:string)=>void;
	}=$props();
	let view=$state<PlotView>('3d');
	let requestedAxes=$state<string[]>([]);
	let trail=$state(.12);
	let autoRotate=$state(false);
	let magnification=$state(1);
	let unavailable=$state(false);
	let controller:ScopeController|null=null;
	let canvas:HTMLCanvasElement|undefined;
	const axisIds=$derived(resolveAxisIds(notes,requestedAxes));
	const axisCount=$derived(view==='2d'?2:view==='3d'?3:0);
	const displayedNotes=$derived(view==='waveform'?notes:axisIds.slice(0,axisCount).flatMap((id)=>notes.find((note)=>note.id===id)??[]));
	const missingNotes=$derived(Math.max(0,(axisCount||1)-displayedNotes.length));
	const captured=$derived(!!frame.signal&&!frame.signal.preview);
	const captureLabel=$derived(!notes.length?'Ready to play':frame.signal?.preview?'Silent sine preview':frame.captureStatus==='capturing'?captured?'Previous capture · Updating':'Capturing…':captured?'Captured signal':'No capture yet');
	function noteColor(id:string){return NOTE_COLORS[Math.max(0,notes.findIndex((note)=>note.id===id))%3];}
	function chooseAxis(index:number,id:string){const next=[...axisIds];const other=next.indexOf(id);if(other!==-1&&other!==index)next[other]=next[index];next[index]=id;requestedAxes=next;}
	function attachCanvas(element:HTMLCanvasElement){canvas=element;return()=>{canvas=undefined;};}
	onMount(()=>{
		let disposed=false;
		void import('#lib/visualization/scope.ts').then(async({createScope})=>{
			if(disposed||!canvas)return;
			const scope=await createScope(canvas,{getState:()=>({view,mode,notes,axisIds,speed,frozen,followSound,trail,autoRotate,active:hasPlayed}),getInspection,isVisible:()=>visible,onZoom:(zoom)=>magnification=zoom,onStatus:(status)=>{unavailable=status==='unavailable';onstatus(status);}});
			if(disposed)scope.dispose();else controller=scope;
		}).catch(()=>{if(!disposed){unavailable=true;onstatus('unavailable');}});
		return()=>{disposed=true;controller?.dispose();};
	});
</script>
<div class="scope-view">
	<div class="scope-main">
		<div class="plot-stage">
			<canvas class="scope-canvas" {@attach attachCanvas} aria-label={`${view.toUpperCase()} parametric visualization of ${displayedNotes.map((note)=>note.label).join(', ')||'no active notes'}`}></canvas>
			<div class="plot-heading"><div class="plot-title-row"><h1>{title}</h1>{#if frozen}<span class="frozen-label">Frozen</span>{/if}</div><div class="axis-notes">{#each displayedNotes as note,i (note.id)}<span style:--axis-color={noteColor(note.id)}><b>{view==='waveform'?'~':['X','Y','Z'][i]}</b>{note.label}<small>{note.frequency.toFixed(1)} Hz</small></span>{/each}</div>{#if missingNotes&&notes.length}<p class="view-hint">Play {missingNotes===1?'one more note':`${missingNotes} more notes`} for a {view==='3d'?'3D':view==='2d'?'2D':'waveform'} curve.</p>{/if}</div>
			<div class="view-tabs" aria-label="Visualization view">{#each [{id:'waveform',label:'Waveform'},{id:'2d',label:'2D'},{id:'3d',label:'3D'}] as tab (tab.id)}<button type="button" class={view===tab.id?'active':''} aria-pressed={view===tab.id} onclick={()=>view=tab.id as PlotView}>{tab.label}</button>{/each}</div>
			<div class="canvas-status"><i class={captured?'captured':''}></i>{captureLabel}{#if hasPlayed&&notes.length}<span class="output-state">{frame.transport.audible?'Audible':'Silent'}</span>{/if}</div>
			{#if unavailable}<div class="empty-stage"><Icon name="info" size={25}/><p>The visualization could not start.</p><small>The captured signals and tuning controls are still available.</small></div>{:else if !notes.length}<div class="empty-stage"><Icon name="wave" size={30}/><p>Play a note, or choose a chord.</p><button type="button" onclick={onplay}>Play a chord</button></div>{:else if !hasPlayed}<button class="play-preview" type="button" onclick={(event)=>{onplay();if(event.detail>0)event.currentTarget.blur();}}><Icon name="play" size={15}/>Play this chord</button>{/if}
			<p class="canvas-hint">{view==='3d'?'Drag to orbit · Shift-drag to pan · Scroll to zoom':'Drag to pan · Scroll to zoom'}</p>
		</div>
		<VisualTransport {frozen} {followSound} {speed} hasNotes={notes.length>0} {hasPlayed} showSweepDuration {onfreeze} {onfollow} {onspeed} onreplay={onplay}>
			<button type="button" class={['orbit-button',autoRotate&&'active']} disabled={view!=='3d'} aria-label="Automatically orbit the shape" aria-pressed={autoRotate} title="Automatically orbit the 3D shape" onclick={()=>autoRotate=!autoRotate}><Icon name="orbit" size={16}/><span>Orbit</span></button>{#if view==='3d'}<button type="button" class="camera-button" aria-label="Reset rotation" title="Reset 3D rotation" onclick={()=>controller?.resetView()}><Icon name="reset" size={14}/></button>{/if}
			<div class="zoom-controls" aria-label="Magnification"><button type="button" aria-label="Zoom out" title="Zoom out" onclick={()=>controller?.zoom(.8)}><Icon name="zoom-out" size={14}/></button><output aria-label="Current magnification">{magnification.toFixed(magnification>=10?0:1)}×</output><button type="button" aria-label="Zoom in" title="Zoom in" onclick={()=>controller?.zoom(1.25)}><Icon name="zoom-in" size={14}/></button><button type="button" class="fit-button" aria-label="Fit curve" title="Fit and center the complete curve" onclick={()=>controller?.fitView()}><Icon name="fit" size={14}/><span>Fit</span></button></div>
		</VisualTransport>
	</div>
	<aside class="scope-inspector" aria-label="Scope inspector">
		<h2>{view==='waveform'?'Individual waves':'Shape axes'}</h2>
		{#if view!=='waveform'}<div class="axis-selectors">{#each ['X','Y','Z'].slice(0,axisCount) as axis,i (axis)}<label><span>{axis}</span><select aria-label={`${axis} axis note`} value={axisIds[i]??''} disabled={notes.length<=i} onchange={(event)=>chooseAxis(i,event.currentTarget.value)}>{#if !axisIds[i]}<option value="" disabled>Play another note</option>{/if}{#each notes as note (note.id)}<option value={note.id}>{note.label} · {note.frequency.toFixed(1)} Hz</option>{/each}</select></label>{/each}</div><p class="inspector-note">Choose any held or captured note for an axis. Choosing an assigned note swaps the axes.</p>{:else}<p class="inspector-note">All {notes.length} selected {notes.length===1?'voice':'voices'}, from the same captured window.</p>{/if}
		<div class="scope-traces">{#if visible}<SignalTraces {notes} {view} {getInspection} getProgress={()=>controller?.getTraceProgress()??getInspection().transport.progress}/>{/if}</div>
		<div class="tuning-section"><TuningControls {notes} {ontune} presets/></div>
		<label class="tail-control"><span>Tail length<output>{Math.round(trail*100)}%</output></span><input type="range" aria-label="Tail length" aria-valuetext={`${Math.round(trail*100)} percent of the curve`} min="0.02" max="0.35" step="0.005" bind:value={trail}/></label>
		<div class="output-spectrum">{#if visible}<Spectrum getSource={getOutput}/>{/if}<p>Live output after volume. The captured waves stay available when sound stops.</p></div>
	</aside>
</div>
<style>
	.scope-view{display:grid;grid-template-columns:minmax(0,1fr) 258px;height:100%;min-height:0;background:#000}.scope-main{display:flex;flex-direction:column;min-width:0;min-height:450px}.plot-stage{flex:1;min-height:300px;position:relative;isolation:isolate;overflow:hidden;background:#000}.scope-canvas{display:block;position:absolute;inset:0;width:100%;height:100%;outline:none;touch-action:none}.plot-heading{position:absolute;left:26px;top:26px;right:20px;pointer-events:none;z-index:1}.plot-title-row{display:flex;align-items:center;gap:10px}.plot-heading h1{font-size:29px;line-height:1.2;letter-spacing:-1px;font-weight:450;margin:0 0 13px;color:#eee}.frozen-label{font-size:10px;padding:3px 7px;border-radius:4px;background:#333;color:#ccc;margin-top:-10px}.axis-notes{display:flex;gap:6px;flex-wrap:wrap;padding-right:10px}.axis-notes>span{display:flex;align-items:baseline;gap:7px;padding:5px 7px;border:1px solid color-mix(in srgb,var(--axis-color) 35%,transparent);border-radius:4px;background:#111b;color:var(--axis-color);font-size:12px}.axis-notes b{font-size:10px;font-weight:450;opacity:.7}.axis-notes small{font-size:10px}.view-tabs{position:absolute;right:20px;top:23px;display:flex;gap:3px;border:1px solid #3a3a3a;border-radius:6px;padding:3px;background:#121212c9;z-index:2}.view-tabs button{padding:6px 10px;border:1px solid transparent;border-radius:4px;color:#aaa;font-size:11px;background:none}.view-tabs button.active{border-color:#666;background:#303030;color:#eee}.canvas-status{position:absolute;left:26px;top:135px;display:flex;align-items:center;gap:7px;color:#888;font-size:10px;pointer-events:none}.output-state{border-left:1px solid #444;padding-left:7px;margin-left:2px;color:#aaa}.canvas-status i{width:4px;height:4px;border-radius:50%;background:#777}.canvas-status i.captured{background:#bbb}.view-hint{font-size:11px;color:#aaa;line-height:1.5;margin-top:10px}.canvas-hint{position:absolute;bottom:13px;left:22px;right:16px;margin:0;color:#888;font-size:10px;pointer-events:none}.play-preview,.empty-stage button{display:flex;align-items:center;gap:8px;border:1px solid #414141;border-radius:5px;background:#151515df;color:#ddd;font-size:11px;padding:10px 13px}.play-preview{position:absolute;bottom:48px;left:22px}.empty-stage{position:absolute;left:15%;right:15%;top:42%;display:flex;flex-direction:column;align-items:center;text-align:center;color:#999;font-size:12px;gap:9px}.empty-stage p{margin:0}.empty-stage small{font-size:10px;line-height:1.6}.scope-inspector{min-height:0;overflow:auto;scrollbar-width:thin;padding:26px 20px;border-left:1px solid #2c2c2c;background:#0b0b0b}.scope-inspector h2{font-size:17px;font-weight:450;margin:0 0 20px}.axis-selectors{display:grid;gap:8px}.axis-selectors label{display:flex;align-items:center;gap:10px;border:1px solid #393939;background:#191919;border-radius:5px;padding:7px 9px}.axis-selectors label>span{font-size:11px;color:#aaa}.axis-selectors select{appearance:auto;font-size:11px;min-width:0;width:100%;border:0;background:none;color:#ddd;padding:2px 0;box-shadow:none}.inspector-note{font-size:10px;line-height:1.7;color:#909090;margin:12px 0 20px}.scope-traces{padding-bottom:22px}.tuning-section{padding-top:22px;border-top:1px solid #303030}.tail-control{display:block;margin-top:24px;padding-top:20px;border-top:1px solid #303030;color:#aaa;font-size:11px}.tail-control>span{display:flex;justify-content:space-between;margin-bottom:13px}.tail-control output{color:#888;font-size:10px}.tail-control input{width:100%}.output-spectrum{padding-top:23px;margin-top:25px;border-top:1px solid #303030}.output-spectrum p{font-size:10px;color:#858585;line-height:1.6;margin:15px 0 0}.camera-button,.orbit-button,.zoom-controls button{display:flex;align-items:center;justify-content:center;gap:5px;min-height:32px;padding:6px 8px;color:#bbb;background:#191919;border:1px solid #383838;border-radius:4px;font-size:10px}.orbit-button.active{background:#303030;color:#fff;border-color:#666}.zoom-controls{display:flex;align-items:center;gap:4px}.zoom-controls output{font-size:10px;color:#aaa;min-width:33px;text-align:center;font-variant-numeric:tabular-nums}.zoom-controls .fit-button{margin-left:3px}.camera-button:hover,.orbit-button:hover,.zoom-controls button:hover{color:#fff;background:#303030}
	@media(max-width:1250px){.scope-view{grid-template-columns:minmax(0,1fr) 225px}.scope-inspector{padding:23px 16px}.view-tabs{top:20px;right:17px}.plot-heading{top:66px;left:20px}.plot-heading h1{font-size:26px}.canvas-status{left:20px;top:170px}.axis-notes small{display:none}}
	@media(min-width:701px) and (max-width:1000px){.scope-view{grid-template-columns:minmax(0,1fr) 210px}.scope-inspector{padding-inline:14px}.orbit-button span{display:none}.plot-heading h1{font-size:24px}}
	@media(max-width:700px){.scope-view{display:flex;flex-direction:column;height:auto}.scope-main{min-height:540px;height:65vh;max-height:690px}.plot-stage{min-height:330px}.scope-inspector{border-left:0;border-top:1px solid #303030;overflow:visible;padding:24px 22px}.plot-heading{top:65px;left:20px}.view-tabs{top:14px;right:15px}.view-tabs button{min-height:31px}.canvas-status{left:20px;top:165px;font-size:9px}.axis-notes{gap:4px}.axis-notes>span{font-size:11px}.view-hint{font-size:10px}.canvas-hint{left:15px;bottom:13px;font-size:9px}.play-preview{left:15px;bottom:43px}.camera-button,.orbit-button,.zoom-controls button{min-width:40px;min-height:40px}.orbit-button{padding-inline:6px}.zoom-controls output{min-width:31px}.scope-traces{max-width:none}.output-spectrum{max-width:none}}
</style>
