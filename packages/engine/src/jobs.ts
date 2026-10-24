/**
 * Bounded replay queue: at most `max` jobs run at once (each owns its own Anvil processes),
 * and every job is aborted after `timeoutMs`, which kills its Anvil children.
 */
export class JobQueue {
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(
    readonly max: number,
    readonly timeoutMs: number,
  ) {}

  get stats() {
    return { running: this.running, queued: this.waiting.length, max: this.max, timeoutMs: this.timeoutMs };
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    try {
      return await Promise.race([
        fn(ac.signal),
        new Promise<never>((_, reject) => ac.signal.addEventListener("abort", () => reject(new Error(`Replay job timed out after ${this.timeoutMs} ms; its Anvil processes were stopped.`)))),
      ]);
    } finally {
      clearTimeout(timer);
      if (!ac.signal.aborted) ac.abort();
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
