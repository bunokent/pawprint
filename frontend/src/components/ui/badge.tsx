import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Mode = "emergency" | "found" | "outreach";

export function ModeBadge({ mode, className }: { mode?: Mode } & HTMLAttributes<HTMLSpanElement>) {
  const emergency = mode === "emergency";
  const found = mode === "found";
  return (
    <span
      className={cn(
        "badge",
        emergency ? "badge--emergency" : found ? "badge--found" : "badge--outreach",
        className,
      )}
    >
      {emergency ? "Lost — urgent" : found ? "Found pet" : mode === "outreach" ? "Adoptable" : "Flyer"}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "badge--outreach",
    generating: "badge--neutral",
    draft: "badge--neutral",
    resolved: "badge--neutral",
    pending: "badge--neutral",
    succeeded: "badge--outreach",
    failed: "badge--emergency",
  };
  return <span className={cn("badge", map[status] ?? "badge--neutral")}>{status}</span>;
}
