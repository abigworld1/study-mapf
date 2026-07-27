/** 小さな依存なし binary min-heap。比較が負なら a が先。 */
export class MinHeap<T> {
  private readonly values: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.values.length;
  }

  push(value: T): void {
    const index = this.values.length;
    this.values.push(value);
    this.bubbleUp(index);
  }

  peek(): T | undefined {
    return this.values[0];
  }

  pop(): T | undefined {
    const root = this.values[0];
    const last = this.values.pop();
    if (root === undefined || last === undefined) return root;
    if (this.values.length > 0) {
      this.values[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  private bubbleUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[index]!, this.values[parent]!) >= 0) break;
      [this.values[index], this.values[parent]] = [this.values[parent]!, this.values[index]!];
      index = parent;
    }
  }

  private bubbleDown(start: number): void {
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.values.length &&
        this.compare(this.values[left]!, this.values[smallest]!) < 0
      ) {
        smallest = left;
      }
      if (
        right < this.values.length &&
        this.compare(this.values[right]!, this.values[smallest]!) < 0
      ) {
        smallest = right;
      }
      if (smallest === index) return;
      [this.values[index], this.values[smallest]] = [this.values[smallest]!, this.values[index]!];
      index = smallest;
    }
  }
}
