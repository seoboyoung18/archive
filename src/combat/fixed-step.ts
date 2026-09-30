const STEP_MS = 1000 / 60;
export class FixedStep {
  private pending = 0;
  reset() { this.pending = 0; }
  advance(deltaMs: number, step: () => void): number {
    this.pending += Math.max(0, deltaMs);
    let count = 0;
    while (this.pending + 1e-8 >= STEP_MS && count < 5) {
      this.pending = Math.max(0, this.pending - STEP_MS);
      step(); count++;
    }
    if (this.pending + 1e-8 >= STEP_MS) this.pending = 0;
    return count;
  }
}
