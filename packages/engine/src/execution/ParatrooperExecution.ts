import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zNum,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AttackExecution } from "./AttackExecution";
import { flyToward } from "./utils/Flight";

// A transport plane flies a share of the player's troops straight from the
// nearest ready airfield to any land tile, over enemy territory or water,
// and drops them as a new attack from the landing tile. Enemy fighters can
// shoot it down on the way, killing everyone aboard.
export class ParatrooperExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;

  constructor(
    private player: Player,
    private dst: TileRef,
    private troops: number | null = null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.plane === null) {
      const spawn = this.player.canBuild(UnitType.Paratrooper, this.dst);
      if (spawn === false) {
        this.active = false;
        return;
      }
      const troops = Math.min(
        this.troops ??
          Math.floor(
            this.player.troops() * this.mg.config().paratrooperTroopShare(),
          ),
        this.player.troops(),
      );
      this.plane = this.player.buildUnit(UnitType.Paratrooper, spawn, {
        troops,
        targetTile: this.dst,
      });
      this.player
        .units(UnitType.Airfield)
        .find((a) => a.tile() === spawn)
        ?.launch();
      const target = this.mg.owner(this.dst);
      if (target.isPlayer()) {
        this.mg.displayIncomingUnit(
          this.plane.id(),
          "events_display.paratroopers_inbound",
          MessageType.NAVAL_INVASION_INBOUND,
          target.id(),
        );
      }
      return;
    }

    if (!this.plane.isActive()) {
      // Shot down: the troops are lost.
      this.active = false;
      return;
    }

    const next = flyToward(
      this.mg,
      this.plane.tile(),
      this.dst,
      this.mg.config().paratrooperSpeed(),
    );
    this.plane.move(next);
    if (next === this.dst) this.land();
  }

  private land(): void {
    const plane = this.plane!;
    const troops = plane.troops();
    const owner = this.mg.owner(this.dst);
    plane.setReachedTarget();
    plane.delete(false);
    this.active = false;

    if (owner === this.player || !this.mg.isLand(this.dst)) {
      this.player.addTroops(troops);
      return;
    }
    if (owner.isPlayer() && !this.player.canAttackPlayer(owner)) {
      // Made peace while we were in the air: stand down.
      this.player.addTroops(troops);
      return;
    }
    // Seize a landing zone, not a single tile: every land tile in the drop
    // radius held by the target (or nobody), then attack out of it.
    const r = this.mg.config().paratrooperDropRadius();
    const cx = this.mg.x(this.dst);
    const cy = this.mg.y(this.dst);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!this.mg.isValidCoord(x, y)) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
        const t = this.mg.ref(x, y);
        if (!this.mg.isLand(t) || this.mg.owner(t) !== owner) continue;
        this.player.conquer(t);
      }
    }
    this.player.conquer(this.dst);
    this.player.addAirhead(
      this.dst,
      this.mg.ticks() + this.mg.config().paratrooperAirheadTicks(),
    );
    this.mg.addExecution(
      new AttackExecution(
        troops,
        this.player,
        owner.isPlayer() ? owner.id() : null,
        this.dst,
        false,
      ),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ParatrooperExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      dst: this.dst,
      troops: this.troops,
      plane: w.unitOrNull(this.plane),
    });
  }

  restoreSnapshot(s: ParatrooperState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.troops = s.troops;
    this.plane = r.unitOrNull(s.plane);
  }
}

const ParatrooperStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  dst: zTile(),
  troops: zNum().nullable(),
  plane: zRef().nullable(),
});
type ParatrooperState = z.infer<typeof ParatrooperStateSchema>;

export const ParatrooperExecutionSnapshot = execSnapshotType({
  name: "Paratrooper",
  version: 1,
  schema: ParatrooperStateSchema,
  cls: () => ParatrooperExecution,
});
