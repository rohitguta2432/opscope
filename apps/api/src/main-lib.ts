import { killAllAnvils, loadConfig, type LoadedConfig } from "@opscope/engine";
import { buildServer } from "./server";

const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

export async function startServer(opts: { configPath?: string; host?: string; port?: number; config?: LoadedConfig } = {}) {
  const cfg = opts.config ?? loadConfig(opts.configPath);
  const host = opts.host ?? cfg.config.server.host;
  const port = opts.port ?? Number(process.env.PORT ?? cfg.config.server.port);
  if (!LOCAL.has(host) && process.env.OPSCOPE_ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to bind ${host}: OpScope binds localhost only. Set OPSCOPE_ALLOW_REMOTE=1 to override (exposes RPC-backed replays).`);
  }
  const { app, service } = buildServer(cfg);
  const shutdown = async () => {
    killAllAnvils();
    await app.close();
    service.store.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await app.listen({ host, port });
  return { app, service, url: `http://${host === "::1" ? "[::1]" : host}:${port}`, cfg };
}
