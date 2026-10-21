import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationAirBehavior } from "@openfront/engine/execution/nation/NationAirBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let nation: Player;
let enemy: Player;

describe("NationAirBehavior", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      {
        instantBuild: true,
        infiniteGold: true,
        difficulty: Difficulty.Hard,
      },
      [
        new PlayerInfo("nation", PlayerType.Nation, null, "n1"),
        new PlayerInfo("enemy", PlayerType.Human, "c2", "p2"),
      ],
    );
    while (game.inSpawnPhase()) game.executeNextTick();
    nation = game.player("n1");
    enemy = game.player("p2");
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) nation.conquer(game.ref(x, y));
    }
    for (let x = 30; x < 60; x++) {
      for (let y = 0; y < 30; y++) enemy.conquer(game.ref(x, y));
    }
    nation.addGold(100_000_000n);
    nation.addTroops(1_000_000);
    enemy.buildUnit(UnitType.City, game.ref(50, 15), {});
  });

  test("builds an airfield, fighters, then strikes who it is fighting", () => {
    const air = new NationAirBehavior(new PseudoRandom(42), game, nation);
    for (
      let i = 0;
      i < 20 && nation.units(UnitType.Airfield).length === 0;
      i++
    ) {
      air.maybeUseAirForce();
      game.executeNextTick();
      game.executeNextTick();
    }
    expect(nation.units(UnitType.Airfield)).toHaveLength(1);

    for (let i = 0; i < 6; i++) {
      air.maybeUseAirForce();
      game.executeNextTick();
      game.executeNextTick();
    }
    expect(nation.units(UnitType.Fighter).length).toBeGreaterThan(0);

    // Only strikes once at war.
    expect(game.units(UnitType.Bomber)).toHaveLength(0);
    game.addExecution(new AttackExecution(1000, nation, enemy.id(), null));
    game.executeNextTick();
    let launched = 0;
    for (let i = 0; i < 40; i++) {
      air.maybeUseAirForce();
      game.executeNextTick();
      launched +=
        game.units(UnitType.Bomber).length +
        game.units(UnitType.Paratrooper).length;
    }
    expect(launched).toBeGreaterThan(0);
  });
});
