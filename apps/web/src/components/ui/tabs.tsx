import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

export function TabsList({ className, ...p }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("relative flex items-end gap-1 border-b border-line", className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "group relative -mb-px inline-flex h-10 cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 font-display text-[13.5px] font-semibold text-fg-3 transition-colors hover:text-fg-2 data-[state=active]:border-lav data-[state=active]:text-fg [&_svg]:size-4",
        className,
      )}
      {...p}
    />
  );
}

export function TabsContent({ className, ...p }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("outline-none", className)} {...p} />;
}
