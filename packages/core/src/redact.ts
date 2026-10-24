/**
 * Redaction for anything that leaves the server: reports, exports, API responses.
 * RPC URLs usually carry the credential in the path (/v2/<key>), the query (?apikey=)
 * or userinfo (https://user:pass@host). Only scheme + host survive.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== "/" ? "/…" : "";
    return `${u.protocol}//${u.host}${path}${u.search ? "?…" : ""}`;
  } catch {
    return "[redacted url]";
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "[invalid url]";
  }
}

const GENERIC = [
  /(https?|wss?):\/\/[^\s"'`<>]+/gi,
  /\b(api[-_]?key|apikey|token|secret|password|auth)=([^&\s"']+)/gi,
];

/** Replaces every known secret and any URL-looking string. */
export function redactText(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  }
  out = out.replace(GENERIC[0]!, (m) => (m.includes("127.0.0.1") || m.includes("localhost") ? redactLocal(m) : redactUrl(m)));
  out = out.replace(GENERIC[1]!, (_m, k) => `${k}=[redacted]`);
  return out;
}

function redactLocal(m: string) {
  try {
    const u = new URL(m);
    return `${u.protocol}//${u.hostname}:${u.port || "…"}`;
  } catch {
    return m;
  }
}

export function redactDeep<T>(value: T, secrets: string[] = []): T {
  return JSON.parse(redactText(JSON.stringify(value), secrets)) as T;
}
