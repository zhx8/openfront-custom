import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";

// How far (Chebyshev tiles) from one of our airfields a nation will strike.
const STRIKE_RANGE = 220;
// Land a nation must hold before it invests in an air force.
const MIN_TILES_FOR_AIRFIELD = 400;

/**
 * Nations' air force: builds an Airfield once the economy allows, keeps its
 * fighter squadron up, bombs the buildings of whoever it is fighting and
 * drops paratroopers behind their lines when it has troops to spare.
 *
 * Stateless on purpose: every decision is re-derived from the game each
 * time and drawn from the nation's own seeded random, so it adds nothing to
 * the nation's saved state.
 */
export class NationAirBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  maybeUseAirForce(): void {
    const config = this.game.config();
    if (config.isUnitDisabled(UnitType.Airfield)) return;
    const difficulty = config.gameConfig().difficulty;
    // Easy nations stay on the ground.
    if (difficulty === Difficulty.Easy) return;
    // Harder nations act more often.
    const actChance = difficulty === Difficulty.Medium ? 3 : 2;

    const airfields = this.player
      .units(UnitType.Airfield)
      .filter((a) => a.isActive() && !a.isUnderConstruction());

    if (airfields.length === 0) {
      if (
        this.player.units(UnitType.Airfield).length === 0 &&
        this.player.numTilesOwned() >= MIN_TILES_FOR_AIRFIELD &&
        this.canAfford(UnitType.Airfield, 3) &&
        this.random.chance(actChance)
      ) {
        this.buildAirfield();
      }
      return;
    }

    // Defence first: keep the squadron at full strength.
    if (
      !config.isUnitDisabled(UnitType.Fighter) &&
      this.canAfford(UnitType.Fighter, 2) &&
      this.player.canBuild(UnitType.Fighter, airfields[0].tile()) !== false
    ) {
      this.build(UnitType.Fighter, airfields[0].tile());
      return;
    }

    if (!this.random.chance(actChance)) return;
    const enemies = this.enemies();
    if (enemies.length === 0) return;
    const enemy = enemies[this.random.nextInt(0, enemies.length)];

    // Paratroopers when we have a big army to spare; bombers otherwise.
    const troopsHigh =
      this.player.troops() > config.maxTroops(this.player) * 0.5;
    if (
      troopsHigh &&
      !config.isUnitDisabled(UnitType.Paratrooper) &&
      this.canAfford(UnitType.Paratrooper, 1)
    ) {
      const target = this.pickTarget(enemy, airfields[0].tile());
      if (
        target !== null &&
        this.player.canBuild(UnitType.Paratrooper, target) !== false
      ) {
        this.build(UnitType.Paratrooper, target);
        return;
      }
    }
    if (
      !config.isUnitDisabled(UnitType.Bomber) &&
      this.canAfford(UnitType.Bomber, 2)
    ) {
      const target = this.pickTarget(enemy, airfields[0].tile());
      if (
        target !== null &&
        this.player.canBuild(UnitType.Bomber, target) !== false
      ) {
        this.build(UnitType.Bomber, target);
      }
    }
  }

  // Players we are at war with: the targets of our running attacks.
  private enemies(): Player[] {
    const seen = new Set<Player>();
    for (const attack of this.player.outgoingAttacks()) {
      const t = attack.target();
      if (t.isPlayer() && this.player.canAttackPlayer(t)) seen.add(t);
    }
    // Sorted by id so every client draws the same one.
    return [...seen].sort((a, b) => a.smallID() - b.smallID());
  }

  // One of the enemy's buildings within reach, else a tile of theirs.
  private pickTarget(enemy: Player, from: TileRef): TileRef | null {
    const inRange = (t: TileRef) =>
      Math.max(
        Math.abs(this.game.x(t) - this.game.x(from)),
        Math.abs(this.game.y(t) - this.game.y(from)),
      ) <= STRIKE_RANGE;
    const buildings = enemy
      .units(Structures.types)
      .filter((u) => u.isActive() && inRange(u.tile()))
      .sort((a, b) => a.id() - b.id());
    if (buildings.length > 0) {
      return buildings[this.random.nextInt(0, buildings.length)].tile();
    }
    const border = [...enemy.borderTiles()].filter(inRange);
    if (border.length === 0) return null;
    return border[this.random.nextInt(0, border.length)];
  }

  private buildAirfield(): void {
    // Sample inside our main territory; before its first cluster pass there
    // is no bounding box yet, so fall back to our border.
    const box = this.player.largestClusterBoundingBox;
    const border = box ? [] : [...this.player.borderTiles()];
    for (let i = 0; i < 20; i++) {
      let tile: TileRef;
      if (box) {
        const x = this.random.nextInt(box.min.x, box.max.x + 1);
        const y = this.random.nextInt(box.min.y, box.max.y + 1);
        if (!this.game.isValidCoord(x, y)) continue;
        tile = this.game.ref(x, y);
      } else {
        if (border.length === 0) return;
        tile = border[this.random.nextInt(0, border.length)];
      }
      if (this.game.owner(tile) !== this.player) continue;
      if (this.player.canBuild(UnitType.Airfield, tile) === false) continue;
      this.build(UnitType.Airfield, tile);
      return;
    }
  }

  // Spends at most 1/`share` of our gold on one purchase.
  private canAfford(type: UnitType, share: number): boolean {
    const cost = this.game.unitInfo(type).cost(this.game, this.player);
    return cost * BigInt(share) <= this.player.gold();
  }

  private build(type: UnitType, tile: TileRef): void {
    this.game.addExecution(new ConstructionExecution(this.player, type, tile));
  }
}
