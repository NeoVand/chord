<script lang="ts">
	import { onMount } from 'svelte';
	import type { HarmonySceneController, HarmonySceneOptions } from '#lib/harmony/types.ts';
	let { options, oncontroller }: { options: HarmonySceneOptions; oncontroller: (controller: HarmonySceneController | null) => void } = $props();
	let canvas: HTMLCanvasElement | undefined;
	function attachCanvas(element: HTMLCanvasElement) { canvas=element; return()=>{canvas=undefined;}; }
	onMount(()=>{
		let disposed=false;
		let scene: HarmonySceneController | null=null;
		void import('#lib/visualization/harmony-scene.ts').then(async ({createHarmonyScene})=>{
			if(disposed||!canvas)return;
			const instance=await createHarmonyScene(canvas,{
				getState:()=>options.getState(),getInspection:()=>options.getInspection(),
				onPickPair:(id)=>options.onPickPair?.(id),onTune:(updates)=>options.onTune?.(updates),
				onBusy:(busy)=>options.onBusy?.(busy),onStatus:(status)=>options.onStatus?.(status)
			});
			if(disposed)instance.dispose();else {scene=instance;oncontroller(instance);}
		}).catch(()=>{if(!disposed)options.onStatus?.('unavailable');});
		return()=>{disposed=true;scene?.dispose();oncontroller(null);};
	});
</script>
<canvas {@attach attachCanvas} aria-label="Interactive harmonic visualization. Use the adjacent controls to select partials and tune notes."></canvas>
<style>canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}</style>
