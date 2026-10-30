import { describe, expect, it } from 'vitest';
import { atlasChord, identifyTriad, nearestVoicing, pitchClass, tonnetz, transformTriad } from './atlas';
describe('musical lattice and transformations',()=>{
	it('makes every horizontal neighbor a fifth and every cell a real triad',()=>{
		const {nodes,triangles}=tonnetz();
		for(const node of nodes){const right=nodes.find((other)=>other.q===node.q+1&&other.r===node.r);if(right)expect(pitchClass(right.pitch-node.pitch)).toBe(7);const up=nodes.find((other)=>other.q===node.q&&other.r===node.r+1);if(up)expect(pitchClass(up.pitch-node.pitch)).toBe(4);}
		for(const triangle of triangles){const actual=identifyTriad(triangle.nodes.map((node)=>node.pitch));expect(actual?.root).toBe(triangle.chord.root);expect(actual?.quality).toBe(triangle.chord.quality);}
	});
	it('P, R and L are involutions sharing two pitch classes',()=>{
		for(let root=0;root<12;root++)for(const quality of ['major','minor'] as const)for(const operation of ['parallel','relative','leading'] as const){const chord=atlasChord(root,quality),changed=transformTriad(chord,operation);expect(transformTriad(changed,operation)).toEqual(chord);expect(chord.notes.filter((note)=>changed.notes.some((other)=>pitchClass(other)===pitchClass(note)))).toHaveLength(2);}
	});
	it('keeps common tones and chooses nearby octaves',()=>{
		expect(nearestVoicing([48,52,55],[48,51,55])).toEqual([48,51,55]);
		expect(nearestVoicing([48,52,55],[57,60,64])).toEqual([48,52,57]);
		expect(identifyTriad([55,60,64])?.label).toBe('C');
		expect(identifyTriad([48,50,55])).toBeNull();
	});
});
