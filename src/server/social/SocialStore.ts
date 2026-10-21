// Accounts, friends, presence and the open-lobby board for this server.
//
// Everything persistent (accounts, sessions, friendships) lives in one JSON
// file, rewritten atomically on change; it is small for a school-sized
// player base. Presence and lobbies are in memory only and expire on their
// own when a client stops reporting.

import crypto from "crypto";
import type { GameResult } from "./GameResults";
import fs from "fs";
import path from "path";

export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;

const PRESENCE_TTL_MS = 45_000;
const LOBBY_TTL_MS = 20_000;
const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const MAX_FRIENDS = 200;

export type PresenceStatus = "online" | "lobby" | "game";

export interface PublicUser {
  id: string;
  username: string;
}

interface UserRecord extends PublicUser {
  usernameLower: string;
  banned?: boolean;
  rating?: number;
  wins?: number;
  games?: number;
  // scrypt$<salt hex>$<hash hex>
  passwordHash: string;
  createdAt: number;
}

interface SessionRecord {
  userId: string;
  expiresAt: number;
}

interface Data {
  users: Record<string, UserRecord>;
  // Keyed by sha256(token): a leaked file does not leak live tokens.
  sessions: Record<string, SessionRecord>;
  // Accepted friendships, as "a|b" with a < b.
  friendships: string[];
  // Pending requests, as "from|to".
  requests: string[];
  // sha256(in-game persistent ID) -> account, so finished games can be
  // credited to the account that played them.
  links: Record<string, string>;
  // Most recent matches per account, newest first.
  matches: Record<string, MatchRecord[]>;
  // Games already counted (bounded), so a result is never applied twice.
  counted: string[];
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

export interface LeaderboardEntry {
  username: string;
  rating: number;
  wins: number;
  games: number;
}

export const START_RATING = 1000;
const MAX_MATCHES_KEPT = 20;
const MAX_COUNTED_KEPT = 5000;

/**
 * Rating change for one player of a finished game with `humans` human
 * players, `winners` of whom won. Beating more people is worth more; a game
 * the AI won costs everyone a little.
 */
export function ratingDelta(won: boolean, humans: number, winners: number): number {
  if (winners === 0) return -5;
  if (won) {
    const beaten = humans - winners;
    return Math.min(60, Math.round(10 + (20 * beaten) / winners));
  }
  return -Math.min(25, Math.round(5 + (10 * winners) / Math.max(1, humans - winners)));
}

export interface FriendView extends PublicUser {
  status: PresenceStatus | "offline";
  gameId: string | null;
}

export interface FriendsView {
  friends: FriendView[];
  incoming: PublicUser[];
  outgoing: PublicUser[];
}

export interface LobbyAnnouncement {
  gameId: string;
  host: string;
  map: string | null;
  gameMode: string | null;
  playerCount: number | null;
  maxPlayers: number | null;
}

export interface LobbyView extends LobbyAnnouncement {
  updatedAt: number;
}

export class SocialError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

function emptyData(): Data {
  return {
    users: {},
    sessions: {},
    friendships: [],
    requests: [],
    links: {},
    matches: {},
    counted: [],
  };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
  );
  return crypto.timingSafeEqual(expected, actual);
}

export class SocialStore {
  private data: Data;
  private presence = new Map<
    string,
    { status: PresenceStatus; gameId: string | null; at: number }
  >();
  private lobbies = new Map<string, LobbyView>();

  constructor(
    // null keeps everything in memory (tests).
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
    // Rejects offensive usernames at sign-up.
    private readonly isOffensive: (name: string) => boolean = () => false,
  ) {
    this.data = this.load();
  }

  private load(): Data {
    if (this.file === null || !fs.existsSync(this.file)) return emptyData();
    // A file we fail to read or parse throws here, deliberately: starting
    // empty over it would wipe every account on the next save.
    return {
      ...emptyData(),
      ...JSON.parse(fs.readFileSync(this.file, "utf8")),
    };
  }

