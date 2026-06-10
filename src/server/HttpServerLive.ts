import { HttpMiddleware, HttpServer } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { Layer } from "effect";
import { router } from "./routes";

const ALLOWED_ORIGINS: ReadonlyArray<string> = ["tauri://localhost"];

const isAllowedOrigin = (origin: string): boolean => {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

const corsMiddleware = HttpMiddleware.cors({
  allowedOrigins: isAllowedOrigin,
  allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
});

const RouterLive = HttpServer.serve(router, corsMiddleware);

export const HttpServerLive = (port: number) => RouterLive.pipe(Layer.provideMerge(BunHttpServer.layer({ port, hostname: "127.0.0.1" })));
