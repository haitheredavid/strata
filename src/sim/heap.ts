/**
 * Binary min-heap. Equal keys come out in insertion order, so it can stand in for a stable sort
 * followed by `shift()`.
 */
export class MinHeap<T> {
  private items: { key: number; seq: number; value: T }[] = []
  private seq = 0

  get size() {
    return this.items.length
  }

  push(key: number, value: T) {
    const a = this.items
    a.push({ key, seq: this.seq++, value })
    let i = a.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(i, parent)) break
      ;[a[i], a[parent]] = [a[parent], a[i]]
      i = parent
    }
  }

  pop(): T | undefined {
    const a = this.items
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && this.less(l, m)) m = l
        if (r < a.length && this.less(r, m)) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top.value
  }

  private less(i: number, j: number) {
    const a = this.items[i]
    const b = this.items[j]
    return a.key < b.key || (a.key === b.key && a.seq < b.seq)
  }
}
