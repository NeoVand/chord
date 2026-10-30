<script lang="ts">
	import type { PlotNote } from '#lib/types.ts';
	import { NOTE_COLORS } from '#lib/music/theory.ts';
	import type { InspectionFrame } from '#lib/inspection/session.ts';
	import type { PlotView } from '#lib/types.ts';
	// Samples and activity come from the shared inspection, never the GPU renderer.
	let { notes, view, getInspection, getProgress }: {
		notes: readonly PlotNote[];
		view: PlotView;
		getInspection: () => InspectionFrame;
		getProgress?: () => number;
	} = $props();

	function draw(element: HTMLCanvasElement) {
		const ctx = element.getContext('2d');
		if (!ctx) return;
		let frame = 0;
		let lastDraw = -Infinity;
		let lastWidth = -1; let lastHeight = -1; let lastDpr = -1; let lastProgress = -1; let lastActivity = -1;
		let needsRedraw = true;
		let previous: { id: string; label: string; data: Float32Array | undefined; cycles: number }[] = [];
		let sourceSignal: InspectionFrame['signal']=null;
		let sourceView: PlotView | undefined;
		let sourceIds='';
		let samples: {id:string;data:Float32Array;cycles:number}[]=[];
		const peaks = new WeakMap<Float32Array, number>();
		void document.fonts.ready.then(() => { needsRedraw = true; });
		function sample(data: Float32Array, position: number) {
			const index=Math.max(0,Math.min(data.length-1,position*(data.length-1)));
			const lower=Math.floor(index); const mix=index-lower;
			return (data[lower]??0)*(1-mix)+(data[Math.min(lower+1,data.length-1)]??0)*mix;
		}
		const tick = (now: number) => {
			frame = requestAnimationFrame(tick);
			if (document.hidden || now-lastDraw<1000/30) return;
			lastDraw=now;
			const width=element.clientWidth; const height=element.clientHeight;
			if (!width || !height) return;
			const dpr=Math.min(2,window.devicePixelRatio||1);
			const inspection=getInspection();
			const progress=Math.max(0,Math.min(1,getProgress?.()??inspection.transport.progress));
			const activity=Math.max(0,Math.min(1,inspection.transport.level));
			const signal=inspection.signal;
			const ids=notes.map((note)=>`${note.id}:${note.frequency}`).join(',');
			if(signal!==sourceSignal||view!==sourceView||ids!==sourceIds){
				sourceSignal=signal;sourceView=view;sourceIds=ids;samples=[];
				if(signal){
					const duration=view==='waveform'?Math.min(signal.duration,4/Math.min(...signal.notes.map((note)=>note.frequency))):signal.duration;
					samples=signal.notes.map((note,lane)=>{
						const channel=signal.channels[lane];
						const count=channel?Math.max(2,Math.min(channel.length,Math.ceil(channel.length*duration/signal.duration))):Math.max(512,Math.min(65536,Math.ceil(duration*signal.sampleRate)));
						const data=channel?channel.subarray(0,count):Float32Array.from({length:count},(_,i)=>signal.sample(lane,i/(count-1)*duration));
						return {id:note.id,data,cycles:note.frequency*duration};
					});
				}
			}
			const rows=notes.slice(0,8).map((note)=>{
				const signal=samples.find((item)=>item.id===note.id);
				return {id:note.id,label:note.label,data:signal?.data,cycles:signal?.cycles??4};
			});
			if (!needsRedraw && width===lastWidth && height===lastHeight && dpr===lastDpr && progress===lastProgress && activity===lastActivity && rows.length===previous.length && rows.every((row,i)=>row.id===previous[i].id && row.label===previous[i].label && row.data===previous[i].data && row.cycles===previous[i].cycles)) return;
			needsRedraw=false;lastWidth=width;lastHeight=height;lastDpr=dpr;lastProgress=progress;lastActivity=activity;previous=rows;
			if(element.width!==Math.round(width*dpr)||element.height!==Math.round(height*dpr)){element.width=Math.round(width*dpr);element.height=Math.round(height*dpr);}
			ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
			rows.forEach(({label,data,cycles},i)=>{
				const y=13+i*27;const left=30;const right=width-2;const span=right-left;
				ctx.font='10px Manrope Variable, sans-serif';ctx.fillStyle=NOTE_COLORS[i%3];ctx.fillText(label,0,y+3);
				ctx.strokeStyle='#2d2d2d';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
				if(!data?.length || span<=0)return;
				let peak=peaks.get(data);
				if(peak===undefined){peak=.05;for(const value of data)peak=Math.max(peak,Math.abs(value));peaks.set(data,peak);}
				const window=Math.min(.85,2/Math.max(1,cycles));
				const start=Math.max(0,Math.min(1-window,progress-window/2));
				const probe=left+(progress-start)/window*span;
				ctx.strokeStyle=NOTE_COLORS[i%3];ctx.globalAlpha=.25+.45*activity;ctx.lineWidth=1;ctx.beginPath();
				for(let x=left;x<=right;x++){
					const value=sample(data,start+(x-left)/span*window);
					const py=y-value*8/peak*activity;
					if(x===left)ctx.moveTo(x,py);else ctx.lineTo(x,py);
				}
				ctx.stroke();ctx.globalAlpha=1;
				if(activity<=.001)return;
				ctx.strokeStyle=NOTE_COLORS[i%3];ctx.globalAlpha=.28*activity;ctx.beginPath();ctx.moveTo(probe,y-11);ctx.lineTo(probe,y+11);ctx.stroke();
				ctx.globalAlpha=activity;ctx.fillStyle=NOTE_COLORS[i%3];ctx.shadowColor=NOTE_COLORS[i%3];ctx.shadowBlur=7*activity;ctx.beginPath();ctx.arc(probe,y-sample(data,progress)*8/peak*activity,1.8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;
			});
		};
		frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
	}
</script>

<div class="trace-caption"><span>Signal detail</span><span>Follow sweep</span></div>
<canvas class="signal-traces" style:height={`${Math.max(1,Math.min(8,notes.length))*27}px`} {@attach draw} aria-label="Individual captured waveforms with a probe synchronized to the main sweep"></canvas>
<style>
	.trace-caption{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px;color:#a3a3a3;font-size:10px}
	.trace-caption span:last-child{color:#777}
	.signal-traces{display:block;width:100%;min-height:27px;pointer-events:none}
</style>
