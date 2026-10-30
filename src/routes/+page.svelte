<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Icon from '#lib/components/Icon.svelte';
	import CircleOfFifths from '#lib/components/CircleOfFifths.svelte';
	import PianoKeyboard from '#lib/components/PianoKeyboard.svelte';
	import VoicePicker from '#lib/components/VoicePicker.svelte';
	import Spectrum from '#lib/components/Spectrum.svelte';
	import SignalTraces from '#lib/components/SignalTraces.svelte';
	import HarmonyView from '#lib/components/HarmonyView.svelte';
	import ChordAtlas from '#lib/components/ChordAtlas.svelte';
	import { SpectrumCapture } from '#lib/harmony/spectrum-capture.ts';
	import { tunedFrequency, clampCents } from '#lib/harmony/tuning.ts';
	import { SoundActivity } from '#lib/visualization/activity.ts';
	import type { Workspace, HarmonicSnapshot } from '#lib/harmony/types.ts';
	import { ChordAudio } from '#lib/audio/chord-audio.ts';
	import { FIFTHS, SCALES, INTERVALS, NOTE_COLORS, noteName, scaleNotes, scaleNames, diatonicChords, type Chord } from '#lib/music/theory.ts';
	import type { PlotNote, PlotView, SignalMode, ScopeController, AudioStatus } from '#lib/types.ts';

	let workspace = $state<Workspace>('overtones');
	let harmonicView = $state<'overtones'|'tuning'>('overtones');
	let harmonicSpeed = $state(.1);
	let centsByMidi = $state<Record<number,number>>({});
	let spectrum = $state.raw<HarmonicSnapshot>({revision:0,source:'preview',projected:false,voices:[]});
	let stopToken = $state(0);
	let audible = $state(false);
	let analysis: SpectrumCapture | null = null;
	const outputActivity = new SoundActivity();
	let root = $state(0);
	let scaleId = $state('major');
	let explorerTab = $state<'chords' | 'intervals'>('chords');
	let selectedChord = $state('C');
	let selectedInterval = $state(7);
	let selectionTitle = $state('C major');
	let view = $state<PlotView>('3d');
	let mode = $state<SignalMode>('instrument');
	let instrumentEngine = $state<'sampled' | 'synth'>('sampled');
	let program = $state(0);
	let volume = $state(.55);
	let latch = $state(true);
	let keysEnabled = $state(true);
	let velocity = $state<number | null>(null);
	let base = $state(36);
	let speed = $state(.05);
	let trail = $state(.12);
	let magnification = $state(1);
	let captureState = $state<'capturing'|'ready'|'preview'|'idle'>('preview');
	let frozen = $state(false);
	let followSound = $state(true);
	let autoRotate = $state(false);
	let immersive = $state(false);
	let fullscreenActive = $state(false);
	let hasPlayed = $state(false);
	let held = $state<Record<string, PlotNote>>({});
	let retainedNotes = $state<PlotNote[]>([]);
	let frozenNotes = $state<PlotNote[]>([]);
	let gpuStatus = $state('Starting renderer');
	let audioStatus = $state<AudioStatus>({state:'idle',message:'Ready when you are'});
	let notice = $state('');
	let midiLabel = $state('Connect MIDI');
	let midiConnected = $state(false);
	let audio: ChordAudio | null = null;
	let scope: ScopeController | null = null;
	let canvas: HTMLCanvasElement | undefined;
	let app: HTMLElement | undefined;
	let help: HTMLDialogElement | undefined;
	let midi: MIDIAccess | null = null;
	let chordTimer: ReturnType<typeof setTimeout> | undefined;
	const physical = new SvelteSet<string>();
	const pedal = new SvelteSet<string>();
	const previewNotes = $derived([48,52,55].map((midi,i) => ({id:`preview:${i}`,midi,frequency:tunedFrequency(midi,centsByMidi[midi]??0),label:noteName(midi)})));
	const scale = $derived(SCALES.find((item) => item.id === scaleId) ?? SCALES[0]);
	const tonic = $derived(FIFTHS.find((key) => key.root === root)?.label ?? 'C');
	const pitches = $derived(scaleNotes(root,scaleId));
	const pitchNames = $derived(scaleNames(root,scaleId));
	const chords = $derived(diatonicChords(root,scaleId));
	const liveNotes = $derived(Object.values(held));
	const plotNotes = $derived(frozen ? frozenNotes : liveNotes.length ? liveNotes : hasPlayed ? retainedNotes : previewNotes);
	const displayedNotes = $derived(plotNotes.slice(0,view === '2d' ? 2 : view === '3d' ? 3 : 8));
	const sounding = $derived(liveNotes.length > 0);
	const requiredNotes = $derived(view==='3d' ? 3 : view==='2d' ? 2 : 1);
	const missingNotes = $derived(Math.max(0,requiredNotes-plotNotes.length));
	const keyColors = $derived(Object.fromEntries(plotNotes.map((note,i) => [note.midi,NOTE_COLORS[i%3]])));
	const title = $derived(plotNotes.length ? selectionTitle : 'Find your next shape');
	const interval = $derived(INTERVALS.find((item) => item.semitones === selectedInterval) ?? INTERVALS[7]);
	const sweepSeconds = $derived((1/speed).toFixed(speed > .1 ? 1 : 0));
	const captureLabel = $derived(!hasPlayed ? 'Silent sine preview' : !plotNotes.length ? 'Ready to play' : !sounding ? 'Sound stopped · Last capture' : captureState==='capturing' ? 'Capturing…' : mode==='pure' ? 'Pure tones' : captureState==='ready' ? 'Captured signal' : 'Waiting for signal');

	function captureCanvas(element: HTMLCanvasElement) { canvas=element; return () => { canvas=undefined; }; }
	function captureApp(element: HTMLElement) { app=element; return () => { app=undefined; }; }
	function captureHelp(element: HTMLDialogElement) { help=element; return () => { help=undefined; }; }
	function fail(error: unknown) { notice=error instanceof Error ? error.message : 'Sound could not start. Try playing again.'; }
	function playVoice(note: PlotNote, strike=96, options?: {retriggerHeld?: boolean}) { void audio?.noteOn(note.id,note.midi,strike,note.frequency,options).catch(fail); }
	function stopVoices() { clearTimeout(chordTimer); audio?.allNotesOff(); held={}; physical.clear(); pedal.clear(); }
	function stopSound() {
		stopToken++;
		if(hasPlayed && plotNotes.length && captureState==='ready')retainedNotes=plotNotes.map((note)=>({...note}));
		else if(hasPlayed){retainedNotes=[];frozenNotes=[];}
		stopVoices();
	}
	function prepareSourceChange() {
		if(sounding&&frozen)frozenNotes=liveNotes.map((note)=>({...note}));
		else if(hasPlayed&&!sounding){retainedNotes=[];frozenNotes=[];selectionTitle='';}
	}
	function makeNote(midi: number,id: string): PlotNote { return {id,midi,frequency:tunedFrequency(midi,centsByMidi[midi]??0),label:noteName(midi)}; }
	function playNotes(notes: number[],label: string,sequence=false,preserveTuning=false) {
		if(!sequence)stopToken++;
		if(!preserveTuning)centsByMidi={};
		analysis?.clear();scope?.clearSignals();
		stopVoices();retainedNotes=[];hasPlayed=true; notice=''; selectionTitle=label;
		const next=Object.fromEntries(notes.map((midi,i)=>{const note=makeNote(midi,`chord:${i}:${midi}`);return [note.id,note];}));
		held=next;if(frozen)frozenNotes=Object.values(next).map((note)=>({...note})); for(const note of Object.values(next)) playVoice(note,velocity??88);
		if(!latch) chordTimer=setTimeout(()=>{if(!latch) stopSound();},1400);
	}
	function playChord(chord: Chord,preserveTuning=false) {
		selectedChord=chord.name;
		const rootName=chord.name.replace(/(?:dim|sus2|sus4|m|\+)$/,'');
		playNotes(chord.notes,`${rootName} ${chord.quality}`,false,preserveTuning);
	}
	function chooseKey(nextRoot: number,nextScale=scaleId) {
		root=nextRoot; scaleId=nextScale;
		const chord=diatonicChords(root,scaleId)[0];
		if(explorerTab==='intervals') playInterval(selectedInterval); else if(chord) playChord(chord);
	}
	function playInterval(semitones: number,preserveTuning=false) {
		selectedInterval=semitones; selectedChord='';
		playNotes([48+root,48+root+semitones],INTERVALS.find((item)=>item.semitones===semitones)?.label ?? 'Interval',false,preserveTuning);
	}
	function playPreview() {
		if(hasPlayed&&plotNotes.length){playNotes(plotNotes.map((note)=>note.midi),selectionTitle,false,true);return;}
		const chord=chords.find((item)=>item.name===selectedChord)??chords[0];
		if(explorerTab==='intervals')playInterval(selectedInterval,true);else if(chord)playChord(chord,true);
	}
	function tuneNotes(updates: {id:string;cents:number}[]) {
		const available=[...plotNotes,...liveNotes];const next={...centsByMidi};
		for(const update of updates){const note=available.find((item)=>item.id===update.id);if(note)next[note.midi]=clampCents(update.cents);}
		if(Object.keys(next).every((midi)=>next[Number(midi)]===(centsByMidi[Number(midi)]??0)))return;
		centsByMidi=next;
		const retune=(note:PlotNote)=>({...note,frequency:tunedFrequency(note.midi,next[note.midi]??0)});
		held=Object.fromEntries(liveNotes.map((note)=>[note.id,retune(note)]));
		frozenNotes=frozenNotes.map(retune);retainedNotes=retainedNotes.map(retune);
		scope?.clearSignals();audio?.setFrequencies(Object.values(held).map((note)=>({id:note.id,frequency:note.frequency})));
	}
	function changeWorkspace(next:Workspace){workspace=next;if(next==='overtones'||next==='tuning')harmonicView=next;}
	function workspaceKey(event:KeyboardEvent){
		const tabs:Workspace[]=['overtones','tuning','chords','scope'];const index=tabs.indexOf(workspace);
		const target=event.key==='ArrowRight'?tabs[(index+1)%4]:event.key==='ArrowLeft'?tabs[(index+3)%4]:event.key==='Home'?tabs[0]:event.key==='End'?tabs[3]:null;
		if(target){event.preventDefault();changeWorkspace(target);document.getElementById(`tab-${target}`)?.focus();}
	}
	function playAtlas(notes:number[],label:string,sequence=false){selectedChord='';playNotes(notes,label,sequence);}
	function harmonyStatus(status:string){gpuStatus=status==='webgpu'?'WebGPU':status==='webgl'?'WebGL fallback':'Renderer unavailable';}
	function noteOn(midi: number,strike: number,id: string) {
		stopToken++;
		clearTimeout(chordTimer);retainedNotes=[]; hasPlayed=true; notice='';
		if(Object.keys(held).some((key)=>key.startsWith('chord:'))) stopVoices();
		const existing=Object.values(held).find((note)=>note.midi===midi&&!physical.has(note.id));
		physical.add(id);
		if(latch && existing && !id.startsWith('midi:')) {
			audio?.noteOff(existing.id);
			const previous=Object.values(held);const next={...held};delete next[existing.id];held=next;
			if(Object.keys(next).length){scope?.clearSignals();analysis?.clear();audio?.retriggerHeld();selectionTitle=Object.values(next).map((note)=>note.label).join(' · ');if(frozen)frozenNotes=Object.values(next).map((note)=>({...note}));}
			else retainedNotes=previous;
			return;
		}
		if(!held[id] && Object.keys(held).length>=8){const oldest=Object.keys(held)[0];audio?.noteOff(oldest);const remaining={...held};delete remaining[oldest];held=remaining;physical.delete(oldest);}
		const note=makeNote(midi,id); held={...held,[id]:note};
		const retriggerHeld=latch&&!id.startsWith('midi:');
		if(retriggerHeld){scope?.clearSignals();analysis?.clear();}
		playVoice(note,strike,{retriggerHeld});
		if(frozen)frozenNotes=Object.values(held).map((item)=>({...item}));
		selectedChord=''; selectionTitle=Object.values(held).map((item)=>item.label).join(' · ');
	}
	function noteOff(id: string) {
		physical.delete(id);
		const group=id.startsWith('midi:')?id.split(':').slice(0,-1).join(':'):'';
		if(latch || pedal.has(group)) return;
		audio?.noteOff(id); const previous=Object.values(held);const next={...held};delete next[id];held=next;
		if(!Object.keys(next).length && previous.length)retainedNotes=previous;
		if(!frozen && !selectedChord && Object.keys(next).length)selectionTitle=Object.values(next).map((note)=>note.label).join(' · ');
	}
	function changeLatch() { latch=!latch;if(!latch)for(const id of Object.keys(held))if(!physical.has(id))noteOff(id); }
	function changeView(next: PlotView) { view=next; }
	function toggleFreeze() { if(!frozen) frozenNotes=plotNotes.map((note)=>({...note})); else if(!selectedChord && liveNotes.length)selectionTitle=liveNotes.map((note)=>note.label).join(' · '); frozen=!frozen; }
	function changeMode(next: SignalMode) {
		if(next===mode)return;
		prepareSourceChange();scope?.clearSignals();analysis?.clear();mode=next;
		if(next==='instrument')audio?.setProgram(program);
		audio?.setSource(next==='pure'?'pure':instrumentEngine);
	}
	function changeEngine(next: 'sampled'|'synth') {
		if(next===instrumentEngine)return;
		instrumentEngine=next;
		if(mode==='instrument'){prepareSourceChange();scope?.clearSignals();analysis?.clear();audio?.setSource(next);}
	}
	function changeProgram(next: number) {
		if(next===program)return;
		program=next;
		if(mode==='instrument'){prepareSourceChange();scope?.clearSignals();analysis?.clear();audio?.setProgram(next);}
	}
	function changeVolume(next: number) { volume=next;audio?.setVolume(next); }
	async function fullscreen() { try { if(document.fullscreenElement)await document.exitFullscreen();else if(app?.requestFullscreen)await app.requestFullscreen();else immersive=!immersive; }catch { immersive=!immersive; } }
	function globalKey(event: KeyboardEvent) {
		if((event.ctrlKey||event.metaKey)&&event.code==='Period') { event.preventDefault();stopSound(); }
		if(event.key==='Escape'&&immersive&&!help?.open&&!event.defaultPrevented&&!(event.target instanceof Element&&event.target.closest('[role="dialog"],dialog')))immersive=false;
	}
	function handleMidi(event: MIDIMessageEvent) {
		const bytes=event.data; if(!bytes||bytes.length<3)return;
		const port=event.target as MIDIInput; const channel=bytes[0]&15;const command=bytes[0]&240;
		const group=`midi:${port.id}:${channel}`;const id=`${group}:${bytes[1]}`;
		if(command===144&&bytes[2]>0)noteOn(bytes[1],bytes[2],id);
		else if(command===128||command===144)noteOff(id);
		else if(command===176&&bytes[1]===64) {
			if(bytes[2]>=64)pedal.add(group);
			else {pedal.delete(group);for(const heldId of Object.keys(held))if(heldId.startsWith(`${group}:`)&&!physical.has(heldId))noteOff(heldId);}
		} else if(command===176&&(bytes[1]===120||bytes[1]===123))stopSound();
	}
	function refreshMidi() {
		const inputs=[...midi?.inputs.values()??[]].filter((input)=>input.state==='connected');
		for(const input of inputs)input.onmidimessage=handleMidi;
		midiConnected=inputs.length>0;midiLabel=inputs.length?inputs[0].name??'MIDI connected':'No MIDI device';
	}
	async function connectMidi() {
		if(!navigator.requestMIDIAccess){notice='Web MIDI is unavailable in this browser. You can still play with the on-screen or computer keyboard.';return;}
		try {midi=await navigator.requestMIDIAccess({sysex:false});midi.onstatechange=()=>{refreshMidi();stopVoices();};refreshMidi();notice=midiConnected?'':'Connect a MIDI keyboard and it will appear automatically.';}
		catch {notice='MIDI access was not granted. The on-screen and computer keyboards are ready to play.';}
	}
	onMount(()=>{
		if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){frozenNotes=plotNotes.map((note)=>({...note}));frozen=true;}
		let disposed=false;
		analysis=new SpectrumCapture();
		audio=new ChordAudio({onChunk:(chunk)=>{scope?.push(chunk);analysis?.push(chunk);},onStatus:(status)=>{audioStatus=status;}});
		audio.setVolume(volume); audio.setSource(instrumentEngine);
		const readAnalysis=()=>{if(document.hidden)return;spectrum=analysis?.read(plotNotes,mode,hasPlayed)??spectrum;outputActivity.update(audio?.getOutputLevel()??0,.1);audible=outputActivity.audible;};
		readAnalysis();const analysisTimer=setInterval(readAnalysis,100);
		void import('#lib/visualization/scope.ts').then(async ({createScope})=>{
			if(!canvas||disposed)return;
			const renderer=await createScope(canvas,{
				getState:()=>({view,mode,notes:plotNotes,speed,frozen,followSound,trail,autoRotate,active:hasPlayed}),
				getOutputLevel:()=>audio?.getOutputLevel?.()??0,
					isVisible:()=>workspace==='scope',
				onStatus:(status)=>{gpuStatus=status==='webgpu'?'WebGPU':status==='webgl'?'WebGL fallback':'Renderer unavailable';},
				onZoom:(zoom)=>{magnification=zoom;},
				onCapture:(status)=>{captureState=status;}
			});
			if(disposed)renderer.dispose();else scope=renderer;
		}).catch((error)=>{gpuStatus='Renderer unavailable';fail(error);});
		return()=>{disposed=true;clearInterval(analysisTimer);analysis?.dispose();clearTimeout(chordTimer);scope?.dispose();audio?.dispose();for(const input of midi?.inputs.values()??[])input.onmidimessage=null;if(midi)midi.onstatechange=null;};
	});
