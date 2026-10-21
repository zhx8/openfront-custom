// Single-port hosting: forwards the routes nginx normally sends to the game
// workers (see nginx.conf) from the master's own HTTP server, so the whole
// game can run behind one port on hosts like Render or Fly.io that terminate
// HTTPS for you. Enabled with PROXY_WORKERS=true; off by default, since the
// Docker image keeps using nginx.

import type { Express, NextFunction, Request, Response } from "express";
import http from "http";
import net from "net";
import { ServerEnv } from "./ServerEnv";

const WORKER_PATH = /^\/w(\d+)(\/.*)?$/;
// Lobby creation goes to any worker, which mints a game id it owns.
const ANY_WORKER_PATHS = new Set([
  "/api/create_game",
  "/api/adminbot/create_game",
  "/api/adminbot/create_pool",
]);

export function proxyWorkersEnabled(): boolean {
  return process.env.PROXY_WORKERS === "true";
}

function target(url: string): { port: number; path: string } | null {
  const [pathname, query = ""] = url.split(/\?(.*)/s, 2);
  const m = WORKER_PATH.exec(pathname);
  if (m) {
    const index = Number(m[1]);
    if (index >= ServerEnv.numWorkers()) return null;
    return {
      port: ServerEnv.workerPortByIndex(index),
      path: (m[2] ?? "/") + (query ? `?${query}` : ""),
    };
  }
  if (ANY_WORKER_PATHS.has(pathname)) {
    const index = Math.floor(Math.random() * ServerEnv.numWorkers());
    return { port: ServerEnv.workerPortByIndex(index), path: url };
  }
  return null;
}

function forwardedHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const remote = req.socket.remoteAddress ?? "";
  const prior = req.headers["x-forwarded-for"];
  return {
    ...req.headers,
    "x-real-ip": (req.headers["x-real-ip"] as string | undefined) ?? remote,
    "x-forwarded-for": prior ? `${prior}, ${remote}` : remote,
  };
}

// Must run before any body parser: the request body is streamed through.
export function installWorkerProxy(app: Express, server: http.Server): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const t = target(req.originalUrl);
    if (t === null) return next();
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: t.port,
        path: t.path,
        method: req.method,
        headers: forwardedHeaders(req),
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502).send("worker unavailable");
      else res.end();
    });
    req.pipe(upstream);
  });

  // WebSockets: replay the upgrade request to the worker and splice the
  // sockets together.
  server.on("upgrade", (req, socket, head) => {
    const t = target(req.url ?? "/");
    if (t === null) return; // not ours; other upgrade handlers may take it
    const upstream = net.connect(t.port, "127.0.0.1", () => {
      const headers = forwardedHeaders(req);
      let raw = `${req.method} ${t.path} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (v === undefined) continue;
        for (const value of Array.isArray(v) ? v : [v]) {
          raw += `${k}: ${value}\r\n`;
        }
      }
      upstream.write(raw + "\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
  });
}
