import fs from "fs";
import os from "os";
import path from "path";
import {
  ratingDelta,
  SocialError,
  SocialStore,
  verifyPassword,
} from "../../src/server/social/SocialStore";

describe("SocialStore", () => {
  let now = 1_000_000;
  const clock = () => now;

  test("register, log in, and resolve a session", () => {
    const s = new SocialStore(null, clock);
    const { token, user } = s.register("Alice_1", "hunter22");
    expect(s.userForToken(token)).toEqual(user);
    // Usernames are unique regardless of case.
    expect(() => s.register("alice_1", "whatever")).toThrow(SocialError);
    const again = s.login("ALICE_1", "hunter22");
    expect(again.user.id).toBe(user.id);
    expect(() => s.login("alice_1", "wrong!!")).toThrow("bad_credentials");
    s.logout(token);
    expect(s.userForToken(token)).toBeNull();
  });

  test("rejects bad usernames and short passwords", () => {
    const s = new SocialStore(null, clock);
    expect(() => s.register("a b", "secret1")).toThrow("invalid_username");
    expect(() => s.register("bob", "123")).toThrow("invalid_password");
  });

  test("never stores passwords or tokens in plain text", () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "social-")),
      "s.json",
    );
    const s = new SocialStore(file, clock);
    const { token } = s.register("carol", "plaintext-pw");
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain("plaintext-pw");
    expect(raw).not.toContain(token);
    const stored = Object.values(JSON.parse(raw).users)[0] as {
      passwordHash: string;
    };
    expect(verifyPassword("plaintext-pw", stored.passwordHash)).toBe(true);
    // Survives a restart.
    expect(new SocialStore(file, clock).userForToken(token)?.username).toBe(
      "carol",
    );
  });

  test("friend requests, mutual accept, presence and removal", () => {
    const s = new SocialStore(null, clock);
    const a = s.register("ann", "password").user;
    const b = s.register("ben", "password").user;
    expect(s.requestFriend(a.id, "BEN")).toBe("requested");
    expect(s.friendsOf(b.id).incoming).toEqual([a]);
    expect(s.friendsOf(a.id).outgoing).toEqual([b]);
    s.accept(b.id, a.id);
    expect(s.friendsOf(a.id).friends.map((f) => f.username)).toEqual(["ben"]);

    s.setPresence(b.id, "lobby", "abcDEF12");
    expect(s.friendsOf(a.id).friends[0]).toMatchObject({
      status: "lobby",
      gameId: "abcDEF12",
    });
    now += 60_000; // presence expires
    expect(s.friendsOf(a.id).friends[0].status).toBe("offline");

    s.remove(a.id, b.id);
    expect(s.friendsOf(a.id).friends).toEqual([]);
  });

  test("asking someone who already asked you accepts", () => {
    const s = new SocialStore(null, clock);
    const a = s.register("ann", "password").user;
    const b = s.register("ben", "password").user;
    s.requestFriend(a.id, "ben");
    expect(s.requestFriend(b.id, "ann")).toBe("accepted");
    expect(s.friendsOf(a.id).friends).toHaveLength(1);
    expect(() => s.requestFriend(a.id, "ann")).toThrow("cannot_add_self");
  });

  test("open lobbies expire when no longer announced", () => {
    const s = new SocialStore(null, clock);
    s.announceLobby({
      gameId: "abcDEF12",
      host: "ann",
      map: "World",
      gameMode: "Free For All",
      playerCount: 2,
      maxPlayers: 10,
    });
    expect(s.openLobbies()).toHaveLength(1);
    now += 30_000;
    expect(s.openLobbies()).toHaveLength(0);
  });

  test("rejects offensive usernames when a filter is given", () => {
    const s = new SocialStore(null, clock, (n) => n.includes("bad"));
    expect(() => s.register("badword", "password")).toThrow(
      "inappropriate_username",
    );
    expect(s.register("goodname", "password").user.username).toBe("goodname");
  });

  test("admin can ban, unban and reset passwords", () => {
    const s = new SocialStore(null, clock);
    const { token } = s.register("dana", "password1");
    s.setBanned("DANA", true);
    expect(s.userForToken(token)).toBeNull();
    expect(() => s.login("dana", "password1")).toThrow("banned");
    s.setBanned("dana", false);
    s.resetPassword("dana", "newpass99");
    expect(() => s.login("dana", "password1")).toThrow("bad_credentials");
    expect(s.login("dana", "newpass99").user.username).toBe("dana");
    expect(s.listUsers().map((u) => u.username)).toEqual(["dana"]);
  });

  test("rating changes reward beating more players", () => {
    expect(ratingDelta(true, 2, 1)).toBe(30);
    expect(ratingDelta(true, 6, 1)).toBe(60);
    expect(ratingDelta(false, 2, 1)).toBeLessThan(0);
    expect(ratingDelta(false, 4, 0)).toBe(-5);
  });

  test("records a finished game once, for linked accounts only", () => {
    const s = new SocialStore(null, clock);
    const a = s.register("ann", "password").user;
    const b = s.register("ben", "password").user;
    s.linkPlayer(a.id, "pid-ann-0001");
    s.linkPlayer(b.id, "pid-ben-0001");
    const result = {
      gameId: "abcDEF12",
      map: "World",
      mode: "Free For All",
      players: [
        { persistentId: "pid-ann-0001", username: "ann", won: true },
        { persistentId: "pid-ben-0001", username: "ben", won: false },
        { persistentId: "pid-guest-01", username: "guest", won: false },
      ],
    };
    s.recordResult(result);
    s.recordResult(result); // duplicate report is ignored
    const ann = s.profile(a.id);
    expect(ann.games).toBe(1);
    expect(ann.wins).toBe(1);
    expect(ann.rating).toBeGreaterThan(1000);
    expect(ann.matches[0]).toMatchObject({ gameId: "abcDEF12", won: true });
    expect(s.profile(b.id).rating).toBeLessThan(1000);
    expect(s.leaderboard().map((e) => e.username)).toEqual(["ann", "ben"]);
  });

  test("game servers get a player's account and friends for team grouping", () => {
    const s = new SocialStore(null, clock);
    const a = s.register("ann", "password").user;
    const b = s.register("ben", "password").user;
    s.requestFriend(a.id, "ben");
    s.accept(b.id, a.id);
    s.linkPlayer(a.id, "pid-ann-0001");
    expect(s.identityForPlayer("pid-ann-0001")).toEqual({
      publicId: a.id,
      friends: [b.id],
    });
    expect(s.identityForPlayer("pid-unknown-1")).toBeNull();
  });
});