  private save(): void {
    if (this.file === null) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // --- accounts -----------------------------------------------------------

  register(
    username: string,
    password: string,
  ): { token: string; user: PublicUser } {
    if (!USERNAME_REGEX.test(username)) {
      throw new SocialError(400, "invalid_username");
    }
    if (this.isOffensive(username)) {
      throw new SocialError(400, "inappropriate_username");
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new SocialError(400, "invalid_password");
    }
    if (this.findByUsername(username)) {
      throw new SocialError(409, "username_taken");
    }
    const user: UserRecord = {
      id: crypto.randomUUID(),
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: hashPassword(password),
      createdAt: this.now(),
    };
    this.data.users[user.id] = user;
    const token = this.newSession(user.id);
    this.save();
    return { token, user: { id: user.id, username: user.username } };
  }

  login(
    username: string,
    password: string,
  ): { token: string; user: PublicUser } {
    const user = this.findByUsername(username);
    // Same answer for "no such user" and "wrong password".
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new SocialError(401, "bad_credentials");
    }
    if (user.banned) throw new SocialError(403, "banned");
    const token = this.newSession(user.id);
    this.save();
    return { token, user: { id: user.id, username: user.username } };
  }

  logout(token: string): void {
    delete this.data.sessions[sha256(token)];
    this.save();
  }

  userForToken(token: string | undefined): PublicUser | null {
    if (!token) return null;
    const session = this.data.sessions[sha256(token)];
    if (!session) return null;
    if (session.expiresAt < this.now()) {
      delete this.data.sessions[sha256(token)];
      return null;
    }
    const user = this.data.users[session.userId];
    return user && !user.banned
      ? { id: user.id, username: user.username }
      : null;
  }

  private newSession(userId: string): string {
    const token = crypto.randomBytes(32).toString("hex");
    this.data.sessions[sha256(token)] = {
      userId,
      expiresAt: this.now() + SESSION_TTL_MS,
    };
    return token;
  }

  private findByUsername(username: string): UserRecord | undefined {
    const lower = username.toLowerCase();
    return Object.values(this.data.users).find(
      (u) => u.usernameLower === lower,
    );
  }

  private publicUser(id: string): PublicUser | null {
    const u = this.data.users[id];
    return u ? { id: u.id, username: u.username } : null;
  }

  // --- ratings ----------------------------------------------------------

  linkPlayer(userId: string, persistentId: string): void {
    const key = sha256(persistentId);
    if (this.data.links[key] === userId) return;
    this.data.links[key] = userId;
    this.save();
  }

  recordResult(result: GameResult): void {
    if (this.data.counted.includes(result.gameId)) return;
    this.data.counted.push(result.gameId);
    if (this.data.counted.length > MAX_COUNTED_KEPT) this.data.counted.shift();

    const humans = result.players.length;
    const winners = result.players.filter((p) => p.won).length;
    for (const p of result.players) {
      const userId = this.data.links[sha256(p.persistentId)];
      const user = userId ? this.data.users[userId] : undefined;
      if (!user) continue;
      const delta = ratingDelta(p.won, humans, winners);
      user.rating = Math.max(0, (user.rating ?? START_RATING) + delta);
      user.games = (user.games ?? 0) + 1;
      if (p.won) user.wins = (user.wins ?? 0) + 1;
      const list = (this.data.matches[user.id] ??= []);
      list.unshift({
        gameId: result.gameId,
        at: this.now(),
        map: result.map,
        mode: result.mode,
        players: humans,
        won: p.won,
        delta,
      });
      list.length = Math.min(list.length, MAX_MATCHES_KEPT);
    }
    this.save();
  }

  leaderboard(limit = 50): LeaderboardEntry[] {
    return Object.values(this.data.users)
      .filter((u) => !u.banned && (u.games ?? 0) > 0)
      .map((u) => ({
        username: u.username,
        rating: u.rating ?? START_RATING,
        wins: u.wins ?? 0,
        games: u.games ?? 0,
      }))
      .sort(
        (a, b) =>
          b.rating - a.rating ||
          b.wins - a.wins ||
          a.username.localeCompare(b.username),
      )
      .slice(0, limit);
  }

  profile(userId: string): {
    rating: number;
    wins: number;
    games: number;
    matches: MatchRecord[];
  } {
    const u = this.data.users[userId];
    return {
      rating: u?.rating ?? START_RATING,
      wins: u?.wins ?? 0,
      games: u?.games ?? 0,
      matches: this.data.matches[userId] ?? [],
    };
  }

  // --- admin ------------------------------------------------------------

  private requireUser(username: string): UserRecord {
    const user = this.findByUsername(username);
    if (!user) throw new SocialError(404, "user_not_found");
    return user;
  }

  private revokeSessions(userId: string): void {
    for (const [key, session] of Object.entries(this.data.sessions)) {
      if (session.userId === userId) delete this.data.sessions[key];
    }
  }

  setBanned(username: string, banned: boolean): void {
    const user = this.requireUser(username);
    user.banned = banned;
    if (banned) {
      this.revokeSessions(user.id);
      this.presence.delete(user.id);
    }
    this.save();
  }

