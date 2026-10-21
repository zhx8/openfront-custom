// Client for this server's own accounts / friends / open-lobby service
// (src/server/social). Same origin: /api is proxied to the master server.

import { getPersistentID } from "../Auth";
import type { PresencePayload } from "../DesktopPresence";

const TOKEN_KEY = "socialToken";
const USER_KEY = "socialUser";
const BASE = "/api/social";

export interface SocialUser {
  id: string;
  username: string;
}

export type FriendStatus = "online" | "lobby" | "game" | "offline";

export interface Friend extends SocialUser {
  status: FriendStatus;
  gameId: string | null;
}

export interface FriendsView {
  friends: Friend[];
  incoming: SocialUser[];
  outgoing: SocialUser[];
}

export interface OpenLobby {
  gameId: string;
  host: string;
  map: string | null;
  gameMode: string | null;
  playerCount: number | null;
  maxPlayers: number | null;
  updatedAt: number;
}

export class SocialApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

// Fired on window whenever the signed-in account changes.
export const SOCIAL_AUTH_EVENT = "social-auth-changed";

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function currentUser(): SocialUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && token() ? (JSON.parse(raw) as SocialUser) : null;
  } catch {
    return null;
  }
}

function setSession(t: string | null, user: SocialUser | null): void {
  try {
    if (t && user) {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      // Play under the account name.
      localStorage.setItem("username", user.username);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Storage blocked: the session just won't survive a reload.
  }
  window.dispatchEvent(new CustomEvent(SOCIAL_AUTH_EVENT));
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const t = token();
  if (auth && t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SocialApiError("network");
  }
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!res.ok) {
    if (res.status === 401 && auth && path !== "/login") {
      // Session expired or revoked on the server.
      setSession(null, null);
    }
    throw new SocialApiError(json.error ?? `http_${res.status}`);
  }
  return json;
}

export async function register(username: string, password: string) {
  const r = await call<{ token: string; user: SocialUser }>(
    "POST",
    "/register",
    { username, password },
    false,
  );
  setSession(r.token, r.user);
  return r.user;
}

export async function login(username: string, password: string) {
  const r = await call<{ token: string; user: SocialUser }>(
    "POST",
    "/login",
    { username, password },
    false,
  );
  setSession(r.token, r.user);
  return r.user;
}

export async function logout(): Promise<void> {
  await call("POST", "/logout").catch(() => undefined);
  setSession(null, null);
}

export const fetchFriends = () => call<FriendsView>("GET", "/friends");
export const requestFriend = (username: string) =>
  call<{ result: "requested" | "accepted" }>("POST", "/friends/request", {
    username,
  });
export const acceptFriend = (id: string) =>
  call("POST", "/friends/accept", { id });
export const removeFriend = (id: string) =>
  call("POST", "/friends/remove", { id });

export interface LeaderboardEntry {
  username: string;
  rating: number;
  wins: number;
  games: number;
}

export interface MatchRecord {
  gameId: string;
  at: number;
  map: string;
  mode: string;
  players: number;
  won: boolean;
  delta: number;
}

export interface Profile {
  rating: number;
  wins: number;
  games: number;
  matches: MatchRecord[];
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const r = await call<{ entries: LeaderboardEntry[] }>(
    "GET",
    "/leaderboard",
    undefined,
    false,
  );
  return r.entries;
}

export const fetchProfile = () => call<Profile>("GET", "/profile");

// Ties this browser's in-game player ID to the account, so the server can
// credit finished games to it. Cheap and idempotent: sent on every sign-in
// and page load.
function linkThisBrowser(): void {
  if (!currentUser()) return;
  void call("POST", "/link", { persistentId: getPersistentID() }).catch(
    () => undefined,
  );
}

export async function fetchOpenLobbies(): Promise<OpenLobby[]> {
  const r = await call<{ lobbies: OpenLobby[] }>(
    "GET",
    "/lobbies",
    undefined,
    false,
  );
  return r.lobbies;
}

// --- presence & lobby announcing -------------------------------------------

const HEARTBEAT_MS = 15_000;
let lastPresence: PresencePayload = { state: "menu" };
let heartbeat: ReturnType<typeof setInterval> | null = null;
let announcedLobby: string | null = null;

function report(): void {
  const p = lastPresence;
  const gameId = p.lobbyId ?? null;
  if (currentUser()) {
    const status =
      p.state === "menu" ? "online" : p.state === "lobby" ? "lobby" : "game";
    void call("POST", "/presence", { status, gameId }).catch(() => undefined);
  }
  // Every private lobby is listed on the server's open-lobby board while it
  // waits for players, so nobody has to pass links around.
  const openLobby =
    p.state === "lobby" && p.gameType === "Private" && gameId !== null;
  if (openLobby) {
    announcedLobby = gameId;
    void call(
      "POST",
      "/lobbies",
      {
        gameId,
        host:
          currentUser()?.username ?? localStorage.getItem("username") ?? "?",
        map: p.map ?? null,
        gameMode: p.gameMode ?? null,
        playerCount: p.playerCount ?? null,
        maxPlayers: p.maxPlayers ?? null,
      },
      false,
    ).catch(() => undefined);
  } else if (announcedLobby !== null) {
    void call("DELETE", `/lobbies/${announcedLobby}`, undefined, false).catch(
      () => undefined,
    );
    announcedLobby = null;
  }
}

// Called with every presence change (see DesktopPresence.set).
// Lobbies re-emit presence every second; only a change is sent at once, the
// rest rides the heartbeat.
export function reportPresence(payload: PresencePayload | null): void {
  const next = payload ?? { state: "menu" };
  const changed = JSON.stringify(next) !== JSON.stringify(lastPresence);
  lastPresence = next;
  if (changed || heartbeat === null) report();
  heartbeat ??= setInterval(report, HEARTBEAT_MS);
}

window.addEventListener(SOCIAL_AUTH_EVENT, () => {
  report();
  linkThisBrowser();
});
// Deferred: Auth and this module can import each other through presence.
setTimeout(linkThisBrowser, 0);
