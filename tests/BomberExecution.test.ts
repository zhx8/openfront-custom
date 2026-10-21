import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { BomberExecution } from "@openfront/engine/execution/BomberExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let attacker: Player;
let defender: Player;

function runUntilIdle(max = 200) {
  for (let i = 0; i < max && game.units(UnitType.Bomber).length > 0; i++) {
    game.executeNextTick();
  }
}

describe("BomberExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [
        new PlayerInfo("attacker", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("defender", PlayerType.Human, "c2", "p2"),
      ],
    );
    while (game.inSpawnPhase()) game.executeNextTick();
    attacker = game.player("p1");
    defender = game.player("p2");
    attacker.conquer(game.ref(0, 0));
    defender.conquer(game.ref(40, 40));
  });

  test("airfield costs 300k gold", () => {
    expect(game.config().unitInfo(UnitType.Airfield)).toBeDefined();
    const cost = game.unitInfo(UnitType.Airfield).cost;
    // infiniteGold zeroes human costs, so check the price via a nation.
    const nation = new PlayerInfo("n", PlayerType.Nation, null, "n1");
    game.addPlayer(nation);
    expect(cost(game, game.player("n1"))).toBe(300_000n);
  });

  test("cannot launch without an airfield", () => {
    expect(attacker.canBuild(UnitType.Bomber, game.ref(40, 40))).toBe(false);
  });

  test("bomber flies to target and destroys a level-1 structure", () => {
    attacker.buildUnit(UnitType.Airfield, game.ref(0, 0), {});
    const city = defender.buildUnit(UnitType.City, game.ref(40, 40), {});

    game.addExecution(new BomberExecution(attacker, game.ref(40, 40)));
    game.executeNextTick(); // init
    game.executeNextTick(); // launch
    expect(game.units(UnitType.Bomber)).toHaveLength(1);
    expect(attacker.units(UnitType.Airfield)[0].isInCooldown()).toBe(true);

    runUntilIdle();
    expect(game.units(UnitType.Bomber)).toHaveLength(0);
    expect(city.isActive()).toBe(false);
    // The drop zone is scorched back to neutral, not captured.
    expect(game.owner(game.ref(40, 40)).isPlayer()).toBe(false);
  });

  test("bomber only knocks one level off a multi-level structure", () => {
    attacker.buildUnit(UnitType.Airfield, game.ref(0, 0), {});
    const city = defender.buildUnit(UnitType.City, game.ref(40, 40), {});
    city.increaseLevel();

    game.addExecution(new BomberExecution(attacker, game.ref(40, 40)));
    game.executeNextTick();
    game.executeNextTick();
    runUntilIdle();
    expect(city.isActive()).toBe(true);
    expect(city.level()).toBe(1);
  });

  test("bomber kills a share of the target's troops", () => {
    attacker.buildUnit(UnitType.Airfield, game.ref(0, 0), {});
    defender.conquer(game.ref(41, 40));
    defender.addTroops(100_000);
    game.addExecution(new BomberExecution(attacker, game.ref(40, 40)));
    game.executeNextTick();
    game.executeNextTick();
    const before = defender.troops();
    runUntilIdle();
    // Regen over the flight is far smaller than the 15% hit.
    expect(defender.troops()).toBeLessThan(before * 0.9);
  });

  test("scorches only enemy land inside the radius", () => {
    attacker.buildUnit(UnitType.Airfield, game.ref(0, 0), {});
    defender.conquer(game.ref(42, 40));
    defender.conquer(game.ref(50, 40));
    game.addExecution(new BomberExecution(attacker, game.ref(40, 40)));
    game.executeNextTick();
    game.executeNextTick();
    runUntilIdle();
    expect(game.owner(game.ref(42, 40)).isPlayer()).toBe(false);
    expect(game.owner(game.ref(50, 40))).toBe(defender);
    expect(game.owner(game.ref(0, 0))).toBe(attacker);
  });

  test("cannot target own territory", () => {
    attacker.buildUnit(UnitType.Airfield, game.ref(0, 0), {});
    expect(attacker.canBuild(UnitType.Bomber, game.ref(0, 0))).toBe(false);
  });
});
