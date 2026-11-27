import http from "node:http";
import express from "express";
import cors from "cors";
import { Server, WebSocketTransport } from "colyseus";
import { ColosseumRoom } from "./rooms/ColosseumRoom.js";

const rawPort = Number(process.env.PORT);
const PORT = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 2567;
const HOST = process.env.HOST?.trim() || "0.0.0.0";
const rawCorsOrigin = process.env.CORS_ORIGIN?.trim();
const corsOrigin: boolean | string[] =
  rawCorsOrigin && rawCorsOrigin !== "*"
    ? rawCorsOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    game: "sekiroslop",
    room: "colosseum",
    health: "/health",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    game: "sekiroslop",
    uptimeSec: Math.round(process.uptime()),
    timestamp: Date.now(),
  });
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 10_000,
    pingMaxRetries: 3,
  }),
  gracefullyShutdown: true,
});

gameServer.define("colosseum", ColosseumRoom);

gameServer.onBeforeShutdown(() => {
  console.log("[Colosseum Server] Shutting down gracefully...");
});

gameServer.onShutdown(() => {
  console.log("[Colosseum Server] Shutdown complete.");
});

gameServer
  .listen(PORT, HOST)
  .then(() => {
    const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`[Colosseum Server] Listening on ws://${HOST}:${PORT} (local: ws://${displayHost}:${PORT})`);
    console.log(`[Colosseum Server] Health check: http://${displayHost}:${PORT}/health`);
  })
  .catch((err) => {
    console.error("[Colosseum Server] Failed to start:", err);
    process.exit(1);
  });
