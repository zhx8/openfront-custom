// Turns a finished game's record into a result for the ratings in
// SocialStore, and sends it from the game worker to the main server.

import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { GameRecord } from "@openfront/shared/WireSchemas";

export interface GameResult {
  gameId: string;
  map: string;
  mode: string;
  // One entry per human player in the game.
  players: { persistentId: string; username: string; won: boolean }[];
}

export const INTERNAL_KEY_HEADER = "x-internal-key";

/** Null for games that don't count: singleplayer, or fewer than two humans. */
export function resultFromRecord(record: GameRecord): GameResult | null {
  const { info } = record;
  if (info.config.gameType === GameType.Singleplayer) return null;
  const winner = info.winner;
  // ["player", clientID, ...] | ["team", name, ...clientIDs] |
  // ["nation", name, ...]: a nation (AI) win means every human lost.
  const winners = new Set<string>();
  if (winner?.[0] === "player") winners.add(winner[1]);
  if (winner?.[0] === "team") winner.slice(2).forEach((id) => winners.add(id));
  const players = info.players.flatMap((p) =>
    p.persistentID
      ? [
          {
            persistentId: p.persistentID,
            username: p.username,
            won: winners.has(p.clientID),
          },
        ]
      : [],
  );
  if (players.length < 2) return null;
  return {
    gameId: info.gameID,
    map: String(info.config.gameMap),
    mode: String(info.config.gameMode),
    players,
  };
}

/** Fire-and-forget: a lost result only costs a rating update. */
export async function sendResultToMaster(result: GameResult): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  try {
    await fetch(`http://127.0.0.1:${port}/api/social/internal/result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_KEY_HEADER]: process.env.API_KEY ?? "",
      },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn("could not send game result to the main server", err);
  }
}
