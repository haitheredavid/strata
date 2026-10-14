/**
 * Uniform grid over up to three axes. Points go into cells of `size`; `near` returns the indices in a
 * point's cell and the cells around it. With `size` at least the largest interaction distance, every
 * pair closer than that is found without an all-pairs scan.
 */
export class GridHash {
  private cells = new Map<number, number[]>()
  private size: number

  constructor(size: number) {
    this.size = size
  }

  clear(size = this.size) {
    this.size = size
    this.cells.clear()
  }

  /** Cell index of a coordinate. */
  cell = (v: number) => Math.floor(v / this.size)

  insert(i: number, x: number, y = 0, z = 0) {
    const k = key(this.cell(x), this.cell(y), this.cell(z))
    const c = this.cells.get(k)
    if (c) c.push(i)
    else this.cells.set(k, [i])
  }

  /**
   * Indices in the 3×3(×3) block of cells around a point, into `out` (cleared first). `dims` is how
   * many axes are in use, so a 2D grid checks 9 cells, not 27.
   */
  near(out: number[], dims: 1 | 2 | 3, x: number, y = 0, z = 0): number[] {
    out.length = 0
    const cx = this.cell(x)
    const cy = this.cell(y)
    const cz = this.cell(z)
    const ry = dims >= 2 ? 1 : 0
    const rz = dims >= 3 ? 1 : 0
    for (let a = -1; a <= 1; a++)
      for (let b = -ry; b <= ry; b++)
        for (let c = -rz; c <= rz; c++) {
          const cell = this.cells.get(key(cx + a, cy + b, cz + c))
          if (cell) for (const i of cell) out.push(i)
        }
    return out
  }
}

// 16 bits per axis, offset to stay positive: ±32k cells, well inside 2^53.
const key = (x: number, y: number, z: number) => ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768)
