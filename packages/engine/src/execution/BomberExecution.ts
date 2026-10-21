import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

// A bomber launches from the player's nearest ready airfield, flies a
// straight line over any terrain, and on arrival knocks one level off every
// enemy structure within the blast radius. It captures no land.
export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber: Unit | null = null;
  private src: TileRef | null = null;
  // Distance flown along the line, in Chebyshev tiles.
  private flown = 0;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.bomber === null) {
      const spawn = this.player.canBuild(UnitType.Bomber, this.dst);
      if (spawn === false) {
        this.active = false;
        return;
      }
      const airfield = this.player
        .units(UnitType.Airfield)
        .find((a) => a.tile() === spawn);
      this.src = spawn;
      this.bomber = this.player.buildUnit(UnitType.Bomber, spawn, {
        targetTile: this.dst,
      });
      airfield?.launch();
      const target = this.mg.owner(this.dst);
      if (target.isPlayer()) {
        this.mg.displayIncomingUnit(
          this.bomber.id(),
          "events_display.bomber_inbound",
          MessageType.NUKE_INBOUND,
          target.id(),
        );
      }
      return;
    }

    if (!this.bomber.isActive()) {
      this.active = false;
      return;
    }

    const src = this.src!;
    const sx = this.mg.x(src);
    const sy = this.mg.y(src);
    const dx = this.mg.x(this.dst) - sx;
    const dy = this.mg.y(this.dst) - sy;
    const length = Math.max(Math.abs(dx), Math.abs(dy));

    this.flown = Math.min(length, this.flown + this.mg.config().bomberSpeed());
    if (length > 0) {
      // Integer interpolation keeps the path identical on every client.
      const x = sx + Math.round((dx * this.flown) / length);
      const y = sy + Math.round((dy * this.flown) / length);
      this.bomber.move(this.mg.ref(x, y));
    }

    if (this.flown >= length) {
      this.detonate();
    }
  }

  private detonate(): void {
    const target = this.mg.owner(this.dst);
    const radius = this.mg.config().bomberBlastRadius();
    const hits = this.mg.nearbyUnits(
      this.dst,
      radius,
      Structures.types,
      ({ unit }) =>
        isUnit(unit) &&
        unit.owner() !== this.player &&
        !this.player.isOnSameTeam(unit.owner()),
      true,
    );
    // Sort by id so the order never depends on spatial-index internals.
    hits.sort((a, b) => a.unit.id() - b.unit.id());
    for (const { unit } of hits) {
      if (unit.isActive()) unit.decreaseLevel(this.player);
    }
    // Scorch a small disc of enemy land back to neutral. It is not captured:
    // the attacker still has to take it with troops.
    const scorch = this.mg.config().bomberScorchRadius();
    const scorch2 = scorch * scorch;
    const cx = this.mg.x(this.dst);
    const cy = this.mg.y(this.dst);
    for (let y = cy - scorch; y <= cy + scorch; y++) {
      for (let x = cx - scorch; x <= cx + scorch; x++) {
        if (!this.mg.isValidCoord(x, y)) continue;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > scorch2) continue;
        const owner = this.mg.owner(this.mg.ref(x, y));
        if (
          owner.isPlayer() &&
          owner !== this.player &&
          !this.player.isOnSameTeam(owner)
        ) {
          owner.relinquish(this.mg.ref(x, y));
        }
      }
    }

    if (target.isPlayer() && target !== this.player) {
      // The raid also catches troops in the open.
      target.removeTroops(
        Math.floor(target.troops() * this.mg.config().bomberTroopKillRatio()),
      );
      target.updateRelation(this.player, -50);
    }
    // Tells the renderer this bomber detonated rather than being shot down.
    this.bomber!.setReachedTarget();
    this.bomber!.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BomberExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      dst: this.dst,
      src: this.src,
      flown: this.flown,
      bomber: w.unitOrNull(this.bomber),
    });
  }

  restoreSnapshot(s: BomberState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.src = s.src;
    this.flown = s.flown;
    this.bomber = r.unitOrNull(s.bomber);
  }
}

const BomberStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  dst: zTile(),
  src: zTile().nullable(),
  flown: zInt(),
  bomber: zRef().nullable(),
});
type BomberState = z.infer<typeof BomberStateSchema>;

export const BomberExecutionSnapshot = execSnapshotType({
  name: "Bomber",
  version: 1,
  schema: BomberStateSchema,
  cls: () => BomberExecution,
});
