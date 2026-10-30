/** Audio envelope with hysteresis: natural decays stop motion without flickering at silence. */
export class SoundActivity {
	level = 0;
	audible = false;
	private quietTime = 0;

	update(rms: number, delta: number): void {
		const value = Number.isFinite(rms) ? Math.max(0, rms) : 0;
		const dt = Math.max(0, Math.min(.1, delta));
		if (value >= .001) { this.audible = true; this.quietTime = 0; }
		else if (value < .0005) {
			this.quietTime += dt;
			if (this.quietTime >= .12) this.audible = false;
		} else this.quietTime = 0;
		const target = this.audible ? Math.min(1, Math.sqrt(Math.max(0, value - .0005) / .05)) : 0;
		const response = target > this.level ? .018 : .07;
		this.level += (target - this.level) * (1 - Math.exp(-dt / response));
		if (this.level < .001) this.level = 0;
	}
}
