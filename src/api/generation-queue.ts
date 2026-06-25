type QueueTask<T> = {
  key: string;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export class GenerationQueue {
  private queue: QueueTask<any>[] = [];
  private running = 0;
  private inflight = new Map<string, Promise<any>>();

  constructor(private readonly concurrency = Number(process.env.GENERATION_CONCURRENCY || "2")) {}

  run<T>(key: string, run: () => Promise<T>): Promise<T> {
    const inflight = this.inflight.get(key);
    if (inflight) return inflight as Promise<T>;

    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.inflight.set(key, promise);
    this.queue.push({ key, run, resolve, reject });
    this.pump();

    promise.finally(() => {
      const current = this.inflight.get(key);
      if (current === promise) this.inflight.delete(key);
    });

    return promise;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;
      this.running += 1;
      Promise.resolve()
        .then(() => task.run())
        .then(task.resolve, task.reject)
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }
}

export const generationQueue = new GenerationQueue();