</script>

<svelte:head><title>Chord — sound in shape</title><meta name="description" content="One playable instrument, four ways to explore sound: measured overtones, tuning terrain, chord relationships, and waveform or Lissajous scopes." /></svelte:head>
<svelte:window onkeydown={globalKey} onblur={stopSound} />
<svelte:document onvisibilitychange={()=>{if(document.hidden)stopSound();}} onfullscreenchange={()=>{fullscreenActive=!!document.fullscreenElement;}} />

<main class={['app-shell',workspace!=='scope'&&'harmony-workspace',immersive&&'immersive']} {@attach captureApp}>
	<header class="app-header">
		<div class="brand"><span class="brand-mark"><Icon name="wave" size={25} /></span><span>chord</span><span class="brand-divider"></span><span class="brand-caption">Sound in shape</span></div>
		<div class="workspace-tabs" role="tablist" aria-label="Workspace">{#each [{id:'overtones',label:'Overtones'},{id:'tuning',label:'Tuning'},{id:'chords',label:'Chords'},{id:'scope',label:'Scope'}] as tab (tab.id)}<button type="button" role="tab" id={`tab-${tab.id}`} aria-controls={tab.id==='overtones'||tab.id==='tuning'?'workspace-harmony':`workspace-${tab.id}`} aria-selected={workspace===tab.id} tabindex={workspace===tab.id?0:-1} onclick={()=>changeWorkspace(tab.id as Workspace)} onkeydown={workspaceKey}>{tab.label}</button>{/each}</div>
		<div class="header-actions"><a class="icon-button source-link" href="https://github.com/NeoVand/chord" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" title="View source on GitHub"><Icon name="github" size={18} /></a><button type="button" class={['midi-button',midiConnected&&'connected']} onclick={connectMidi} title={midiLabel}><Icon name="midi" size={16} /><span>{midiConnected?'MIDI connected':midiLabel}</span>{#if midiConnected}<i></i>{/if}</button><button type="button" class="icon-button" aria-label="Keyboard shortcuts and controls" title="Keyboard shortcuts and controls" onclick={()=>help?.showModal()}><Icon name="info" size={17} /></button><button type="button" class="icon-button" aria-label={immersive?'Show explorer':'Hide explorer'} title={immersive?'Show explorer':'Hide explorer'} aria-pressed={immersive} onclick={()=>immersive=!immersive}><Icon name="panel" size={17} /></button></div>
	</header>
	<div class="workspace">
		<aside class="explorer" aria-label="Chord explorer">
			<div class="explorer-caption"><span>Explore</span><span class="explore-detail">Circle of fifths</span></div>
			<div class="key-selectors"><label><span>Key</span><select aria-label="Key" value={root} onchange={(event)=>chooseKey(Number(event.currentTarget.value))}>{#each [...FIFTHS].sort((a,b)=>a.root-b.root) as key (key.root)}<option value={key.root}>{key.label}</option>{/each}</select></label><label class="scale-selector"><span>Scale</span><select aria-label="Scale" value={scaleId} onchange={(event)=>chooseKey(root,event.currentTarget.value)}>{#each SCALES as item (item.id)}<option value={item.id}>{item.label}</option>{/each}</select></label></div>
			<div class="wheel-wrap"><CircleOfFifths {root} {scaleId} scaleLabel={scaleId==='minor'?'Minor':scale.label} {tonic} onselect={chooseKey} /></div>
			<div class="scale-notes" aria-label={`${tonic} ${scale.label} notes`}>{#each pitchNames as note (note)}<span>{note}</span>{/each}</div>
			<div class="explorer-tabs" aria-label="Explore chords or intervals"><button type="button" class={explorerTab==='chords'?'active':''} aria-pressed={explorerTab==='chords'} onclick={()=>explorerTab='chords'}>Chords</button><button type="button" class={explorerTab==='intervals'?'active':''} aria-pressed={explorerTab==='intervals'} onclick={()=>explorerTab='intervals'}>Intervals</button></div>
			{#if explorerTab==='chords'}
				<div class="chord-pads">{#each chords as chord (chord.name)}<button type="button" class={selectedChord===chord.name?'chosen':''} aria-pressed={selectedChord===chord.name} aria-label={`Play ${chord.name} chord`} onclick={(event)=>{playChord(chord);if(event.detail>0)event.currentTarget.blur();}}><span>{chord.name}</span><small>{chord.roman}</small></button>{/each}</div>
				<p class="explorer-hint">Choose a chord to play it.</p>
			{:else}
				<div class="interval-pads">{#each INTERVALS as item (item.semitones)}<button type="button" class={selectedInterval===item.semitones?'chosen':''} aria-pressed={selectedInterval===item.semitones} title={item.label} aria-label={`Play ${item.label}`} onclick={(event)=>{playInterval(item.semitones);if(event.detail>0)event.currentTarget.blur();}}>{item.short}</button>{/each}</div><p class="interval-name">{interval.label}<span>{selectedInterval} semitones</span></p>
			{/if}
			<div class="explorer-bottom"><span class="tuning-dot"></span><span>{Object.values(centsByMidi).some((value)=>Math.abs(value)>.01)?'Custom tuning':'Equal temperament'}</span><span>A4 440 Hz</span></div>
		</aside>
		<section class="stage-column" aria-label="Musical visualization">
			<div class="signal-bar"><div class="signal-switch" aria-label="Sound and signal mode"><button type="button" class={mode==='instrument'?'active':''} aria-pressed={mode==='instrument'} onclick={()=>changeMode('instrument')}><Icon name="keyboard" size={14} />Instrument</button><button type="button" class={mode==='pure'?'active':''} aria-pressed={mode==='pure'} onclick={()=>changeMode('pure')}><Icon name="wave" size={15} />Pure tones</button></div><span class="signal-caption">{mode==='instrument'?'Captured sound, including harmonics.':'Pure sine waves.'}</span><div class="signal-actions">{#if mode==='instrument' && hasPlayed && sounding}<button type="button" class="recapture-button" disabled={workspace==='scope'&&captureState==='capturing'} title="Capture a fresh analysis window" onclick={()=>{scope?.recapture();analysis?.recapture();}}><Icon name="capture" size={15} /><span>Recapture</span></button>{/if}<button type="button" class="icon-button" aria-label={fullscreenActive?'Exit fullscreen':'Fullscreen visualization'} title={fullscreenActive?'Exit fullscreen':'Fullscreen visualization'} onclick={fullscreen}><Icon name={fullscreenActive?'collapse':'expand'} size={17} /></button></div></div>
			<div class="scope-panel" id="workspace-scope" role="tabpanel" aria-labelledby="tab-scope" hidden={workspace!=='scope'} inert={workspace!=='scope'}>
			<div class="view-tabs" aria-label="Visualization view">{#each [{id:'waveform',label:'Waveform'},{id:'2d',label:'2D'},{id:'3d',label:'3D'}] as tab (tab.id)}<button type="button" class={view===tab.id?'active':''} aria-pressed={view===tab.id} onclick={()=>changeView(tab.id as PlotView)}>{tab.label}</button>{/each}</div>
			<div class="plot-stage">
				<canvas class="scope-canvas" {@attach captureCanvas} aria-label={`${view.toUpperCase()} parametric visualization of ${displayedNotes.map((note)=>note.label).join(', ')||'no active notes'}`}></canvas>
				<div class="plot-heading"><div class="plot-title-row"><h1>{title}</h1>{#if frozen}<span class="frozen-label">Frozen</span>{/if}</div><div class="axis-notes">{#each displayedNotes as note,i (note.id)}<span style:--axis-color={NOTE_COLORS[i%3]}><b>{view==='waveform'?'~':['X','Y','Z'][i]??'~'}</b>{note.label}<small>{note.frequency.toFixed(1)} Hz</small></span>{/each}</div>{#if plotNotes.length>displayedNotes.length}<p class="axis-overflow">First {displayedNotes.length} of {plotNotes.length} voices plotted</p>{/if}{#if plotNotes.length && missingNotes}<p class="view-hint">Play {missingNotes===1?'one more note':`${missingNotes} more notes`} for a {view==='3d'?'3D':'2D'} curve.</p>{/if}</div>
				<div class="canvas-status"><i class={captureState==='ready'?'captured':''}></i>{captureLabel}</div>
				{#if !hasPlayed}<button class="play-preview" type="button" onclick={(event)=>{playPreview();if(event.detail>0)event.currentTarget.blur();}}><span><Icon name="play" size={15} /></span>Play this chord<small>or use the keyboard below</small></button>{:else if !plotNotes.length}<div class="empty-stage"><Icon name="wave" size={30} /><p>Play a note, or choose a chord.</p><button type="button" onclick={playPreview}>Play {tonic} {scaleId==='minor'?'minor':'major'}</button></div>{/if}
				{#if workspace==='scope'}<div class="trace-inset"><SignalTraces notes={plotNotes} getSamples={()=>scope?.getDisplaySamples()??[]} getProgress={()=>scope?.getTraceProgress()??0} getActivity={()=>scope?.getSignalActivity?.()??0} /></div>
				<div class="spectrum-inset"><Spectrum getSource={()=>audio?.output??null} /></div>{/if}
			</div>
			<div class="visual-controls">
				<div class="motion-controls"><button class={['freeze-button',frozen&&'selected']} type="button" aria-pressed={frozen} disabled={!plotNotes.length&&!frozen} title={frozen?'Resume the sweep and waveform probes':'Pause the sweep, waveform probes, and automatic orbit'} onclick={toggleFreeze}><Icon name={frozen?'play':'freeze'} size={17} />{frozen?'Resume':'Freeze'}</button><button type="button" class={['follow-button',followSound&&'selected']} aria-label="Follow sound" aria-pressed={followSound} title={followSound?'Motion and glow follow audible output. Turn off to replay the capture in silence.':'Free-running capture. Turn on to make motion and glow follow audible output.'} onclick={(event)=>{followSound=!followSound;if(event.detail>0)event.currentTarget.blur();}}><Icon name="wave" size={15} /><span>{followSound?'Follow sound':'Free run'}</span><i></i></button></div>
				<label class="speed-control"><span>Sweep speed</span><input type="range" aria-label="Sweep speed" aria-valuetext={`${sweepSeconds} seconds per sweep`} min="0.005" max="0.5" step="0.001" bind:value={speed} /><output>{sweepSeconds}s <small>/ sweep</small></output></label>
				<label class="trail-control"><span>Tail length</span><input type="range" aria-label="Tail length" aria-valuetext={`${Math.round(trail*100)} percent of the curve`} min="0.02" max="0.35" step="0.005" bind:value={trail} /></label>
				<div class="camera-controls">
					<button type="button" class={['orbit-button',autoRotate&&'active']} disabled={view!=='3d'} aria-label="Automatically orbit the shape" aria-pressed={autoRotate} title="Automatically orbit the 3D shape" onclick={()=>autoRotate=!autoRotate}><Icon name="orbit" size={16} /><span>Orbit</span></button>{#if view==='3d'}<button type="button" class="home-button" aria-label="Reset rotation" title="Reset 3D rotation" onclick={()=>scope?.resetView()}><Icon name="reset" size={14} /></button>{/if}
					<div class="zoom-controls" aria-label="Magnification"><button type="button" aria-label="Zoom out" title="Zoom out" onclick={()=>scope?.zoom(.8)}><Icon name="zoom-out" size={14} /></button><output aria-label="Current magnification">{magnification.toFixed(magnification>=10?0:1)}×</output><button type="button" aria-label="Zoom in" title="Zoom in" onclick={()=>scope?.zoom(1.25)}><Icon name="zoom-in" size={14} /></button><button type="button" class="reset-button" aria-label="Fit curve" title="Fit and center the complete curve" onclick={()=>scope?.fitView()}><Icon name="fit" size={14} /><span>Fit</span></button></div>
				</div>
			</div>
			</div>
			<div class="workspace-panel harmony-panel" id="workspace-harmony" role="tabpanel" aria-labelledby={`tab-${harmonicView}`} hidden={workspace!=='overtones'&&workspace!=='tuning'} inert={workspace!=='overtones'&&workspace!=='tuning'}><HarmonyView view={harmonicView} notes={plotNotes} {spectrum} {title} {frozen} {followSound} speed={harmonicSpeed} {hasPlayed} sounding={audible} getOutputLevel={()=>audio?.getOutputLevel()??0} ontune={tuneNotes} onfreeze={toggleFreeze} onfollow={()=>followSound=!followSound} onspeed={(value)=>harmonicSpeed=value} onplay={playPreview} onstatus={harmonyStatus}/></div>
			<div class="workspace-panel atlas-panel" id="workspace-chords" role="tabpanel" aria-labelledby="tab-chords" hidden={workspace!=='chords'} inert={workspace!=='chords'}><ChordAtlas notes={plotNotes} {title} {root} {stopToken} onplay={playAtlas} onstop={stopSound}/></div>
		</section>
	</div>
	<section class="instrument-dock" aria-label="Sound and keyboard">
		<div class="instrument-toolbar"><div class={['engine-switch',mode==='pure'&&'engine-disabled']} aria-label="Instrument engine" title={mode==='pure'?'Switch to Instrument to choose an engine':'Sound engine'}><button type="button" class={instrumentEngine==='sampled'?'active':''} aria-pressed={instrumentEngine==='sampled'} disabled={mode==='pure'} onclick={()=>changeEngine('sampled')}>Sampled</button><button type="button" class={instrumentEngine==='synth'?'active':''} aria-pressed={instrumentEngine==='synth'} disabled={mode==='pure'} onclick={()=>changeEngine('synth')}>Synth</button></div><VoicePicker value={program} synth={instrumentEngine==='synth'} disabled={mode==='pure'} onchange={changeProgram} /><label class="velocity-control"><span>Velocity</span><select aria-label="Velocity" value={velocity===null?'touch':String(velocity)} onchange={(event)=>velocity=event.currentTarget.value==='touch'?null:Number(event.currentTarget.value)}><option value="touch">Touch dynamics</option><option value="48">Soft · 48</option><option value="96">Medium · 96</option><option value="127">Hard · 127</option></select></label><button type="button" class="toggle-control latch-control" aria-pressed={latch} title="Keep notes sounding after release. Play the same key again to release it." onclick={(event)=>{changeLatch();if(event.detail>0)event.currentTarget.blur();}}><span class={['toggle',latch&&'on']}></span>Latch</button><button type="button" class="stop-button" disabled={!sounding} onclick={stopSound} title="Stop all sound (⌘ / Ctrl + .)" aria-label="Stop all sound"><Icon name="stop" size={13} /><span>Stop</span></button><div class="toolbar-spacer"></div><label class="volume-control"><Icon name="volume" size={16} /><input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={volume} oninput={(event)=>changeVolume(Number(event.currentTarget.value))} /></label><button type="button" class="keys-control" aria-pressed={keysEnabled} title={keysEnabled?'Disable computer keyboard notes':'Enable computer keyboard notes'} onclick={(event)=>{keysEnabled=!keysEnabled;if(event.detail>0)event.currentTarget.blur();}}><Icon name="typing" size={16} /><span>Keys</span><i class={keysEnabled?'enabled':''}></i></button><div class="octave-controls"><span><kbd>Z</kbd> / <kbd>X</kbd></span><button type="button" aria-label="Down an octave" disabled={base<=0} onclick={()=>base=Math.max(0,base-12)}><Icon name="left" size={16} /></button><button type="button" aria-label="Up an octave" disabled={base>=72} onclick={()=>base=Math.min(72,base+12)}><Icon name="right" size={16} /></button></div></div>
		<PianoKeyboard active={(hasPlayed?liveNotes:previewNotes).map((note)=>note.midi)} scale={pitches} colors={keyColors} {base} {keysEnabled} {velocity} onNoteOn={noteOn} onNoteOff={noteOff} onOctave={(next)=>base=next} />
	</section>
	<footer class="status-bar"><span class="engine-status"><i class={audioStatus.state==='loading'?'loading':''}></i>{mode==='pure'?'Pure sine engine':instrumentEngine==='sampled'?'Sampled instruments':'Synth engine'}<span class="footer-divider">/</span>{audioStatus.state==='loading'||audioStatus.state==='fallback'||audioStatus.state==='error'?audioStatus.message:hasPlayed?sounding?`${liveNotes.length} ${liveNotes.length===1?'voice':'voices'}`:'Sound stopped':'Choose a chord to begin'}</span><span class="status-right">{workspace==='chords'?'Fifths across · Thirds diagonally':workspace!=='scope'?'Drag to explore · Scroll to zoom':frozen?'Sweep paused':view==='3d'?'Drag to orbit · Shift-drag to pan · Scroll to zoom':'Drag to pan · Scroll to zoom'}<span class="footer-divider">/</span><span class="gpu-status"><i></i>{gpuStatus}</span></span></footer>
	{#if notice}<div class="notice" role="status"><Icon name="info" size={17} /><span>{notice}</span><button type="button" aria-label="Dismiss message" onclick={()=>notice=''}><Icon name="close" size={15} /></button></div>{/if}
	<dialog class="help-dialog" closedby="any" aria-labelledby="help-title" {@attach captureHelp}><button type="button" class="help-close icon-button" aria-label="Close controls" onclick={()=>help?.close()}><Icon name="close" /></button><h2 id="help-title">A small guide to playing</h2><p>Four views of one instrument. The keyboard, wheel, chord pads, and lattice share the same notes and sound.</p><dl><dt><kbd>A W S E D F…</kbd></dt><dd>Play the labeled keys</dd><dt><kbd>Z</kbd> / <kbd>X</kbd></dt><dd>Move down / up an octave</dd><dt><kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>.</kbd></dt><dd>Stop all sound</dd><dt>Latch</dt><dd>Keep a note after release. Play it again to remove it. Editing a latched chord with the computer or on-screen keyboard replays its notes together. A chord pad replaces the current notes.</dd><dt>Freeze</dt><dd>Pause the highlight, waveform probes, and automatic orbit. Sound continues. Reduced-motion preferences start the views paused; Resume starts motion when you choose.</dd><dt>Stop</dt><dd>Silence every note and keep the last capture. Use Free run to inspect its motion without sound.</dd><dt>Follow sound</dt><dd>Motion and glow follow audible output, including decay and volume. Turn it off for Free run to inspect a captured shape in silence. Freeze pauses either mode.</dd><dt>Sweep speed</dt><dd>Set how many seconds the highlight takes to travel the whole curve.</dd><dt>Zoom &amp; pan</dt><dd>Scroll or pinch to zoom. Drag to pan in 2D and waveform views. In 3D, drag to orbit; Shift-drag or right-drag to pan. Fit centers the complete curve.</dd><dt>Recapture</dt><dd>Refresh the held instrument curve and measured spectrum from the sound playing now. Replay the selection to capture a new attack.</dd><dt>View</dt><dd>Waveform, 2D and 3D stay selected while you explore. Play at least two notes for 2D or three for 3D.</dd><dt>Workspaces</dt><dd>Overtones compares measured partials. Tuning explores estimated sensory roughness. Chords auditions a fifth/third lattice. Scope keeps the waveform and parametric views.</dd><dt>Fine tuning</dt><dd>Adjust any selected note by up to 50 cents. Equal resets offsets; Just uses simple ratios from the first note. A new chord selection resets tuning. Replay keeps it.</dd><dt>Instrument / Pure tones</dt><dd>Switch sound and curves together: the full instrument, or just sine waves.</dd></dl><p class="help-footnote">Typing inside controls never plays notes. MIDI pedal input is supported.</p></dialog>
</main>

<style>
.app-shell{min-width:0;grid-template-columns:minmax(0,1fr);min-height:740px;height:100dvh;display:grid;grid-template-rows:62px minmax(400px,1fr) auto 28px;background:var(--navy);color:var(--text);overflow:hidden;position:relative}
.source-link{text-decoration:none;display:grid;place-items:center}.app-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 25px;border-bottom:1px solid var(--line);background:#0b0b0b;z-index:5}
.brand{display:flex;align-items:center;gap:10px;min-width:260px}.brand-mark{display:grid;place-items:center;width:32px;height:32px;color:#f4f4f4;background:#171717;border:1px solid #303030;border-radius:7px}.brand>span:nth-child(2){font-size:24px;font-weight:550;letter-spacing:-.6px;line-height:1}.brand-divider{height:18px;width:1px;background:#444444;margin:0 5px 0 10px}.brand-caption{font-size:10px;color:#9b9b9b;font-weight:400;white-space:nowrap}
.view-tabs{display:flex;gap:3px;border:1px solid #3b3b3b;border-radius:7px;padding:3px;background:#151515}.view-tabs button{min-width:71px;padding:7px 16px;border:1px solid transparent;border-radius:4px;color:#bababa;font-size:12px;line-height:1.4;background:none}.view-tabs button.active{color:#f4f4f4;background:linear-gradient(#363636,#2e2e2e);border-color:#7a7a7a;box-shadow:inset 0 0 9px #6a6a6a18}
.header-actions{display:flex;align-items:center;justify-content:flex-end;gap:11px;min-width:260px}.midi-button{display:flex;align-items:center;gap:8px;font-size:11px;background:#212121;border:1px solid #454545;padding:8px 11px;border-radius:6px;color:#cacaca;white-space:nowrap}.midi-button.connected{color:#d3d3d3}.midi-button i{width:4px;height:4px;background:#cecece;border-radius:50%}.icon-button{display:grid;place-items:center;border:0;background:transparent;color:#a9a9a9;padding:5px;border-radius:4px}.icon-button:hover{color:#e9e9e9;background:#3b3b3b55}
.workspace{display:grid;grid-template-columns:284px minmax(0,1fr);min-height:0}.explorer{display:flex;flex-direction:column;padding:21px 18px 14px;border-right:1px solid var(--line);background:#0b0b0b;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#424242 transparent}.explorer-caption{display:flex;justify-content:space-between;align-items:center;color:#cecece;font-size:12px;font-weight:500;margin:0 4px 16px}.explore-detail{font-size:10px;font-weight:400;color:#777}.key-selectors{display:flex;gap:8px}.key-selectors label{display:flex;align-items:center;background:#181818;border:1px solid #3d3d3d;border-radius:6px;height:36px;padding-left:10px;min-width:0}.key-selectors label>span{color:#989898;font-size:10px}.key-selectors select{appearance:auto;color:#e2e2e2;padding:5px 7px;border:0;box-shadow:none;background:none;font-size:12px;min-width:52px;outline-offset:2px}.key-selectors .scale-selector{flex:1}.scale-selector select{max-width:124px;width:100%}.wheel-wrap{margin:17px -4px 9px}.scale-notes{display:flex;gap:0;justify-content:center;margin:0 1px 19px;padding:0 5px}.scale-notes span{flex:1;text-align:center;font-size:10px;color:#ababab}.explorer-tabs{display:flex;gap:3px;padding:3px;border:1px solid #3f3f3f;border-radius:6px;background:#171717;margin-bottom:11px}.explorer-tabs button{flex:1;padding:7px 5px;border:1px solid transparent;border-radius:4px;background:none;color:#a6a6a6;font-size:12px}.explorer-tabs button.active{border-color:#585858;color:#e6e6e6;background:#303030}.chord-pads{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.chord-pads button{display:flex;flex-direction:column;align-items:center;gap:5px;justify-content:center;min-height:56px;padding:9px 2px;border:1px solid #424242;border-radius:5px;background:linear-gradient(#252525,#1e1e1e);color:#d6d6d6;transition:background 120ms,border-color 120ms}.chord-pads button>span{font-size:13px;font-weight:500}.chord-pads button>small{font-size:10px;color:#8c8c8c}.chord-pads button.chosen{border-color:var(--cyan);background:color-mix(in srgb,var(--cyan) 18%,#111);box-shadow:inset 0 0 15px #77dbea14;color:#d9f9ff}.chord-pads button.chosen small{color:var(--cyan)}.chord-pads button:hover{border-color:#9e9e9e;background:#363636}.chord-pads button.chosen:hover{border-color:#b4f2fa;background:color-mix(in srgb,var(--cyan) 26%,#111)}.explorer-hint{font-size:10px;color:#a4a4a4;margin:14px 0 0;text-align:center}.explorer-bottom{margin-top:auto;padding:21px 1px 0;display:flex;gap:6px;align-items:center;color:#a3a3a3;font-size:10px}.explorer-bottom>span:last-child{margin-left:auto}.tuning-dot{width:4px;height:4px;background:#7f7f7f;border-radius:50%}.interval-pads{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.interval-pads button{padding:10px 3px;border:1px solid #444444;border-radius:5px;background:#232323;color:#c2c2c2;font-size:12px}.interval-pads button.chosen{border-color:var(--cyan);background:color-mix(in srgb,var(--cyan) 18%,#111);color:#d9f9ff}.interval-name{display:flex;justify-content:space-between;font-size:10px;color:#c0c0c0;margin:13px 0 0}.interval-name span{color:#888888}
.stage-column{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;background:#000}.signal-bar{height:55px;flex-shrink:0;display:flex;align-items:center;gap:15px;padding:0 23px;border-bottom:1px solid #31313148;background:#0b0b0b;z-index:3}.signal-switch{display:flex;padding:3px;gap:2px;border:1px solid #3c3c3c;border-radius:6px;background:#141414}.signal-switch button{display:flex;align-items:center;gap:7px;padding:6px 11px;border:0;border-radius:3px;background:none;font-size:12px;color:#a8a8a8;white-space:nowrap}.signal-switch button.active{color:#e4e4e4;background:#303030}.signal-caption{font-size:11px;color:#a0a0a0}.signal-actions{margin-left:auto;display:flex;align-items:center;gap:13px}.recapture-button{display:flex;align-items:center;gap:6px;border:0;background:none;padding:5px 0;color:#bfbfbf;font-size:11px;white-space:nowrap}.recapture-button:hover{color:#eaeaea}.recapture-button:disabled{opacity:.45}.plot-stage{flex:1;min-height:0;position:relative;isolation:isolate;overflow:hidden;background:#000}.scope-canvas{display:block;position:absolute;inset:0;width:100%;height:100%;outline:none;touch-action:none}.plot-heading{position:absolute;left:27px;top:24px;pointer-events:none;z-index:1}.plot-title-row{display:flex;align-items:center;gap:12px}.plot-heading h1{font-size:28px;line-height:1.2;letter-spacing:-.6px;font-weight:400;margin:0 0 13px;color:#e8e8e8}.frozen-label{font-size:10px;padding:3px 7px;border-radius:4px;background:#383838;color:#cfcfcf;margin-top:-10px}.axis-notes{display:flex;gap:7px;flex-wrap:wrap}.axis-notes>span{display:flex;align-items:baseline;gap:8px;padding:5px 8px;border:1px solid color-mix(in srgb,var(--axis-color) 35%,transparent);border-radius:4px;background:#19191985;color:var(--axis-color);font-size:12px}.axis-notes b{font-size:10px;font-weight:500;opacity:.7}.axis-notes small{font-size:10px;color:color-mix(in srgb,var(--axis-color) 60%,#8b8b8b)}.axis-overflow{font-size:10px;color:#9e9e9e;margin-top:9px}.canvas-status{position:absolute;right:23px;top:27px;display:flex;align-items:center;gap:6px;color:#a3a3a3;font-size:10px;pointer-events:none}.canvas-status i{width:4px;height:4px;border-radius:50%;background:#676767}.canvas-status i.captured{background:#b6b6b6;box-shadow:0 0 7px #b6b6b666}.play-preview{position:absolute;bottom:27px;left:50%;transform:translateX(-50%);display:grid;grid-template-columns:30px auto;column-gap:9px;align-items:center;background:#282828e8;border:1px solid #5d5d5d;border-radius:7px;padding:10px 15px;color:#e0e0e0;font-size:12px;text-align:left;z-index:2;box-shadow:0 4px 24px #00000033}.play-preview>span{grid-row:1/3;width:28px;height:28px;display:grid;place-items:center;border:1px solid #7a7a7a;border-radius:50%;color:#cdcdcd;padding-left:2px}.play-preview small{font-size:10px;margin-top:3px;color:#989898}.play-preview:hover{border-color:#bbbbbb;background:#363636}.trace-inset{position:absolute;bottom:26px;left:27px;width:200px;pointer-events:none;opacity:.85}.spectrum-inset{position:absolute;right:25px;bottom:21px;width:218px;opacity:.85}.empty-stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;color:#808080}.empty-stage p{font-size:12px;color:#b4b4b4;margin:15px 0}.empty-stage button{background:#313131;border:1px solid #595959;border-radius:5px;color:#d4d4d4;padding:7px 13px;font-size:12px}.visual-controls{display:grid;grid-template-columns:auto minmax(180px,1fr) minmax(130px,.55fr) auto;align-items:center;gap:20px;min-height:58px;flex-shrink:0;padding:10px 25px;border-top:1px solid #383838;background:#101010}.motion-controls{display:flex;align-items:center;gap:12px}.follow-button{display:flex;align-items:center;justify-content:center;gap:7px;min-width:114px;min-height:32px;padding:5px 8px;border:1px solid #383838;border-radius:5px;background:#171717;color:#a3a3a3;font-size:11px;white-space:nowrap}.follow-button.selected{border-color:#5c5c5c;background:#232323;color:#ededed}.follow-button i{width:4px;height:4px;border-radius:50%;background:#555}.follow-button.selected i{background:#e5e5e5}.freeze-button{display:flex;align-items:center;justify-content:center;gap:8px;padding:7px 2px;min-width:76px;border:0;background:none;color:#c9c9c9;font-size:12px}.freeze-button.selected{color:#cdcdcd}.speed-control,.trail-control{display:flex;align-items:center;gap:12px;color:#b9b9b9;font-size:11px;min-width:0}.speed-control>span,.trail-control>span{white-space:nowrap}.speed-control input,.trail-control input{width:100%;min-width:30px;flex:1}.speed-control output{min-width:72px;color:#d2d2d2;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.speed-control output small{font-size:9px;color:#a4a4a4}.camera-controls{display:flex;gap:10px;align-items:center;justify-content:flex-end}.camera-controls button{display:flex;align-items:center;justify-content:center;gap:6px;background:none;border:0;padding:5px 0;color:#b5b5b5;font-size:11px}.camera-controls button:hover{color:#e9e9e9}.camera-controls button.active{color:#d5d5d5}.camera-controls button:disabled{opacity:.35;cursor:default}.zoom-controls{display:flex;align-items:center;gap:3px}.zoom-controls button{width:23px;height:27px}.zoom-controls output{width:39px;text-align:center;font-size:10px;color:#c9c9c9;font-variant-numeric:tabular-nums}.zoom-controls .reset-button{margin-left:5px;border-left:1px solid #303030;width:auto;padding-left:9px;gap:5px}.zoom-controls .reset-button span{font-size:11px}.camera-controls .home-button{width:22px}.view-hint{font-size:11px;color:#a3a3a3;margin:11px 0 0}.engine-disabled{opacity:.55}
.instrument-dock{z-index:6;border-top:1px solid #4c4c4c;background:#101010;padding:0 12px 10px;min-width:0;box-shadow:0 -5px 25px #00000022}.instrument-toolbar{display:flex;align-items:center;gap:15px;min-height:60px;padding:0 3px;position:relative}.engine-switch{display:flex;gap:2px;padding:2px;background:#191919;border:1px solid #414141;border-radius:5px;flex-shrink:0}.engine-switch button{padding:7px 10px;border:0;border-radius:3px;font-size:12px;background:none;color:#a8a8a8}.engine-switch button.active{color:#d7d7d7;background:#3b3b3b}.velocity-control{display:flex;align-items:center;gap:8px;color:#a3a3a3;font-size:10px}.velocity-control select{font-size:10px;background:#1f1f1f;border:1px solid #424242;border-radius:5px;color:#cccccc;padding:8px 23px 8px 8px}.toggle-control{display:flex;align-items:center;gap:8px;font-size:12px;color:#c3c3c3;border:0;background:none;padding:7px 0;white-space:nowrap}.toggle{height:16px;width:29px;border-radius:10px;background:#454545;position:relative;border:1px solid #5d5d5d;display:block}.toggle::after{content:'';position:absolute;height:12px;width:12px;border-radius:50%;left:1px;top:1px;background:#a5a5a5;transition:transform 120ms}.toggle.on{background:#7b7b7b;border-color:#a4a4a4}.toggle.on::after{transform:translateX(12px);background:#efefef}.stop-button{display:flex;align-items:center;gap:6px;font-size:10px;color:#a6a6a6;background:none;border:0;padding:8px 0}.toolbar-spacer{flex:1}.volume-control{display:flex;align-items:center;gap:8px;color:#b3b3b3;width:105px;flex-shrink:0}.volume-control input{width:76px}.keys-control{display:flex;align-items:center;gap:6px;background:none;border:0;padding:6px 0;color:#b2b2b2;font-size:10px}.keys-control i{width:4px;height:4px;border-radius:50%;background:#616161}.keys-control i.enabled{background:#c5c5c5}.octave-controls{display:flex;align-items:center;gap:5px;margin-left:4px}.octave-controls>span{display:flex;gap:3px;margin-right:6px;font-size:10px;color:#878787;white-space:nowrap}.octave-controls kbd{font:inherit;color:#b2b2b2}.octave-controls button{width:29px;height:30px;display:grid;place-items:center;border:1px solid #434343;border-radius:5px;background:#202020;color:#c6c6c6}.octave-controls button:disabled{opacity:.3;cursor:default}
.status-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#181818;color:#a1a1a1;padding:0 18px;font-size:10px;min-width:0}.engine-status{display:flex;gap:6px;align-items:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.engine-status>i{width:4px;height:4px;background:#868686;border-radius:50%;flex-shrink:0}.engine-status>i.loading{animation:blink 1s infinite}.footer-divider{color:#515151;margin:0 5px}.status-right{display:flex;align-items:center;white-space:nowrap}.gpu-status{display:flex;align-items:center;gap:5px}.gpu-status i{width:3px;height:3px;border-radius:50%;background:#9b9b9b}.notice{position:absolute;bottom:233px;left:50%;transform:translateX(-50%);width:max-content;max-width:min(600px,calc(100% - 40px));display:flex;align-items:center;gap:10px;border:1px solid #606060;border-radius:8px;background:#292929f5;padding:13px 14px;font-size:12px;color:#dfdfdf;z-index:40;box-shadow:0 8px 50px #00000066}.notice>span{flex:1}.notice button{padding:3px;border:0;background:none;color:#b9b9b9}.help-dialog{max-height:calc(100dvh - 40px);overflow-y:auto;position:fixed;margin:auto;width:460px;max-width:calc(100% - 35px);border:1px solid #505050;border-radius:14px;background:#141414;padding:30px;color:#cacaca;box-shadow:0 20px 80px #00000088}.help-dialog::backdrop{background:#0a0a0aae;backdrop-filter:blur(6px)}.help-close{position:absolute;right:15px;top:15px}.help-dialog h2{font-size:21px;font-weight:400;letter-spacing:-.5px;color:#ececec;margin:0 0 13px}.help-dialog p{font-size:12px;line-height:1.7;color:#a5a5a5;margin:0 0 22px}.help-dialog dl{display:grid;grid-template-columns:140px 1fr;gap:17px 15px;margin:0;font-size:12px;line-height:1.65}.help-dialog dt{color:#dbdbdb}.help-dialog dd{margin:0;color:#b0b0b0}.help-dialog kbd{font:inherit;background:#393939;padding:2px 5px;border-radius:3px}.help-dialog .help-footnote{margin:24px 0 0;border-top:1px solid #444444;padding-top:15px;font-size:10px}.immersive .workspace{grid-template-columns:1fr}.immersive .explorer{display:none}.immersive .brand-caption,.immersive .brand-divider{display:none}.immersive .plot-stage{background:#000}
@keyframes blink{50%{opacity:.3}}
@media(min-width:1700px){.workspace{grid-template-columns:330px minmax(0,1fr)}.explorer{padding-inline:24px}.wheel-wrap{margin-top:20px}.chord-pads button{min-height:62px}.instrument-toolbar{gap:23px;padding:0 12px}.plot-heading{top:30px;left:34px}.plot-heading h1{font-size:32px}.trace-inset{width:240px;left:34px}.spectrum-inset{width:260px;right:35px}.visual-controls{gap:25px}}
@media(max-width:1200px){.app-header{gap:15px;padding:0 18px}.brand,.header-actions{min-width:205px}.brand-caption,.brand-divider{display:none}.workspace{grid-template-columns:252px minmax(0,1fr)}.explorer{padding:18px 13px 12px}.signal-bar{padding:0 18px}.signal-caption{display:none}.instrument-toolbar{gap:11px}.velocity-control>span{display:none}.volume-control{width:80px}.volume-control input{width:53px}.keys-control>span{display:none}.stop-button>span{display:none}.octave-controls>span{display:none}.trace-inset{width:170px;left:20px}.spectrum-inset{width:160px;right:20px}.play-preview{bottom:28px;padding:8px 10px;column-gap:5px}.visual-controls{padding-inline:17px;gap:13px}.axis-notes small{display:none}.signal-switch button{padding-inline:9px}.camera-controls{gap:7px}.orbit-button>span{display:none}}
@media(max-width:960px){.app-shell{min-height:800px;grid-template-rows:58px minmax(400px,1fr) auto 28px}.workspace{grid-template-columns:230px minmax(0,1fr)}.brand,.header-actions{min-width:150px}.header-actions{gap:6px}.midi-button{padding:7px}.midi-button>span{max-width:80px;overflow:hidden;text-overflow:ellipsis}.view-tabs button{min-width:56px;padding:7px 10px}.instrument-toolbar{flex-wrap:wrap;padding:10px 3px;gap:9px 14px}.toolbar-spacer{display:none}.velocity-control{margin-left:auto}.volume-control{margin-left:auto}.instrument-dock{padding-bottom:8px}.signal-bar{height:51px}.visual-controls{grid-template-columns:auto minmax(0,1fr) auto;gap:9px 13px;min-height:88px;padding-block:10px}.freeze-button{grid-column:1;grid-row:1/3}.speed-control{grid-column:2/4;grid-row:1}.trail-control{grid-column:2;grid-row:2}.camera-controls{grid-column:3;grid-row:2}.plot-heading{left:19px;top:22px}.plot-heading h1{font-size:23px}.axis-notes{gap:5px}.axis-notes>span{font-size:10px;padding:4px 6px;gap:5px}.canvas-status{top:auto;right:17px;bottom:10px;font-size:10px}.trace-inset,.spectrum-inset{display:none}.play-preview{bottom:30px}.status-right{font-size:0;gap:0}.status-right .footer-divider{display:none}.gpu-status{font-size:10px}.notice{bottom:275px}}
@media(max-width:700px){.app-shell{height:auto;min-height:100dvh;overflow:visible;grid-template-rows:58px auto auto 30px}.app-header{padding:0 13px;gap:10px}.brand{min-width:0;gap:6px}.brand-mark{width:28px;height:28px}.brand>span:nth-child(2){font-size:20px;letter-spacing:-.5px}.header-actions{min-width:0}.header-actions>.icon-button:last-child{display:none}.header-actions .midi-button{border:0;background:none;padding:5px}.midi-button>span{display:none}.view-tabs{padding:2px}.view-tabs button{font-size:10px;min-width:39px;padding:5px 7px}.workspace{display:flex;flex-direction:column-reverse}.stage-column{min-height:500px;height:58vh;max-height:680px}.signal-bar{height:48px;padding:0 13px}.plot-heading{left:19px;top:20px}.plot-heading h1{font-size:24px}.plot-stage{min-height:290px}.signal-switch button{padding:5px 9px;font-size:10px}.visual-controls{min-height:140px;padding:8px 13px;gap:4px 9px}.freeze-button{grid-column:1;grid-row:1;min-width:65px;min-height:40px;font-size:11px}.speed-control{grid-column:2/4;gap:8px}.trail-control{grid-column:1/4;grid-row:2;gap:12px;min-height:32px}.speed-control,.trail-control{font-size:10px}.speed-control output{min-width:65px;font-size:10px}.camera-controls{grid-column:1/4;grid-row:3;justify-content:center;gap:10px}.camera-controls button{min-width:40px;height:40px;border:1px solid #303030;border-radius:5px;background:#171717}.camera-controls .home-button{width:40px}.zoom-controls{gap:4px}.zoom-controls button{width:40px}.zoom-controls output{width:39px}.zoom-controls .reset-button{padding-inline:9px;margin-left:2px}.recapture-button{font-size:10px}.signal-actions{gap:9px}.signal-actions>.icon-button{min-width:36px;min-height:36px}.play-preview{display:flex;gap:8px;padding:9px 13px;bottom:28px}.play-preview>span{width:20px;height:20px;border:0}.play-preview small{display:none}.header-actions>.icon-button,.header-actions .midi-button{min-width:36px;min-height:36px}.view-tabs button{min-height:32px}.explorer{display:grid;grid-template-columns:158px minmax(0,1fr);column-gap:20px;padding:17px 17px 13px;border-right:0;border-top:1px solid #3f3f3f;overflow:visible}.explorer-caption{display:none}.key-selectors{grid-column:1/-1;margin-bottom:12px}.key-selectors label{height:34px}.key-selectors .scale-selector{flex:initial}.scale-selector select{max-width:170px}.wheel-wrap{grid-column:1;grid-row:2/6;align-self:start;margin:3px -7px 0}.scale-notes{grid-column:2;margin:4px 0 14px;padding:0}.explorer-tabs{grid-column:2;margin-bottom:9px}.explorer-tabs button{font-size:10px;padding:5px}.chord-pads,.interval-pads{grid-column:2;gap:5px}.chord-pads button{min-height:43px;padding:7px 2px;gap:3px}.chord-pads button>span{font-size:12px}.chord-pads button small{font-size:9px}.interval-pads button{font-size:10px;padding:8px 2px}.explorer-hint,.interval-name{grid-column:2;margin-top:9px;font-size:10px}.explorer-bottom{grid-column:1/-1;padding:14px 0 0;font-size:10px}.instrument-toolbar{gap:9px 12px}.instrument-toolbar :global(.voice-picker){width:auto;flex:1;min-width:180px}.engine-switch button{font-size:10px;padding:7px 8px}.velocity-control{margin-left:0}.velocity-control select{font-size:10px;padding:6px 21px 6px 7px}.toggle-control{font-size:10px}.keys-control{margin-left:auto}.volume-control{width:65px;margin-left:0}.volume-control input{width:42px}.octave-controls{margin-left:0}.octave-controls button{height:32px;width:29px}.stop-button,.keys-control{min-width:32px;min-height:32px;justify-content:center}.instrument-dock{padding:0 10px 7px}.status-bar{padding:0 12px;font-size:9px;gap:8px}.engine-status .footer-divider{margin:0 2px}.gpu-status{font-size:9px}.notice{position:fixed;bottom:20px;z-index:55;font-size:10px}.help-dialog{padding:27px 23px}.help-dialog dl{grid-template-columns:116px 1fr;gap:14px 11px}.immersive .workspace{display:block}.immersive .stage-column{height:calc(100dvh - 310px);min-height:500px}}
@media(max-width:390px){.explorer{grid-template-columns:137px minmax(0,1fr);column-gap:14px;padding-inline:12px}.header-actions{gap:2px}.brand-mark{display:none}.axis-notes>span{font-size:10px}.signal-switch button{padding-inline:7px}.instrument-toolbar{gap:9px}.volume-control{display:none}}
@media(max-width:360px){.app-header{padding-inline:9px;gap:7px}.view-tabs button{padding-inline:6px}}
@media(min-width:701px) and (max-width:1100px){.visual-controls{grid-template-columns:minmax(0,1fr) auto;min-height:96px}.motion-controls{grid-column:1;grid-row:1}.speed-control{grid-column:1;grid-row:2}.trail-control{grid-column:2;grid-row:1}.camera-controls{grid-column:2;grid-row:2}}
@media(max-width:700px){.stage-column{min-height:540px}.visual-controls{min-height:180px}.motion-controls{grid-column:1/4;grid-row:1;justify-content:space-between}.follow-button{min-height:40px;min-width:124px}.speed-control{grid-column:1/4;grid-row:2;min-height:32px}.trail-control{grid-column:1/4;grid-row:3}.camera-controls{grid-column:1/4;grid-row:4}.immersive .stage-column{min-height:540px}}
@media(prefers-reduced-motion:reduce){.toggle::after,.chord-pads button{transition:none}.engine-status>i.loading{animation:none}}

.workspace-tabs{display:flex;align-items:center;gap:5px}.workspace-tabs button{border:1px solid transparent;background:none;color:#999;font-size:12px;padding:9px 16px;border-radius:5px;white-space:nowrap}.workspace-tabs button[aria-selected=true]{background:#242424;border-color:#454545;color:#f1f1f1}.workspace-tabs button:hover{color:#eee;background:#1a1a1a}.app-header .brand{min-width:185px}.app-header .brand-caption,.app-header .brand-divider{display:none}.app-header .header-actions{min-width:185px;justify-content:flex-end}.workspace-panel{height:100%;min-height:0;flex:1;min-width:0}.scope-panel{display:flex;flex-direction:column;flex:1;min-height:0;position:relative}.scope-panel[hidden],.atlas-panel[hidden],.harmony-panel[hidden]{display:none}.scope-panel>.view-tabs{position:absolute;top:19px;right:22px;z-index:3;background:#121212bb}.scope-panel .canvas-status{top:74px}.signal-caption{flex:1}.harmony-workspace .stage-column{overflow:hidden}.harmony-workspace .signal-bar{flex-shrink:0}.source-link{color:#aaa}.source-link:hover{color:#fff}
@media(max-width:1100px){.app-header{gap:15px;padding-inline:20px}.app-header .brand{min-width:100px}.app-header .header-actions{min-width:150px}.workspace-tabs{gap:3px}.workspace-tabs button{padding-inline:11px}.harmony-workspace .workspace{grid-template-columns:230px minmax(0,1fr)}.harmony-workspace .signal-caption{display:none}.scope-panel>.view-tabs{top:16px;right:17px}.scope-panel .plot-heading{top:61px}.scope-panel .canvas-status{top:auto}}
@media(min-width:701px) and (max-width:900px){.harmony-workspace .workspace{grid-template-columns:185px minmax(0,1fr)}.harmony-workspace .explorer{padding-inline:12px}.harmony-workspace .wheel-wrap{margin-inline:0}.harmony-workspace .key-selectors{flex-direction:column}.harmony-workspace .key-selectors label{width:100%}.harmony-workspace .scale-selector select{max-width:none;flex:1}.harmony-workspace .chord-pads{grid-template-columns:repeat(3,minmax(0,1fr))}.harmony-workspace .explore-detail{display:none}}
@media(max-width:700px){.app-shell{grid-template-rows:98px auto auto 30px}.app-header{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:45px 44px;gap:0 9px;padding:4px 13px 5px}.app-header .brand{min-width:0}.app-header .header-actions{min-width:0;gap:6px}.workspace-tabs{grid-column:1/-1;grid-row:2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:100%;gap:4px}.workspace-tabs button{padding:8px 5px;font-size:12px;min-height:35px}.app-header .source-link{min-width:32px;min-height:36px}.harmony-workspace .stage-column{height:auto;min-height:0;max-height:none;overflow:visible}.harmony-workspace .workspace-panel{height:auto}.harmony-workspace .workspace{display:flex}.harmony-workspace.immersive .stage-column{height:auto;min-height:0}.scope-panel>.view-tabs{top:13px;right:13px}.scope-panel .plot-heading{top:63px}.scope-panel .canvas-status{top:auto}.signal-caption{display:none}.harmony-workspace .explorer{margin-top:0}.scope-panel .play-preview{bottom:24px}}
</style>
