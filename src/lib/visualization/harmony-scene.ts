import * as THREE from 'three/webgpu';
import { color, mix, positionLocal, smoothstep } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NOTE_COLORS } from '../music/theory';
import { partialPairs } from '../harmony/pairs';
import { centsOffset } from '../harmony/tuning';
import type { RoughnessSurface } from '../harmony/roughness';
import type { HarmonySceneController, HarmonySceneOptions, HarmonySceneState, PartialPair, VoiceSpectrum } from '../harmony/types';
import { SoundActivity } from './activity';

const TAU = Math.PI * 2;
const palette = NOTE_COLORS.map((value) => new THREE.Color(value));
const spiralPosition = (frequency: number) => {
	const octave = Math.log2(Math.max(8, frequency) / 55);
	const radius = .8 + (octave + 3) * .36;
	return new THREE.Vector3(radius * Math.cos(octave * TAU - Math.PI / 2), radius * Math.sin(octave * TAU - Math.PI / 2), 0);
};

/** Retained scenes: analysis changes geometry, audio changes only small uniforms
 * and marker transforms. Switching workspaces never moves an established camera.
 */
export async function createHarmonyScene(canvas: HTMLCanvasElement, options: HarmonySceneOptions): Promise<HarmonySceneController> {
	const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x000000, 1);
	try { await renderer.init(); }
	catch (error) { renderer.dispose(); options.onStatus?.('unavailable'); throw error; }
	options.onStatus?.((renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl');
	const scenes = { overtones: new THREE.Scene(), tuning: new THREE.Scene() };
	const cameras = {
		overtones: new THREE.OrthographicCamera(-6, 6, 5, -5, .01, 100),
		tuning: new THREE.PerspectiveCamera(38, 1, .01, 100)
	};
	cameras.overtones.position.set(0, 0, 15);
	cameras.tuning.position.set(7.4, 6.2, 7.8);
	const controls = {
		overtones: new OrbitControls(cameras.overtones, canvas),
		tuning: new OrbitControls(cameras.tuning, canvas)
	};
	for (const [view, control] of Object.entries(controls)) {
		control.enabled = false;
		control.enableDamping = false;
		control.enableRotate = view === 'tuning';
		control.zoomToCursor = true;
		control.zoomSpeed = .65;
		control.minZoom = .4; control.maxZoom = 18;
		control.minDistance = 2; control.maxDistance = 28;
		control.maxPolarAngle = Math.PI * .48;
		if (view === 'overtones') { control.mouseButtons.LEFT = THREE.MOUSE.PAN; control.touches.ONE = THREE.TOUCH.PAN; }
		control.target.set(0, view === 'tuning' ? .25 : 0, 0);
		control.update();
	}
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	const textures = new Set<THREE.Texture>();
	const ownGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
	const ownMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
	const dynamic = new THREE.Group(); scenes.overtones.add(dynamic);
	const pairGroup = new THREE.Group(); scenes.overtones.add(pairGroup);
	const sphere = ownGeometry(new THREE.SphereGeometry(1, 16, 12));
	const coreMaterials = palette.map((pigment) => ownMaterial(new THREE.MeshBasicNodeMaterial({ color: pigment })));
	const white = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: '#f5f5f5' }));
	const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
	const glowContext = glowCanvas.getContext('2d')!;
	const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, '#ffffffff'); gradient.addColorStop(.18, '#ffffff90'); gradient.addColorStop(.5, '#ffffff18'); gradient.addColorStop(1, '#ffffff00');
	glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 64, 64);
	const glowTexture = new THREE.CanvasTexture(glowCanvas); textures.add(glowTexture);
	const glowMaterials = palette.map((pigment) => ownMaterial(new THREE.SpriteNodeMaterial({ color: pigment, map: glowTexture, transparent: true, opacity: .45, depthWrite: false })));
	const connectionMaterials = palette.map((pigment) => ownMaterial(new THREE.LineBasicNodeMaterial({ color: pigment, transparent: true, opacity: .25, depthWrite: false })));
	const gridMaterial = ownMaterial(new THREE.LineBasicNodeMaterial({ color: '#424242', transparent: true, opacity: .38 }));
	function label(text: string, position: THREE.Vector3, scene: THREE.Object3D, color = '#929292', size = .3) {
		const bitmap = document.createElement('canvas'); bitmap.width = 256; bitmap.height = 64;
		const ctx = bitmap.getContext('2d')!;
		ctx.fillStyle = color; ctx.font = '40px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 128, 32);
		const texture = new THREE.CanvasTexture(bitmap); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
		const material = ownMaterial(new THREE.SpriteNodeMaterial({ map: texture, transparent: true, depthTest: false }));
		const sprite = new THREE.Sprite(material); sprite.position.copy(position); sprite.scale.set(size * 4, size, 1); scene.add(sprite);
		return sprite;
	}
	const spiralPoints = Array.from({ length: 3201 }, (_, i) => spiralPosition(8 * 2 ** (i / 3200 * 11.3)));
	scenes.overtones.add(new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints(spiralPoints)), gridMaterial));
	for (let semitone = 0; semitone < 12; semitone++) {
		const angle = semitone / 12 * TAU - Math.PI / 2;
		const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), -.04);
		scenes.overtones.add(new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints([direction.clone().multiplyScalar(.5), direction.clone().multiplyScalar(4.8)])), gridMaterial));
		label(['A', 'B♭', 'B', 'C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭'][semitone], direction.clone().multiplyScalar(5.05), scenes.overtones, '#999999', .38);
	}
	for (let octave = -1; octave < 9; octave++) label(`A${octave}`, new THREE.Vector3(.26, spiralPosition(55 * 2 ** (octave - 1)).y, -.02), scenes.overtones, '#818181', .28);
	label('OCTAVES', new THREE.Vector3(0, .04, .05), scenes.overtones, '#999999', .26);

	const surfaceGroup = new THREE.Group(); scenes.tuning.add(surfaceGroup);
	const terrainMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial({ roughness: .85, metalness: .16, side: THREE.DoubleSide }));
	const elevation = positionLocal.y.add(.6).div(2.1).clamp(0, 1);
	const bands = positionLocal.y.mul(14);
	const contour = smoothstep(bands.fwidth().mul(.5).max(.015), bands.fwidth().mul(1.2).max(.03), bands.fract().sub(.5).abs()).oneMinus();
	terrainMaterial.colorNode = mix(color('#11181a'), color('#29232a'), elevation);
	terrainMaterial.emissiveNode = mix(color('#6dc5cb'), color('#bc95c2'), elevation).mul(contour.mul(.6));
	const terrainGeometry = ownGeometry(new THREE.PlaneGeometry(5, 5, 64, 64)); terrainGeometry.rotateX(-Math.PI / 2);
	const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial); terrain.visible = false; surfaceGroup.add(terrain);
	const ambient = new THREE.AmbientLight('#d7e7e8', 2); scenes.tuning.add(ambient);
	const light = new THREE.DirectionalLight('#ffffff', 3); light.position.set(-3, 6, 2); scenes.tuning.add(light);
	const fill = new THREE.DirectionalLight('#9c8bcb', 1); fill.position.set(3, 2, -4); scenes.tuning.add(fill);
	const baseGrid = new THREE.GridHelper(5, 10, '#666666', '#333333'); baseGrid.position.y = -.69; scenes.tuning.add(baseGrid);
	geometries.add(baseGrid.geometry); for (const material of Array.isArray(baseGrid.material) ? baseGrid.material : [baseGrid.material]) { materials.add(material); material.transparent = true; material.opacity = .35; }
	const marker = new THREE.Mesh(sphere, white); marker.scale.setScalar(.07); scenes.tuning.add(marker);
	const markerHalo = new THREE.Sprite(glowMaterials[0]); markerHalo.scale.setScalar(.55); scenes.tuning.add(markerHalo);
	const equalMarker = new THREE.Mesh(ownGeometry(new THREE.TorusGeometry(.07, .012, 8, 40)), ownMaterial(new THREE.MeshBasicNodeMaterial({ color: '#b8b8b8' })));
	equalMarker.rotation.x = -Math.PI / 2; scenes.tuning.add(equalMarker);
	label('−50¢', new THREE.Vector3(-2.5, -.7, 2.85), scenes.tuning);
	label('+50¢', new THREE.Vector3(2.1, -.7, 2.85), scenes.tuning);
	label('−50¢', new THREE.Vector3(2.85, -.7, -2.5), scenes.tuning);
	label('+50¢', new THREE.Vector3(2.85, -.7, 2.1), scenes.tuning);
	label('NOTE 2', new THREE.Vector3(0, -.7, 3.15), scenes.tuning, NOTE_COLORS[1], .28);
	label('NOTE 3', new THREE.Vector3(3.15, -.7, 0), scenes.tuning, NOTE_COLORS[2], .28);

	let disposed = false, frame = 0, lastTime = performance.now(), clock = 0, lastKey = '', lastPair = '', view = '';
	let width = 1, height = 1;
	let surface: RoughnessSurface | null = null, surfaceKey = '', requestedKey = '', requestTimer: ReturnType<typeof setTimeout> | undefined;
	let surfaceRevisionSeen = -1;
	const worker = new Worker(new URL('../harmony/roughness.worker.ts', import.meta.url), { type: 'module' });
	worker.onmessage = ({ data }: MessageEvent<{ key: string; surface: RoughnessSurface }>) => {
		if (disposed || data.key !== requestedKey) return;
		surface = data.surface; surfaceKey = data.key;
		const positions = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < positions.count; i++) positions.setY(i, heightAt(surface.values[i]));
		positions.needsUpdate = true; terrainGeometry.computeVertexNormals(); terrainGeometry.computeBoundingSphere();
		terrain.visible = true; options.onBusy?.(false);
		canvas.dataset.surfaceRevision = String(Number(canvas.dataset.surfaceRevision ?? 0) + 1);
	};
	worker.onerror = () => { options.onBusy?.(false); };
	function heightAt(value: number) {
		if (!surface) return -.6;
		// Show shape without asserting a universal normalized consonance score.
		return -.6 + (value - surface.minimum) / Math.max(1e-7, surface.maximum - surface.minimum) * 1.8;
	}
	function sampleHeight(x: number, z: number) {
		if (!surface) return -.6;
		const column = Math.max(0, Math.min(surface.size - 1, (x + 2.5) / 5 * (surface.size - 1)));
		const row = Math.max(0, Math.min(surface.size - 1, (z + 2.5) / 5 * (surface.size - 1)));
		const a = Math.floor(column), b = Math.floor(row), right = Math.min(surface.size - 1, a + 1), bottom = Math.min(surface.size - 1, b + 1);
		const topValue = THREE.MathUtils.lerp(surface.values[b * surface.size + a], surface.values[b * surface.size + right], column - a);
		const bottomValue = THREE.MathUtils.lerp(surface.values[bottom * surface.size + a], surface.values[bottom * surface.size + right], column - a);
		return heightAt(THREE.MathUtils.lerp(topValue, bottomValue, row - b));
	}
	function disposeGroup(group: THREE.Group) {
		for (const object of [...group.children]) {
			group.remove(object);
			const geometry = (object as THREE.Mesh).geometry;
			// Sprites share Three.js's global quad. Only dispose geometry we own.
			if (geometry && geometry !== sphere && geometries.has(geometry)) { geometry.dispose(); geometries.delete(geometry); }
		}
	}
	let pickable: THREE.Mesh[] = [], pairs: PartialPair[] = [];
	const pointMap = new Map<string, THREE.Vector3>();
	let pairPath: THREE.CatmullRomCurve3 | null = null;
	const pairMaterial = ownMaterial(new THREE.LineBasicNodeMaterial({ color: '#dedede', transparent: true, opacity: .5, depthTest: false }));
	const travelling = new THREE.Mesh(sphere, coreMaterials[0]); travelling.scale.setScalar(.035); scenes.overtones.add(travelling);
	const travellingHalo = new THREE.Sprite(glowMaterials[0]); travellingHalo.scale.setScalar(.45); scenes.overtones.add(travellingHalo);
	function buildOvertones(state: HarmonySceneState) {
		disposeGroup(dynamic); pointMap.clear(); pickable = [];
		pairs = partialPairs(state.spectrum);
		state.spectrum.voices.forEach((voice, lane) => {
			const max = Math.max(.00001, ...voice.partials.map((partial) => partial.amplitude));
			const points: THREE.Vector3[] = [];
			voice.partials.forEach((partial) => {
				const position = spiralPosition(partial.frequency); position.z = lane * .025;
				pointMap.set(partial.id, position); points.push(position);
				const strength = Math.sqrt(partial.amplitude / max);
				const point = new THREE.Mesh(sphere, coreMaterials[lane % 3]); point.position.copy(position); point.scale.setScalar(.027 + strength * .052);
				point.userData.partial = partial.id; dynamic.add(point); pickable.push(point);
				const halo = new THREE.Sprite(glowMaterials[lane % 3]); halo.position.copy(position); halo.scale.setScalar(.18 + strength * .44); dynamic.add(halo);
			});
			if (points.length > 1) {
				const line = new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints(points)), connectionMaterials[lane % 3]); dynamic.add(line);
			}
		});
		canvas.dataset.partialCount = String(pickable.length);
		canvas.dataset.sampleSource = state.spectrum.source;
		lastPair = '';
	}
	function updatePair(state: HarmonySceneState) {
		const pair = pairs.find((candidate) => candidate.id === state.selectedPair) ?? pairs[0];
		const key = pair?.id ?? '-';
		if (lastPair === key) return;
		lastPair = key; disposeGroup(pairGroup); pairPath = null;
		if (!pair) return;
		const a = pointMap.get(pair.a.id), b = pointMap.get(pair.b.id);
		if (!a || !b) return;
		const middle = a.clone().lerp(b, .5).multiplyScalar(.8); middle.z = .15;
		pairPath = new THREE.CatmullRomCurve3([a.clone().setZ(.1), middle, b.clone().setZ(.1)]);
		pairGroup.add(new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints(pairPath.getPoints(80))), pairMaterial));
		for (const position of [a, b]) {
			const ring = new THREE.Mesh(ownGeometry(new THREE.TorusGeometry(.13, .009, 8, 48)), white); ring.position.copy(position); ring.position.z = .1; pairGroup.add(ring);
		}
	}
	function requestSurface(state: HarmonySceneState) {
		if (state.notes.length < 3) { terrain.visible = marker.visible = markerHalo.visible = equalMarker.visible = false; return; }
		marker.visible = markerHalo.visible = equalMarker.visible = true;
		const voices: VoiceSpectrum[] = state.spectrum.voices.map((voice, lane) => {
			const offset = lane === 1 || lane === 2 ? centsOffset(voice.note) : 0;
			return { ...voice, note: { ...voice.note }, partials: voice.partials.map((partial) => ({ ...partial, frequency: partial.frequency / 2 ** (offset / 1200) })) };
		});
		// Normalize out the two live tuning axes so pointer moves only move the marker.
		const key = voices.map((voice) => `${voice.id}:${voice.partials.map((partial) => `${partial.frequency.toFixed(1)},${partial.amplitude.toFixed(3)}`).join(';')}`).join('|');
		if (key === surfaceKey || key === requestedKey) return;
		requestedKey = key; clearTimeout(requestTimer); options.onBusy?.(true);
		requestTimer = setTimeout(() => worker.postMessage({ key, voices }), 100);
	}
	function resize() {
		const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
		renderer.setSize(width, height, false);
		const aspect = width / height;
		const halfHeight = Math.max(5.8, 5.8 / aspect);
		cameras.overtones.left = -halfHeight * aspect; cameras.overtones.right = halfHeight * aspect;
		cameras.overtones.top = halfHeight; cameras.overtones.bottom = -halfHeight;
		cameras.overtones.updateProjectionMatrix(); cameras.tuning.aspect = aspect; cameras.tuning.updateProjectionMatrix();
	}
	const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
	function fit() {
		const current = options.getState().view;
		if (current === 'overtones') { cameras.overtones.zoom = 1; cameras.overtones.position.set(0, 0, 15); controls.overtones.target.set(0, 0, 0); cameras.overtones.updateProjectionMatrix(); }
		else { cameras.tuning.position.set(7.4, 6.2, 7.8); controls.tuning.target.set(0, .25, 0); }
		controls[current].update();
	}
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	let downX = 0, downY = 0, dragging = false;
	function ray(event: PointerEvent) {
		const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
		raycaster.setFromCamera(pointer, cameras[options.getState().view]);
	}
	function tuneAt(event: PointerEvent) {
		ray(event);
		const hit = raycaster.intersectObject(terrain)[0];
		const notes = options.getState().notes;
		if (hit && notes.length >= 3) options.onTune?.([{ id: notes[1].id, cents: Math.max(-50, Math.min(50, hit.point.x * 20)) }, { id: notes[2].id, cents: Math.max(-50, Math.min(50, hit.point.z * 20)) }]);
	}
	function down(event: PointerEvent) {
		downX = event.clientX; downY = event.clientY;
		if (options.getState().view !== 'tuning' || !terrain.visible) return;
		ray(event);
		// Drag the surface to tune; drag its surrounding space to rotate.
		if (event.button === 0 && raycaster.intersectObject(terrain).length) {
			dragging = true; controls.tuning.enabled = false; canvas.setPointerCapture(event.pointerId); tuneAt(event); event.stopImmediatePropagation();
		}
	}
	function move(event: PointerEvent) { if (dragging) { tuneAt(event); event.stopImmediatePropagation(); } }
	function up(event: PointerEvent) {
		if (dragging) { dragging = false; controls.tuning.enabled = options.getState().view === 'tuning'; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); event.stopImmediatePropagation(); return; }
		if (options.getState().view !== 'overtones' || Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return;
		ray(event);
		const hit = raycaster.intersectObjects(pickable)[0];
		const partial = hit?.object.userData.partial;
		const pair = pairs.find((candidate) => candidate.a.id === partial || candidate.b.id === partial);
		if (pair) options.onPickPair?.(pair.id);
	}
	canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointermove', move, true); canvas.addEventListener('pointerup', up, true); canvas.addEventListener('pointercancel', up, true);
	const activity = new SoundActivity();
	let displayedEnvelope = 0;
	function animate(now: number) {
		if (disposed) return;
		frame = requestAnimationFrame(animate);
		const dt = Math.min(.1, (now - lastTime) / 1000); lastTime = now;
		if (document.hidden || !canvas.offsetWidth || !canvas.offsetHeight) return;
		const state = options.getState();
		if (view !== state.view) { view = state.view; controls.overtones.enabled = view === 'overtones'; controls.tuning.enabled = view === 'tuning'; }
		const key = `${state.spectrum.revision}/${state.notes.map((note) => note.frequency).join('/')}`;
		if (key !== lastKey) { lastKey = key; buildOvertones(state); }
		activity.update(options.getOutputLevel(), dt);
		const moving = !state.frozen && (!state.followSound || activity.audible);
		if (moving) clock += dt * state.speed;
		if (!state.frozen) displayedEnvelope = state.followSound ? activity.level : 1;
		const envelope = displayedEnvelope;
		for (const material of glowMaterials) material.opacity = .27 + envelope * .3;
		if (view === 'overtones') {
			updatePair(state);
			travelling.visible = travellingHalo.visible = Boolean(pairPath) && (!state.followSound || activity.audible || state.frozen);
			if (pairPath) {
				const pair = pairs.find((candidate) => candidate.id === state.selectedPair) ?? pairs[0];
				const beatPhase = clock * (pair?.beatHz ?? 0);
				travelling.position.copy(pairPath.getPoint(beatPhase % 1)); travellingHalo.position.copy(travelling.position);
				pairMaterial.opacity = .35 + .3 * (.5 + .5 * Math.cos(TAU * beatPhase)) * envelope;
			}
		} else {
			if (surfaceRevisionSeen !== state.spectrum.revision) { surfaceRevisionSeen = state.spectrum.revision; requestSurface(state); }
			if (state.notes.length >= 3) {
				const x = centsOffset(state.notes[1]) / 20, z = centsOffset(state.notes[2]) / 20;
				marker.position.set(x, sampleHeight(x, z) + .08, z); markerHalo.position.copy(marker.position);
				equalMarker.position.set(0, sampleHeight(0, 0) + .04, 0);
			}
		}
		canvas.dataset.visualFrame = clock.toFixed(6);
		canvas.dataset.motionState = state.frozen ? 'frozen' : state.followSound ? activity.audible ? 'following' : 'silent' : 'free';
		canvas.dataset.view = state.view;
		controls[state.view].update(); renderer.render(scenes[state.view], cameras[state.view]);
	}
	frame = requestAnimationFrame(animate);
	return {
		fit,
		zoom(factor) {
			if (options.getState().view === 'overtones') { cameras.overtones.zoom = THREE.MathUtils.clamp(cameras.overtones.zoom * factor, .4, 18); cameras.overtones.updateProjectionMatrix(); }
			else { const direction = cameras.tuning.position.clone().sub(controls.tuning.target); direction.setLength(THREE.MathUtils.clamp(direction.length() / factor, 2, 28)); cameras.tuning.position.copy(controls.tuning.target).add(direction); }
		},
		dispose() {
			disposed = true; cancelAnimationFrame(frame); clearTimeout(requestTimer); worker.terminate(); observer.disconnect();
			canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointermove', move, true); canvas.removeEventListener('pointerup', up, true); canvas.removeEventListener('pointercancel', up, true);
			for (const control of Object.values(controls)) control.dispose();
			for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); for (const texture of textures) texture.dispose(); renderer.dispose();
		}
	};
}
