import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Game } from "../../game/Game";

/**
 * One tick of straight-line flight: up to `speed` tiles (Chebyshev) from
 * `from` toward `to`, with integer rounding so every client lands on the same
 * tile. Aircraft ignore terrain.
 */
export function flyToward(
  mg: Game,
  from: TileRef,
  to: TileRef,
  speed: number,
): TileRef {
  const fx = mg.x(from);
  const fy = mg.y(from);
  const dx = mg.x(to) - fx;
  const dy = mg.y(to) - fy;
  const length = Math.max(Math.abs(dx), Math.abs(dy));
  if (length <= speed) return to;
  return mg.ref(
    fx + Math.round((dx * speed) / length),
    fy + Math.round((dy * speed) / length),
  );
}

export function chebyshev(mg: Game, a: TileRef, b: TileRef): number {
  return Math.max(Math.abs(mg.x(a) - mg.x(b)), Math.abs(mg.y(a) - mg.y(b)));
}
