import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let red: Player;
let blue: Player;

function tick(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

// The first shore tile in a row, scanning from the left.
function shoreInRow(y: number): TileRef {
  for (let x = 0; x < game.width(); x++) {
    const t = game.ref(x, y);
    if (game.isLand(t) && game.isShore(t)) return t;
  }
  throw new Error(`no shore in row ${y}`);
}

describe("Assault ship", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [
        new PlayerInfo("red", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("blue", PlayerType.Human, "c2", "p2"),
      ],
    );
    while (game.inSpawnPhase()) game.executeNextTick();
    red = game.player("p1");
    blue = game.player("p2");
  });

  test("is armored, fires on enemy boats, and lands its troops", () => {
    const home = shoreInRow(2);
    const beach = shoreInRow(game.height() - 3);
    red.conquer(home);
    blue.conquer(beach);

    // An enemy transport sitting in the way gets shot.
    const water = game.neighbors(home).find((t) => game.isWater(t)) as TileRef;
    const decoy = blue.buildUnit(UnitType.TransportShip, water, {
      troops: 10,
    });

    game.addExecution(
      new TransportShipExecution(red, beach, 1000, UnitType.AssaultShip),
    );
    tick(2);
    const ship = red.units(UnitType.AssaultShip)[0];
    expect(ship).toBeDefined();
    expect(ship.hasHealth()).toBe(true);
    // Not limited by (or counted toward) the plain-boat cap.
    expect(red.units(UnitType.TransportShip)).toHaveLength(0);

    tick(40);
    expect(decoy.isActive()).toBe(false);

    for (let i = 0; i < 400 && ship.isActive(); i++) tick(1);
    expect(game.owner(beach)).toBe(red);
  });

  test("survives a warship's shells long enough to matter", () => {
    const home = shoreInRow(2);
    const beach = shoreInRow(game.height() - 3);
    red.conquer(home);
    blue.conquer(beach);
    const water = game.neighbors(beach).find((t) => game.isWater(t)) as TileRef;
    game.addExecution(new WarshipExecution({ owner: blue, patrolTile: water }));
    game.addExecution(
      new TransportShipExecution(red, beach, 1000, UnitType.AssaultShip),
    );
    game.addExecution(new TransportShipExecution(red, beach, 1000));
    tick(3);
    const ship = red.units(UnitType.AssaultShip)[0];
    const boat = red.units(UnitType.TransportShip)[0];
    // Sail until the plain boat dies to the warship.
    for (let i = 0; i < 400 && boat.isActive(); i++) tick(1);
    expect(boat.isActive()).toBe(false);
    // The armored one is still afloat at that point.
    expect(ship.isActive() || game.owner(beach) === red).toBe(true);
  });
});
