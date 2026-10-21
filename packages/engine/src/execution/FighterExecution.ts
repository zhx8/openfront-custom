import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Aircraft, UnitType } from "@openfront/engine-api/game/GameTypes";
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
import { chebyshev, flyToward } from "./utils/Flight";

// Patrol waypoints around the home airfield, as unit offsets scaled by the
// patrol radius: a rough circle flown clockwise.
const PATROL: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0.7, -0.7],
  [1, 0],
  [0.7, 0.7],
  [0, 1],
  [-0.7, 0.7],
  [-1, 0],
  [-0.7, -0.7],
];

// A fighter circles its airfield and intercepts enemy aircraft that come
// near: bombers and paratrooper planes are shot down on contact, enemy
// fighters are fought until one side falls. Fighters die when shot down, so
// air defence has to be rebuilt, unlike a SAM site.
export class FighterExecution implements Execution {
  private active = true;
  private mg: Game;
  private fighter: Unit | null = null;
  private target: Unit | null = null;
  private waypoint = 0;

  constructor(
    private player: Player,
    private home: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.fighter === null) {
      const spawn = this.player.canBuild(UnitType.Fighter, this.home);
      if (spawn === false) {
        this.active = false;
        return;
      }
      this.home = spawn;
      this.fighter = this.player.buildUnit(UnitType.Fighter, spawn, {});
      return;
    }
    const fighter = this.fighter;
    if (!fighter.isActive()) {
      this.active = false;
      return;
    }
    if (fighter.health() <= 0) {
      // Damaged to zero by a fighter that then lost track of us.
      fighter.delete(true);
      this.active = false;
      return;
    }
    if (!this.rebase()) return;

    const config = this.mg.config();
    if (!this.isValidTarget(this.target)) this.target = this.acquire();

    if (this.target === null) {
      this.patrol();
      return;
    }

    const target = this.target;
    fighter.move(
      flyToward(this.mg, fighter.tile(), target.tile(), config.fighterSpeed()),
    );
    if (chebyshev(this.mg, fighter.tile(), target.tile()) > 1) return;

    if (target.type() === UnitType.Fighter) {
      target.modifyHealth(-config.fighterDamage(), this.player);
      if (target.health() > 0) return;
    }
    // Bombers and transports are defenceless once caught; a fighter at zero
    // health goes down. Another fighter may have finished it this tick.
    if (target.isActive()) target.delete(true, this.player);
    this.target = null;
  }

  // Keeps the fighter tied to a live airfield of ours; if its own was lost,
  // it moves to the nearest other one. With none left it is lost too.
  private rebase(): boolean {
    const airfields = this.player
      .units(UnitType.Airfield)
      .filter((a) => a.isActive());
    if (airfields.some((a) => a.tile() === this.home)) return true;
    if (airfields.length === 0) {
      this.fighter!.delete(true);
      this.active = false;
      return false;
    }
    airfields.sort(
      (a, b) =>
        this.mg.manhattanDist(a.tile(), this.home) -
          this.mg.manhattanDist(b.tile(), this.home) || a.id() - b.id(),
    );
    this.home = airfields[0].tile();
    return true;
  }

  private isValidTarget(u: Unit | null): u is Unit {
    if (u === null || !u.isActive()) return false;
    if (u.owner() === this.player || this.player.isFriendly(u.owner())) {
      return false;
    }
    return (
      chebyshev(this.mg, u.tile(), this.home) <=
      this.mg.config().fighterLeashRange()
    );
  }

  private acquire(): Unit | null {
    const found = this.mg.nearbyUnits(
      this.home,
      this.mg.config().fighterDetectionRange(),
      Aircraft.types,
      ({ unit }) =>
        isUnit(unit) &&
        unit.owner() !== this.player &&
        !this.player.isFriendly(unit.owner()),
    );
    if (found.length === 0) return null;
    // Closest to the fighter; ties broken by id so every client agrees.
    const here = this.fighter!.tile();
    found.sort(
      (a, b) =>
        chebyshev(this.mg, a.unit.tile(), here) -
          chebyshev(this.mg, b.unit.tile(), here) || a.unit.id() - b.unit.id(),
    );
    return found[0].unit as Unit;
  }

  private patrol(): void {
    const fighter = this.fighter!;
    const r = this.mg.config().fighterPatrolRadius();
    const [ox, oy] = PATROL[this.waypoint];
    const x = Math.min(
      this.mg.width() - 1,
      Math.max(0, this.mg.x(this.home) + Math.round(ox * r)),
    );
    const y = Math.min(
      this.mg.height() - 1,
      Math.max(0, this.mg.y(this.home) + Math.round(oy * r)),
    );
    const wp = this.mg.ref(x, y);
    // Patrol at cruising speed, slower than a chase.
    const next = flyToward(this.mg, fighter.tile(), wp, 2);
    fighter.move(next);
    if (next === wp) this.waypoint = (this.waypoint + 1) % PATROL.length;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FighterExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      home: this.home,
      fighter: w.unitOrNull(this.fighter),
      target: w.unitOrNull(this.target),
      waypoint: this.waypoint,
    });
  }

  restoreSnapshot(s: FighterState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.home = s.home;
    this.fighter = r.unitOrNull(s.fighter);
    this.target = r.unitOrNull(s.target);
    this.waypoint = s.waypoint;
  }
}

const FighterStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  home: zTile(),
  fighter: zRef().nullable(),
  target: zRef().nullable(),
  waypoint: zInt(),
});
type FighterState = z.infer<typeof FighterStateSchema>;

export const FighterExecutionSnapshot = execSnapshotType({
  name: "Fighter",
  version: 1,
  schema: FighterStateSchema,
  cls: () => FighterExecution,
});
