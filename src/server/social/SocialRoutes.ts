import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
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

  return router;
}
