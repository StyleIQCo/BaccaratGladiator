// Owns the escalating multiplier. Curve is time-based + deterministic; the crash
// POINT comes from the provably-fair hand (set via arm()), so what the player
// sees is reproducible and auditable.
export class CrashController {
  multiplier = 1.0;
  crashed = false;
  private crashPoint = 1.0;
  private growth: number;

  constructor(growth = 0.00006) { this.growth = growth; }

  arm(crashPoint: number) {
    this.crashPoint = crashPoint;
    this.multiplier = 1.0;
    this.crashed = false;
  }

  /** Advance for `elapsedMs` into DEALING. Returns true once, on the crash tick. */
  tick(elapsedMs: number): boolean {
    if (this.crashed) return false;
    const m = Math.exp(this.growth * elapsedMs); // m = e^(k·t)
    if (m >= this.crashPoint) {
      this.multiplier = this.crashPoint;
      this.crashed = true;
      return true;
    }
    this.multiplier = +m.toFixed(2);
    return false;
  }

  /** PAYOUT safety: force crashed even if ticks were missed. */
  finalize() { this.multiplier = this.crashPoint; this.crashed = true; }
}
