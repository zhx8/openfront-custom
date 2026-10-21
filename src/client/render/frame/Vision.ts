/**
 * Fog of war vision: which parts of the map the local player can see.
 *
 * The map is split into square cells. A cell is visible when it lies within
 * the vision radius of a cell holding the player's land, or of one of the
 * player's units (ships and planes scout). Land ownership is tracked
 * incrementally from each tick's changed tiles, so the per-tick cost is the
 * changed tiles plus one pass over the (small) cell grid.
 *
 * Rendering only: the simulation is unaffected, so every client stays in
 * sync whatever it can see.
 */

import { OWNER_MASK } from "../gl/utils/TileCodec";

export class VisionTracker {
  readonly cellSize: number;
  readonly cellsW: number;
  readonly cellsH: number;
  private readonly radiusCells: number;
  // Tiles of ours per cell.
  private readonly ownedPerCell: Int32Array;
  // 1 where the tile is ours, to update ownedPerCell from deltas.
  private readonly mine: Uint8Array;
  private readonly sources: Uint8Array;
  readonly visible: Uint8Array;
  private owner = -1;

  constructor(
    private readonly mapW: number,
    private readonly mapH: number,
    visionRadiusTiles = 40,
    cellSize = 16,
  ) {
    this.cellSize = cellSize;
    this.cellsW = Math.ceil(mapW / cellSize);
    this.cellsH = Math.ceil(mapH / cellSize);
    this.radiusCells = Math.ceil(visionRadiusTiles / cellSize);
    this.ownedPerCell = new Int32Array(this.cellsW * this.cellsH);
    this.mine = new Uint8Array(mapW * mapH);
    this.sources = new Uint8Array(this.cellsW * this.cellsH);
    this.visible = new Uint8Array(this.cellsW * this.cellsH);
  }

  private cellOf(tile: number): number {
    const x = tile % this.mapW;
    const y = (tile - x) / this.mapW;
    return (
      Math.floor(y / this.cellSize) * this.cellsW +
      Math.floor(x / this.cellSize)
    );
  }

  private setMine(tile: number, isMine: boolean): void {
    const v = isMine ? 1 : 0;
    if (this.mine[tile] === v) return;
    this.mine[tile] = v;
    this.ownedPerCell[this.cellOf(tile)] += isMine ? 1 : -1;
  }

  /**
   * @param changedTiles null for "everything may have changed" (first tick).
   * @param unitTiles tiles of the player's own (and allies') units.
   */
  update(
    tileState: Uint16Array,
    changedTiles: readonly number[] | null,
    ownerSmallID: number,
    unitTiles: Iterable<number>,
  ): void {
    if (changedTiles === null || ownerSmallID !== this.owner) {
      this.owner = ownerSmallID;
      this.mine.fill(0);
      this.ownedPerCell.fill(0);
      for (let t = 0; t < tileState.length; t++) {
        if ((tileState[t] & OWNER_MASK) === ownerSmallID) this.setMine(t, true);
      }
    } else {
      for (const t of changedTiles) {
        this.setMine(t, (tileState[t] & OWNER_MASK) === ownerSmallID);
      }
    }

    this.sources.fill(0);
    for (let c = 0; c < this.ownedPerCell.length; c++) {
      if (this.ownedPerCell[c] > 0) this.sources[c] = 1;
    }
    for (const t of unitTiles) this.sources[this.cellOf(t)] = 1;

    // Dilate the sources by the vision radius (a disc, in cells).
    this.visible.fill(0);
    const r = this.radiusCells;
    for (let cy = 0; cy < this.cellsH; cy++) {
      for (let cx = 0; cx < this.cellsW; cx++) {
        if (!this.sources[cy * this.cellsW + cx]) continue;
        const y0 = Math.max(0, cy - r);
        const y1 = Math.min(this.cellsH - 1, cy + r);
        for (let y = y0; y <= y1; y++) {
          const dy = y - cy;
          const span = Math.floor(Math.sqrt(r * r - dy * dy));
          const x0 = Math.max(0, cx - span);
          const x1 = Math.min(this.cellsW - 1, cx + span);
          this.visible.fill(1, y * this.cellsW + x0, y * this.cellsW + x1 + 1);
        }
      }
    }
  }

  isVisible(tile: number): boolean {
    return this.visible[this.cellOf(tile)] === 1;
  }
}
