import * as React from "react";
import { Tooltip as T } from "radix-ui";

export const TooltipProvider = T.Provider;

export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-[320px] rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-[12px] leading-snug text-fg-2 shadow-lg">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
