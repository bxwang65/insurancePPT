/** 提取并发队列: 控制 LLM API 并发数，防止被限流 */
export class ExtractionQueue {
  private queue: Array<{ run: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];
  private running = 0;
  private maxConcurrency: number;

  constructor(maxConcurrency = 3) {
    this.maxConcurrency = Number(process.env.EXTRACTION_CONCURRENCY || String(maxConcurrency));
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      try { return await fn(); }
      finally { this.running--; this.processQueue(); }
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run: fn, resolve, reject });
    });
  }

  private processQueue() {
    while (this.running < this.maxConcurrency && this.queue.length) {
      const item = this.queue.shift()!;
      this.running++;
      item.run().then(item.resolve).catch(item.reject).finally(() => {
        this.running--;
        this.processQueue();
      });
    }
  }
}

export const extractionQueue = new ExtractionQueue(5);
