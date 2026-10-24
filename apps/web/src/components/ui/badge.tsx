import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-[5px] border px-1.5 h-[20px] font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "border-line-strong text-fg-2 bg-raised",
      lav: "border-lav-line text-lav bg-lav-soft",
      lime: "border-lime-line text-lime bg-lime-soft",
      rose: "border-rose-line text-rose bg-rose-soft",
      sand: "border-sand-line text-sand bg-sand-soft",
      demo: "border-sand-line text-sand hatch",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
