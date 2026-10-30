import * as THREE from 'three/webgpu';
import { Fn, attribute, color, mix, positionGeometry, smoothstep, uniform, uv, varying, vec2, vec4 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { PlotState, PlotView, ScopeController, ScopeOptions } from '../types';
import { NOTE_COLORS } from '../music/theory';
import type { SignalSnapshot } from './capture';
import { resolveAxisIds } from '../inspection/axes';
import { CURVE_POINTS, WAVE_POINTS, pathDistances, simplifyPath, sourceProgress } from './path';

interface Path {
	positions: Float32Array;
	progress: Float32Array;
	lane: number;
	geometry: LineGeometry | null;
	lines: Line2[];
}

/** Immutable full paths, adaptive tessellation, and a uniform-only GPU sweep. */
export async function createScope(canvas: HTMLCanvasElement, options: ScopeOptions): Promise<ScopeController> {
	const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x000000, 0);
	try { await renderer.init(); }
	catch (error) { renderer.dispose(); options.onStatus?.('unavailable'); throw error; }
	const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
	options.onStatus?.(backend.isWebGPUBackend ? 'webgpu' : 'webgl');
	const scene = new THREE.Scene();
	const home = new THREE.Vector3(3.2, 1.95, 3.9);
	// Orthographic inspection keeps zoom from flying through/clipping the shape.
	const camera = new THREE.OrthographicCamera(-2, 2, 1.7, -1.7, .001, 100);
	camera.position.copy(home);
	const flatCameras = {
		'2d': new THREE.OrthographicCamera(-2, 2, 1.6, -1.6, .001, 100),
		waveform: new THREE.OrthographicCamera(-2, 2, 1.6, -1.6, .001, 100)
	};
	const cameras = { '3d': camera, ...flatCameras };
	const fitZoom = { '3d': 1, '2d': 1, waveform: 1 };
	const initializedViews = new Set<PlotView>();
	const touchedViews = new Set<PlotView>();
	const controls = {} as Record<PlotView, OrbitControls>;
	for (const view of ['3d', '2d', 'waveform'] as const) {
		const current = cameras[view];
		if (view !== '3d') current.position.set(0, 0, 8);
		const control = new OrbitControls(current, canvas);
		control.enabled = false;
		control.enableDamping = false;
		control.enablePan = true;
		control.enableRotate = view === '3d';
		control.minDistance = .07; control.maxDistance = 30;
		control.minZoom = .4; control.maxZoom = 128;
		control.zoomToCursor = true;
		control.zoomSpeed = .6;
		control.rotateSpeed = .65;
		control.panSpeed = .8;
		control.autoRotateSpeed = .25;
		control.addEventListener('start', () => touchedViews.add(view));
		if (view !== '3d') {
			control.mouseButtons.LEFT = THREE.MOUSE.PAN;
			control.touches.ONE = THREE.TOUCH.PAN;
		}
		controls[view] = control;
	}
	const grid = new THREE.GridHelper(18, 36, 0x4a4a4a, 0x262626);
	grid.position.y = -1.25;
	const flatGrid = new THREE.GridHelper(12, 36, 0x3b3b3b, 0x222222);
	flatGrid.rotation.x = Math.PI / 2; flatGrid.position.z = -.05;
	for (const object of [grid, flatGrid]) {
		for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
			material.transparent = true; material.opacity = object === grid ? .1 : .16; material.depthWrite = false;
		}
		scene.add(object);
	}

	const head = uniform(.2);
	const tail = uniform(.12);
	const waveformColor = uniform(0);
	const activity = uniform(0);
	const endpoint = positionGeometry.y.lessThan(.5);
	const progress = varying(endpoint.select(attribute('instanceProgress', 'vec2').x, attribute('instanceProgress', 'vec2').y));
	const pigment = varying(endpoint.select(attribute('instanceColorStart', 'vec3'), attribute('instanceColorEnd', 'vec3')));
	const behind = head.sub(progress).add(1).fract();
	const fade = smoothstep(0, tail, behind).oneMinus();
	const tip = smoothstep(0, .006, behind).oneMinus();
	// Antialiased round caps in Line2's screen-space quad coordinates.
	const capDistance = vec2(uv().x, uv().y.abs().sub(1).max(0)).length();
	const edge = capDistance.fwidth().max(.001);
	const coverage = smoothstep(edge.oneMinus(), edge.add(1), capDistance).oneMinus();
	const makeMaterial = (layer: 'base' | 'halo' | 'snake') => {
		const material = new THREE.Line2NodeMaterial({
			linewidth: layer === 'base' ? 1.05 : layer === 'halo' ? 5 : 1.8,
			transparent: true, blending: THREE.NormalBlending,
			depthWrite: false, depthTest: false, alphaToCoverage: false
		});
		// Custom fragments avoid Line2's opaque-viewport transparency approximation.
		// Normal blending bounds brightness at dense self-intersections.
		material.fragmentNode = layer === 'base'
			? vec4(mix(color('#a0a0a0'), pigment.mul(.9), waveformColor), coverage.mul(.7))
			: Fn(() => {
				behind.greaterThan(tail).discard();
				return layer === 'halo'
					? vec4(pigment, coverage.mul(fade.pow(2)).mul(.13).mul(activity))
					: vec4(mix(pigment, color('#ffffff'), tip.mul(.3)), coverage.mul(fade.mul(.85).add(tip.mul(.15))).mul(activity));
			})();
		return material;
	};
	const materials = [makeMaterial('base'), makeMaterial('halo'), makeMaterial('snake')];
	const palette = NOTE_COLORS.map((value) => new THREE.Color(value));
	// Route cyan through violet before coral to avoid a washed-out complementary midpoint.
	let curvePalette = [palette[0], palette[2], palette[1]];
	const colorValue = new THREE.Color();
	let paths: Path[] = [];
	let disposed = false, frame = 0;
	let traceProgress = .2;
	let pathSignature = '', lastView: PlotView | '' = '';
	let geometryRevision = 0, lastLod = -1, lastZoom = -1;
	let width = 1, height = 1;
	let needsResizeFit = false;
	const magnification = (view = options.getState().view) => cameras[view].zoom / fitZoom[view];

	function clearPaths() {
		for (const path of paths) {
			for (const line of path.lines) scene.remove(line);
			path.geometry?.dispose();
		}
		paths = []; lastLod = -1;
	}

	function buildPaths(snapshot: SignalSnapshot, state: PlotState) {
		clearPaths();
		const waveform = state.view === 'waveform';
		const axes = resolveAxisIds(snapshot.notes, state.axisIds);
		const ids = waveform ? snapshot.notes.map((note) => note.id) : axes.slice(0, state.view === '2d' ? 2 : 3);
		const indices = ids.map((id) => snapshot.notes.findIndex((note) => note.id === id));
		const notes = indices.map((index) => snapshot.notes[index]);
		const count = waveform ? WAVE_POINTS : CURVE_POINTS;
		const duration = waveform ? Math.min(snapshot.duration, 4 / Math.min(...snapshot.notes.map((n) => n.frequency))) : snapshot.duration;
		const samples = indices.map((index) => Float32Array.from({ length: count }, (_, i) => snapshot.sample(index, duration * i / (count - 1))));
		curvePalette = [indices[0] ?? 0, indices[2] ?? indices[1] ?? 0, indices[1] ?? 0].map((index) => palette[index % palette.length]);
		// One normalization committed with the complete capture. No gain animation.
		const gain = snapshot.preview ? 1 : Math.min(30, 1 / Math.max(.025, snapshot.peak));
		const lanes = waveform ? notes.length : notes.length >= (state.view === '2d' ? 2 : 3) ? 1 : 0;
		for (let lane = 0; lane < lanes; lane++) {
			const positions = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				if (waveform) {
					positions[i * 3] = (i / (count - 1) * 2 - 1) * 1.65;
					const spacing = 2.2 / notes.length;
					positions[i * 3 + 1] = samples[lane][i] * gain * Math.min(.75, spacing * .4) + ((notes.length - 1) / 2 - lane) * spacing;
				} else {
					positions[i * 3] = samples[0][i] * gain;
					positions[i * 3 + 1] = samples[1][i] * gain;
					positions[i * 3 + 2] = state.view === '3d' ? samples[2][i] * gain : 0;
				}
			}
			paths.push({ positions, progress: waveform ? Float32Array.from({ length: count }, (_, i) => i / (count - 1)) : pathDistances(positions), lane, geometry: null, lines: [] });
		}
		canvas.dataset.geometryRevision = String(++geometryRevision);
		canvas.dataset.sourcePoints = String(count);
		canvas.dataset.signalPeak = snapshot.peak.toFixed(5);
		canvas.dataset.captureRevision = String(snapshot.revision);
		canvas.dataset.axisPeaks = samples.slice(0, 3).map((samples) => samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0).toFixed(5)).join(',');
		canvas.dataset.axisIds = ids.join(',');
	}

	function fitView(view = options.getState().view) {
		const current = cameras[view], control = controls[view];
		if (!paths.length) return;
		current.updateMatrixWorld();
		const point = new THREE.Vector3();
		const bounds = new THREE.Box3();
		for (const path of paths) for (let i = 0; i < path.positions.length; i += 3) {
			point.fromArray(path.positions, i).applyMatrix4(current.matrixWorldInverse);
			bounds.expandByPoint(point);
		}
		const center = bounds.getCenter(new THREE.Vector3());
		const size = bounds.getSize(new THREE.Vector3());
		const top = width < 600 ? 76 : 40, bottom = width < 600 ? 34 : 40;
		const availableWidth = Math.max(.3, (width - 72) / width);
		const availableHeight = Math.max(.3, (height - top - bottom) / height);
		current.zoom = THREE.MathUtils.clamp(.94 * Math.min(
			(current.right - current.left) * availableWidth / Math.max(.08, size.x),
			(current.top - current.bottom) * availableHeight / Math.max(.08, size.y)
		), .4, 16);
		// Center inside the usable plot region, leaving room for the mobile heading.
		center.y += (top - bottom) / height * (current.top - current.bottom) / (2 * current.zoom);
		const shift = new THREE.Vector3(center.x, center.y, 0).applyQuaternion(current.quaternion);
		current.position.add(shift); control.target.add(shift);
		fitZoom[view] = current.zoom;
		control.minZoom = current.zoom * .4; control.maxZoom = current.zoom * 128;
		current.updateProjectionMatrix(); control.update();
		initializedViews.add(view); touchedViews.delete(view); lastLod = -1; lastZoom = -1;
	}
	const handleDoubleClick = () => fitView();
	canvas.addEventListener('dblclick', handleDoubleClick);

	function tessellate(view: PlotView, lod: number) {
		let segments = 0;
		// Subpixel tolerance at the current zoom bucket; the full source is retained.
		const tolerance = .6 / Math.max(400, height) / 2 ** lod;
		for (const path of paths) {
			const indices = simplifyPath(path.positions, tolerance);
			const vertices = new Float32Array(indices.length * 3);
			const colors = new Float32Array(indices.length * 3);
			const parameters = new Float32Array((indices.length - 1) * 2);
			indices.forEach((index, i) => {
				vertices.set(path.positions.subarray(index * 3, index * 3 + 3), i * 3);
				const t = path.progress[index];
				if (view === 'waveform') colorValue.copy(palette[path.lane % palette.length]);
				else {
					const segment = Math.min(1, Math.floor(t * 2));
					colorValue.copy(curvePalette[segment]).lerp(curvePalette[segment + 1], t * 2 - segment);
				}
				colors.set([colorValue.r, colorValue.g, colorValue.b], i * 3);
				if (i < indices.length - 1) { parameters[i * 2] = t; parameters[i * 2 + 1] = path.progress[indices[i + 1]]; }
			});
			const geometry = new LineGeometry();
			geometry.setPositions(vertices); geometry.setColors(colors);
			geometry.setAttribute('instanceProgress', new THREE.InstancedBufferAttribute(parameters, 2));
			path.geometry?.dispose(); path.geometry = geometry;
			if (!path.lines.length) {
				path.lines = materials.map((material, i) => {
					const line = new Line2(geometry, material);
					line.frustumCulled = false; line.renderOrder = i + 1; scene.add(line);
					return line;
				});
			} else for (const line of path.lines) line.geometry = geometry;
			segments += indices.length - 1;
		}
		lastLod = lod;
		canvas.dataset.renderSegments = String(segments);
	}

	function resize() {
		const rect = canvas.getBoundingClientRect();
		width = Math.max(1, rect.width); height = Math.max(1, rect.height);
		renderer.setSize(width, height, false);
		const aspect = width / height;
		for (const current of Object.values(cameras)) {
			const halfHeight = aspect < 1.2 ? 1.9 / aspect : current === camera ? 1.7 : 1.55;
			current.left = -halfHeight * aspect; current.right = halfHeight * aspect;
			current.top = halfHeight; current.bottom = -halfHeight; current.updateProjectionMatrix();
		}
		lastLod = -1;
		needsResizeFit = true;
	}
	const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

	function animate() {
		if (disposed) return;
		frame = requestAnimationFrame(animate);
		if (document.hidden || options.isVisible?.() === false) return;
		const state = options.getState();
		const { signal: snapshot, captureStatus, transport } = options.getInspection();
		activity.value = transport.level;
		const axes = resolveAxisIds(snapshot?.notes ?? state.notes, state.axisIds);
		const signature = snapshot ? `${snapshot.revision}/${state.view}/${state.view === 'waveform' ? '' : axes.join('/')}` : '';
		if (signature !== pathSignature) {
			pathSignature = signature;
			if (snapshot) buildPaths(snapshot, state); else clearPaths();
		}
		if (state.view !== lastView) {
			for (const view of ['3d', '2d', 'waveform'] as const) controls[view].enabled = view === state.view;
			lastView = state.view; lastZoom = -1; lastLod = -1;
		}
		if (paths.length && (!initializedViews.has(state.view) || needsResizeFit && !touchedViews.has(state.view))) fitView(state.view);
		needsResizeFit = false;
		grid.visible = state.view === '3d'; flatGrid.visible = state.view !== '3d';
		waveformColor.value = state.view === 'waveform' ? 1 : 0;
		controls['3d'].autoRotate = state.autoRotate && transport.moving && state.view === '3d';
		controls[state.view].update(transport.delta);
		const zoom = magnification(state.view);
		const lod = Math.max(0, Math.ceil(Math.log2(Math.max(1, cameras[state.view].zoom))));
		if (lod !== lastLod) tessellate(state.view, lod);
		if (Math.abs(zoom - lastZoom) > .005) { lastZoom = zoom; options.onZoom?.(zoom); }
		head.value = transport.progress; tail.value = Math.max(.02, Math.min(.35, state.trail));
		traceProgress = paths[0] ? sourceProgress(paths[0].progress, head.value) : head.value;
		canvas.dataset.sampleSource = captureStatus === 'idle' ? 'idle' : captureStatus === 'capturing' ? 'waiting' : snapshot ? snapshot.preview ? 'preview' : 'captured' : 'waiting';
		canvas.dataset.captureRevision = String(snapshot?.revision ?? 0);
		canvas.dataset.visualFrame = transport.time.toFixed(6);
		canvas.dataset.zoom = zoom.toFixed(3);
		canvas.dataset.traceProgress = traceProgress.toFixed(6);
		canvas.dataset.signalActivity = activity.value.toFixed(5);
		canvas.dataset.motionState = transport.motion;
		renderer.render(scene, cameras[state.view]);
	}
	frame = requestAnimationFrame(animate);
	return {
		getTraceProgress() { return traceProgress; },
		fitView,
		zoom(factor) {
			if (!Number.isFinite(factor) || factor <= 0) return;
			const view = options.getState().view;
			touchedViews.add(view);
			cameras[view].zoom = THREE.MathUtils.clamp(cameras[view].zoom * factor, fitZoom[view] * .4, fitZoom[view] * 128);
			cameras[view].updateProjectionMatrix();
			controls[view].update();
		},
		resetView() {
			const view = options.getState().view;
			if (view !== '3d') { fitView(view); return; }
			camera.position.copy(controls[view].target).add(home);
			touchedViews.add(view);
			controls[view].update();
		},
		dispose() {
			disposed = true; cancelAnimationFrame(frame); observer.disconnect();
			canvas.removeEventListener('dblclick', handleDoubleClick);
			for (const control of Object.values(controls)) control.dispose();
			clearPaths();
			for (const material of materials) material.dispose();
			for (const object of [grid, flatGrid]) {
				object.geometry.dispose();
				for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
			}
			renderer.dispose();
		}
	};
}
