import fs from "fs";
import os from "os";
import path from "path";
import {
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
});
