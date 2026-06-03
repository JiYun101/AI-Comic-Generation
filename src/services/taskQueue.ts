import { sleep } from "../lib/utils";

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  const queue = [...items.entries()];
  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      const [index, item] = next;
      await worker(item, index);
      await sleep(20);
    }
  });

  await Promise.all(workers);
}
