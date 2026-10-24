import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Recording hook: demo capture scripts set window.__OPSCOPE_ANIM_SCALE to slow animations, then speed the footage back up. */
export function animScale(): number {
  const v = Number((globalThis as { __OPSCOPE_ANIM_SCALE?: number }).__OPSCOPE_ANIM_SCALE ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}
