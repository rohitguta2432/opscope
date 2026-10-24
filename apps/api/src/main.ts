import { startServer } from "./main-lib";

const { url, cfg, service } = await startServer();
const usable = cfg.connections.filter((c) => c.url).map((c) => c.info.id);
console.log(`opscope api  ${url}`);
console.log(`config       ${cfg.path ?? "(defaults)"}  ·  connections: ${usable.length ? usable.join(", ") : "none usable"}`);
console.log(`sessions     ${service.store.path}`);
