import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

async function twoPlayers(config: Record<string, unknown>) {
  const game: Game = await setup(
    "plains",
    { instantBuild: true, ...config },
    [
      new PlayerInfo("red", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("blue", PlayerType.Human, "c2", "p2"),
    ],
    undefined,
    UseRealAttackLogic,
  );
  while (game.inSpawnPhase()) game.executeNextTick();
  const red: Player = game.player("p1");
  const blue: Player = game.player("p2");
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 40; y++) red.conquer(game.ref(x, y));
  }
  for (let x = 40; x < 80; x++) {
    for (let y = 0; y < 40; y++) blue.conquer(game.ref(x, y));
  }
  return { game, red, blue };
}

// Troops red loses per tile it takes from blue over a fixed time.
function attackCost(game: Game, red: Player, blue: Player): number {
  red.addTroops(500_000);
  blue.addTroops(50_000);
  game.addExecution(new AttackExecution(200_000, red, blue.id(), null));
  game.executeNextTick();
  const before = red.outgoingAttacks()[0].troops();
  const tilesBefore = red.numTilesOwned();
  for (let i = 0; i < 20; i++) game.executeNextTick();
  const attack = red.outgoingAttacks()[0];
  return (before - attack.troops()) / (red.numTilesOwned() - tilesBefore);
}

describe("Supply lines", () => {
  test("attacking far from any City costs more troops", async () => {
    const off = await twoPlayers({});
    const normal = attackCost(off.game, off.red, off.blue);

    const on = await twoPlayers({ supplyLines: true });
    const unsupplied = attackCost(on.game, on.red, on.blue);
    expect(unsupplied).toBeGreaterThan(normal * 1.5);
  });

  test("a City near the front keeps the attack supplied", async () => {
    const off = await twoPlayers({});
    const normal = attackCost(off.game, off.red, off.blue);

    const on = await twoPlayers({ supplyLines: true });
    on.red.buildUnit(UnitType.City, on.game.ref(35, 20), {});
    const supplied = attackCost(on.game, on.red, on.blue);
    expect(supplied).toBeLessThan(normal * 1.5);
  });
});

describe("Fair start", () => {
  test("nations start and grow like humans, and spawns are random", async () => {
    const game = await setup(
      "plains",
      { fairStart: true, difficulty: Difficulty.Impossible },
      [
        new PlayerInfo("human", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("nation", PlayerType.Nation, null, "n1"),
      ],
    );
    const config = game.config();
    expect(config.isRandomSpawn()).toBe(true);
    const human = game.player("p1");
    const nation = game.player("n1");
    expect(config.startManpower(nation.info())).toBe(
      config.startManpower(human.info()),
    );
  });
});
