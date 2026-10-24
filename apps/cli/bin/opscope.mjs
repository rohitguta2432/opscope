#!/usr/bin/env node
// Runs the TypeScript CLI directly through tsx; no build step needed.
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
