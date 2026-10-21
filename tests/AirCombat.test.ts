import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { BomberExecution } from "@openfront/engine/execution/BomberExecution";
import { FighterExecution } from "@openfront/engine/execution/FighterExecution";
import { ParatrooperExecution } from "@openfront/engine/execution/ParatrooperExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let red: Player;
let blue: Player;

function tick(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

describe("Air combat", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [
        new PlayerInfo("red", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("blue", PlayerType.Human, "c2", "p2"),
      ],
    );
    while (game.inSpawnPhase()) game.executeNextTick();
    red = game.player("p1");
    blue = game.player("p2");
    red.conquer(game.ref(0, 0));
    blue.conquer(game.ref(60, 60));
    red.buildUnit(UnitType.Airfield, game.ref(0, 0), {});
    blue.buildUnit(UnitType.Airfield, game.ref(60, 60), {});
  });

  test("a fighter needs a nearby airfield and respects the squadron cap", () => {
    expect(red.canBuild(UnitType.Fighter, game.ref(70, 70))).toBe(false);
    for (let i = 0; i < 2; i++) {
      game.addExecution(new FighterExecution(red, game.ref(0, 0)));
      tick(2);
    }
    expect(red.units(UnitType.Fighter)).toHaveLength(2);
    // Two per airfield level.
    expect(red.canBuild(UnitType.Fighter, game.ref(0, 0))).toBe(false);
  });

  test("a fighter shoots down an incoming bomber", () => {
    const city = blue.buildUnit(UnitType.City, game.ref(60, 60), {});
    game.addExecution(new FighterExecution(blue, game.ref(60, 60)));
    tick(2);
    game.addExecution(new BomberExecution(red, game.ref(60, 60)));
    tick(60);
    expect(game.units(UnitType.Bomber)).toHaveLength(0);
    expect(city.isActive()).toBe(true);
    expect(blue.units(UnitType.Fighter)).toHaveLength(1);
  });

  test("fighters dogfight and can be shot down", () => {
    game.addExecution(new FighterExecution(blue, game.ref(60, 60)));
    tick(2);
    const defender = blue.units(UnitType.Fighter)[0];
    // Two attackers against one: the defender loses.
    red.buildUnit(UnitType.Airfield, game.ref(40, 40), {});
    red.conquer(game.ref(40, 40));
    game.addExecution(new FighterExecution(red, game.ref(40, 40)));
    game.addExecution(new FighterExecution(red, game.ref(40, 40)));
    tick(80);
    expect(defender.isActive()).toBe(false);
  });

  test("paratroopers land behind the lines and start an attack", () => {
    blue.conquer(game.ref(61, 60));
    blue.conquer(game.ref(62, 60));
    const before = red.troops();
    game.addExecution(new ParatrooperExecution(red, game.ref(62, 60), 5000));
    tick(2);
    expect(game.units(UnitType.Paratrooper)).toHaveLength(1);
    expect(red.troops()).toBe(before - 5000);
    tick(60);
    expect(game.units(UnitType.Paratrooper)).toHaveLength(0);
    expect(game.owner(game.ref(62, 60))).toBe(red);
  });

  test("a drop deep inside enemy land holds instead of being annexed", () => {
    for (let x = 40; x <= 80; x++) {
      for (let y = 40; y <= 80; y++) blue.conquer(game.ref(x, y));
    }
    game.addExecution(new ParatrooperExecution(red, game.ref(70, 70), 20000));
    tick(60); // fly in and land
    expect(game.owner(game.ref(70, 70))).toBe(red);
    tick(40); // several surrounded-territory passes later
    expect(game.owner(game.ref(70, 70))).toBe(red);
    // The landing zone is a disc, not one tile.
    expect(game.owner(game.ref(72, 70))).toBe(red);
  });

  test("paratroopers can drop on unclaimed land across the map", () => {
    game.addExecution(new ParatrooperExecution(red, game.ref(90, 10), 1000));
    tick(80);
    expect(game.owner(game.ref(90, 10))).toBe(red);
  });

  test("a shot-down transport loses its troops", () => {
    game.addExecution(new FighterExecution(blue, game.ref(60, 60)));
    tick(2);
    game.addExecution(new ParatrooperExecution(red, game.ref(60, 60), 5000));
    tick(80);
    expect(game.units(UnitType.Paratrooper)).toHaveLength(0);
    expect(game.owner(game.ref(60, 60))).toBe(blue);
  });
});
