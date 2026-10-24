import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "session"; id: string } | { name: "new" };

function parse(hash: string): Route {
  const h = hash.replace(/^#/, "");
  const m = /^\/s\/([\w-]+)/.exec(h);
  if (m) return { name: "session", id: m[1]! };
  if (h.startsWith("/new")) return { name: "new" };
  return { name: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (to: string) => {
  window.location.hash = to;
};
export const hrefSession = (id: string) => `#/s/${id}`;