  resetPassword(username: string, password: string): void {
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new SocialError(400, "invalid_password");
    }
    const user = this.requireUser(username);
    user.passwordHash = hashPassword(password);
    this.revokeSessions(user.id);
    this.save();
  }

  listUsers(): Array<PublicUser & { banned: boolean; createdAt: number }> {
    return Object.values(this.data.users)
      .map((u) => ({
        id: u.id,
        username: u.username,
        banned: u.banned === true,
        createdAt: u.createdAt,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  // --- friends ------------------------------------------------------------

  private friendIds(userId: string): string[] {
    const out: string[] = [];
    for (const key of this.data.friendships) {
      const [a, b] = key.split("|");
      if (a === userId) out.push(b);
      else if (b === userId) out.push(a);
    }
    return out;
  }

  requestFriend(fromId: string, username: string): "requested" | "accepted" {
    const to = this.findByUsername(username);
    if (!to) throw new SocialError(404, "user_not_found");
    if (to.id === fromId) throw new SocialError(400, "cannot_add_self");
    if (this.data.friendships.includes(pairKey(fromId, to.id))) {
      throw new SocialError(409, "already_friends");
    }
    if (this.friendIds(fromId).length >= MAX_FRIENDS) {
      throw new SocialError(400, "too_many_friends");
    }
    // They already asked us: asking back accepts.
    if (this.data.requests.includes(`${to.id}|${fromId}`)) {
      this.accept(fromId, to.id);
      return "accepted";
    }
    if (!this.data.requests.includes(`${fromId}|${to.id}`)) {
      this.data.requests.push(`${fromId}|${to.id}`);
      this.save();
    }
    return "requested";
  }

  accept(userId: string, fromId: string): void {
    const key = `${fromId}|${userId}`;
    if (!this.data.requests.includes(key)) {
      throw new SocialError(404, "no_request");
    }
    this.data.requests = this.data.requests.filter(
      (r) => r !== key && r !== `${userId}|${fromId}`,
    );
    this.data.friendships.push(pairKey(userId, fromId));
    this.save();
  }

  // Declines an incoming request, cancels an outgoing one, or unfriends.
  remove(userId: string, otherId: string): void {
    this.data.requests = this.data.requests.filter(
      (r) => r !== `${userId}|${otherId}` && r !== `${otherId}|${userId}`,
    );
    this.data.friendships = this.data.friendships.filter(
      (f) => f !== pairKey(userId, otherId),
    );
    this.save();
  }

  friendsOf(userId: string): FriendsView {
    const friends = this.friendIds(userId)
      .map((id) => this.publicUser(id))
      .filter((u): u is PublicUser => u !== null)
      .map((u) => {
        const p = this.livePresence(u.id);
        return {
          ...u,
          status: p?.status ?? ("offline" as const),
          gameId: p?.gameId ?? null,
        };
      });
    const rank = { game: 0, lobby: 1, online: 2, offline: 3 };
    friends.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] || a.username.localeCompare(b.username),
    );
    const incoming: PublicUser[] = [];
    const outgoing: PublicUser[] = [];
    for (const r of this.data.requests) {
      const [from, to] = r.split("|");
      if (to === userId) {
        const u = this.publicUser(from);
        if (u) incoming.push(u);
      } else if (from === userId) {
        const u = this.publicUser(to);
        if (u) outgoing.push(u);
      }
    }
    return { friends, incoming, outgoing };
  }

  // --- presence -----------------------------------------------------------

  setPresence(
    userId: string,
    status: PresenceStatus,
    gameId: string | null,
  ): void {
    this.presence.set(userId, {
      status,
      gameId: status === "online" ? null : gameId,
      at: this.now(),
    });
  }

  private livePresence(userId: string) {
    const p = this.presence.get(userId);
    if (!p) return null;
    if (this.now() - p.at > PRESENCE_TTL_MS) {
      this.presence.delete(userId);
      return null;
    }
    return p;
  }

  // --- open lobbies -------------------------------------------------------

  announceLobby(lobby: LobbyAnnouncement): void {
    this.lobbies.set(lobby.gameId, { ...lobby, updatedAt: this.now() });
  }

  closeLobby(gameId: string): void {
    this.lobbies.delete(gameId);
  }

  openLobbies(): LobbyView[] {
    const cutoff = this.now() - LOBBY_TTL_MS;
    for (const [id, l] of this.lobbies) {
      if (l.updatedAt < cutoff) this.lobbies.delete(id);
    }
    return [...this.lobbies.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
