import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";
import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { INTERNAL_KEY_HEADER } from "./GameResults";
import {
  PASSWORD_MAX,
  PublicUser,
  SocialError,
  SocialStore,
} from "./SocialStore";

const CredentialsSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(200),
});
const FriendRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
});
const OtherUserSchema = z.object({ id: z.string().uuid() });
const PresenceSchema = z.object({
  status: z.enum(["online", "lobby", "game"]),
  gameId: z.string().regex(GAME_ID_REGEX).nullable().optional(),
});
const LobbySchema = z.object({
  gameId: z.string().regex(GAME_ID_REGEX),
  host: z.string().trim().min(1).max(32),
  map: z.string().max(64).nullable().optional(),
  gameMode: z.string().max(32).nullable().optional(),
  playerCount: z.number().int().min(0).max(1000).nullable().optional(),
  maxPlayers: z.number().int().min(0).max(1000).nullable().optional(),
});

const GameResultSchema = z.object({
  gameId: z.string().regex(GAME_ID_REGEX),
  map: z.string().max(64),
  mode: z.string().max(64),
  players: z
    .array(
      z.object({
        persistentId: z.string().min(1).max(64),
        username: z.string().max(64),
        won: z.boolean(),
      }),
    )
    .max(200),
});

interface AuthedRequest extends Request {
  user?: PublicUser;
  token?: string;
}

function bearer(req: Request): string | undefined {
  const h = req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export function socialRouter(store: SocialStore): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "16kb" }));

  // Guessing passwords: a handful of tries per minute per address.
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const requireUser = (
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const token = bearer(req);
    const user = store.userForToken(token);
    if (!user) {
      res.status(401).json({ error: "not_logged_in" });
      return;
    }
    req.user = user;
    req.token = token;
    next();
  };

  const handle =
    (fn: (req: AuthedRequest, res: Response) => void) =>
    (req: AuthedRequest, res: Response) => {
      try {
        fn(req, res);
      } catch (err) {
        if (err instanceof SocialError) {
          res.status(err.status).json({ error: err.code });
        } else if (err instanceof z.ZodError) {
          res.status(400).json({ error: "bad_request" });
        } else {
          console.error("social route failed", err);
          res.status(500).json({ error: "server_error" });
        }
      }
    };

  router.post(
    "/register",
    authLimiter,
    handle((req, res) => {
      const { username, password } = CredentialsSchema.parse(req.body);
      if (password.length > PASSWORD_MAX) {
        throw new SocialError(400, "invalid_password");
      }
      res.json(store.register(username, password));
    }),
  );

  router.post(
    "/login",
    authLimiter,
    handle((req, res) => {
      const { username, password } = CredentialsSchema.parse(req.body);
      res.json(store.login(username, password));
    }),
  );

  router.post(
    "/logout",
    requireUser,
    handle((req, res) => {
      store.logout(req.token!);
      res.json({ ok: true });
    }),
  );

  router.get(
    "/me",
    requireUser,
    handle((req, res) => res.json({ user: req.user })),
  );

  router.get(
    "/friends",
    requireUser,
    handle((req, res) => res.json(store.friendsOf(req.user!.id))),
  );

  router.post(
    "/friends/request",
    requireUser,
    handle((req, res) => {
      const { username } = FriendRequestSchema.parse(req.body);
      res.json({ result: store.requestFriend(req.user!.id, username) });
    }),
  );

  router.post(
    "/friends/accept",
    requireUser,
    handle((req, res) => {
      const { id } = OtherUserSchema.parse(req.body);
      store.accept(req.user!.id, id);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/friends/remove",
    requireUser,
    handle((req, res) => {
      const { id } = OtherUserSchema.parse(req.body);
      store.remove(req.user!.id, id);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/presence",
    requireUser,
    handle((req, res) => {
      const { status, gameId } = PresenceSchema.parse(req.body);
      store.setPresence(req.user!.id, status, gameId ?? null);
      res.json({ ok: true });
    }),
  );

  // The open-lobby board needs no account: anyone on this server can host
  // and anyone can join.
  router.get(
    "/lobbies",
    handle((_req, res) => res.json({ lobbies: store.openLobbies() })),
  );

  router.post(
    "/lobbies",
    handle((req, res) => {
      const l = LobbySchema.parse(req.body);
      store.announceLobby({
        gameId: l.gameId,
        host: l.host,
        map: l.map ?? null,
        gameMode: l.gameMode ?? null,
        playerCount: l.playerCount ?? null,
        maxPlayers: l.maxPlayers ?? null,
      });
      res.json({ ok: true });
    }),
  );

  router.delete(
    "/lobbies/:gameId",
    handle((req, res) => {
      const gameId = z.string().regex(GAME_ID_REGEX).parse(req.params.gameId);
      store.closeLobby(gameId);
      res.json({ ok: true });
    }),
  );

  // --- ratings ------------------------------------------------------------
  router.post(
    "/link",
    requireUser,
    handle((req, res) => {
      const { persistentId } = z
        .object({ persistentId: z.string().min(8).max(64) })
        .parse(req.body);
      store.linkPlayer(req.user!.id, persistentId);
      res.json({ ok: true });
    }),
  );

  router.get(
    "/leaderboard",
    handle((_req, res) => res.json({ entries: store.leaderboard() })),
  );

  router.get(
    "/profile",
    requireUser,
    handle((req, res) => res.json(store.profile(req.user!.id))),
  );

  // From this server's own game workers (they share API_KEY).
  const requireInternal = (req: Request, res: Response, next: NextFunction) => {
    const key = process.env.API_KEY ?? "";
    const given = req.header(INTERNAL_KEY_HEADER) ?? "";
    if (
      !key ||
      given.length !== key.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };

  router.post(
    "/internal/result",
    requireInternal,
    handle((req, res) => {
      store.recordResult(GameResultSchema.parse(req.body));
      res.json({ ok: true });
    }),
  );

  router.post(
    "/internal/identity",
    requireInternal,
    handle((req, res) => {
      const { persistentId } = z
        .object({ persistentId: z.string().min(1).max(64) })
        .parse(req.body);
      res.json({ identity: store.identityForPlayer(persistentId) });
    }),
  );

  // --- admin: header "x-admin-key: <SOCIAL_ADMIN_KEY>" ---------------------
  const adminKey = process.env.SOCIAL_ADMIN_KEY;
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const given = req.header("x-admin-key") ?? "";
    // No key configured: admin endpoints stay off.
    if (
      !adminKey ||
      given.length !== adminKey.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(adminKey))
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
  const AdminUserSchema = z.object({ username: z.string().trim().min(1) });

  router.get(
    "/admin/users",
    authLimiter,
    requireAdmin,
    handle((_req, res) => res.json({ users: store.listUsers() })),
  );
  router.post(
    "/admin/ban",
    authLimiter,
    requireAdmin,
    handle((req, res) => {
      store.setBanned(AdminUserSchema.parse(req.body).username, true);
      res.json({ ok: true });
    }),
  );
  router.post(
    "/admin/unban",
    authLimiter,
    requireAdmin,
    handle((req, res) => {
      store.setBanned(AdminUserSchema.parse(req.body).username, false);
      res.json({ ok: true });
    }),
  );
  router.post(
    "/admin/reset-password",
    authLimiter,
    requireAdmin,
    handle((req, res) => {
      const { username, password } = AdminUserSchema.extend({
        password: z.string(),
      }).parse(req.body);
      store.resetPassword(username, password);
      res.json({ ok: true });
    }),
  );

  return router;
}
