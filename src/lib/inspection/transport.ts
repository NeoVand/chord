import { SoundActivity } from '../visualization/activity';
import { advanceSweep } from '../visualization/signals';

export interface TransportState { speed: number; frozen: boolean; followSound: boolean }
export interface TransportFrame {
	/** Shared visual seconds. One Scope sweep takes one visual second. */
	time: number;
	delta: number;
	progress: number;
	level: number;
	audible: boolean;
	moving: boolean;
	motion: 'frozen' | 'following' | 'silent' | 'free';
}
export const EMPTY_TRANSPORT: Readonly<TransportFrame> = Object.freeze({
	time: 0, delta: 0, progress: .2, level: 0, audible: false, moving: false, motion: 'silent'
});

/** One output follower and visual clock, independent of which scene is mounted. */
export class InspectionTransport {
	private activity = new SoundActivity();
	private lastTime: number | null = null;
	private wasVisible = true;
	frame: Readonly<TransportFrame> = EMPTY_TRANSPORT;
	update(now: number, rms: number, state: TransportState, visible = true): Readonly<TransportFrame> {
		const delta = this.lastTime === null || !visible || !this.wasVisible ? 0 : Math.max(0, Math.min(.1, (now - this.lastTime) / 1000));
		this.lastTime = now; this.wasVisible = visible;
		this.activity.update(rms, delta);
		const moving = visible && !state.frozen && (!state.followSound || this.activity.audible);
		const time = advanceSweep(this.frame.time, delta, state.speed, !moving);
		this.frame = {
			time, delta, progress: (.2 + time) % 1,
			level: state.frozen ? this.frame.level : state.followSound ? this.activity.level : 1,
			audible: this.activity.audible, moving,
			motion: state.frozen ? 'frozen' : state.followSound ? this.activity.audible ? 'following' : 'silent' : 'free'
		};
		return this.frame;
	}
}
