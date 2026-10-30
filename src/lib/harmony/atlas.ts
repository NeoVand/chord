import { NOTE_NAMES, chordNotes } from '../music/theory';

export type TriadQuality = 'major' | 'minor';
export interface AtlasChord { root: number; quality: TriadQuality; label: string; notes: number[] }
export interface LatticeNode { id: string; q: number; r: number; pitch: number; x: number; y: number }
export interface LatticeTriangle { id: string; nodes: LatticeNode[]; chord: AtlasChord }
export const pitchClass = (note: number) => ((note % 12) + 12) % 12;
export function atlasChord(root: number, quality: TriadQuality = 'major'): AtlasChord {
	root=pitchClass(root);return {root,quality,label:NOTE_NAMES[root]+(quality==='minor'?'m':''),notes:chordNotes(root,quality)};
}
export function identifyTriad(notes: readonly number[]): AtlasChord | null {
	const pitches=[...new Set(notes.map(pitchClass))];if(pitches.length!==3)return null;
	for(const root of pitches)for(const quality of ['major','minor'] as const){const chord=atlasChord(root,quality);if(chord.notes.every((note)=>pitches.includes(pitchClass(note))))return chord;}
	return null;
}
/** Horizontal edges are fifths. The rising diagonals are major and minor thirds. */
export function tonnetz(anchor=0): {nodes:LatticeNode[];triangles:LatticeTriangle[]} {
	const nodes:LatticeNode[]=[];
	for(let r=-2;r<=2;r++)for(let q=-3;q<=3;q++)nodes.push({id:`${q}:${r}`,q,r,pitch:pitchClass(anchor+7*q+4*r),x:400+93*(q+r/2),y:250-81*r});
	const find=(q:number,r:number)=>nodes.find((node)=>node.q===q&&node.r===r);
	const triangles:LatticeTriangle[]=[];
	for(const node of nodes){const right=find(node.q+1,node.r),up=find(node.q,node.r+1),diagonal=find(node.q+1,node.r+1);
		if(right&&up)triangles.push({id:`major:${node.id}`,nodes:[node,up,right],chord:atlasChord(node.pitch)});
		if(right&&up&&diagonal)triangles.push({id:`minor:${node.id}`,nodes:[up,right,diagonal],chord:atlasChord(up.pitch,'minor')});
	}
	return {nodes,triangles};
}
export function transformTriad(chord: AtlasChord, kind:'parallel'|'relative'|'leading'): AtlasChord {
	const major=chord.quality==='major';
	const offset=kind==='parallel'?0:kind==='relative'?(major?9:3):(major?4:8);
	return atlasChord(chord.root+offset,major?'minor':'major');
}
/** Minimum total semitone motion, including octave placement, over every voice assignment. */
export function nearestVoicing(from: readonly number[], target: readonly number[]): number[] {
	if(from.length!==3||target.length!==3)return [...target];
	const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
	let best=[...target],distance=Infinity;
	for(const order of permutations){const candidate=order.map((index,i)=>{const pc=pitchClass(target[index]);return pc+12*Math.round((from[i]-pc)/12);});const cost=candidate.reduce((sum,note,i)=>sum+Math.abs(note-from[i]),0);
		if(cost<distance){distance=cost;best=candidate;}
	}
	return best;
}
export function voicePaths(from: readonly number[], to: readonly number[]) {
	return from.slice(0,3).map((note,i)=>({from:note,to:to[i]??note,semitones:(to[i]??note)-note,common:(to[i]??note)===note}));
}
