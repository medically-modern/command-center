/**
 * Which colour each order state wears — kept out of `pills.tsx` so that file
 * exports only components (fast refresh) and the sidebar can colour its dots
 * from the same table.
 */
import type { CardinalKind, OrderStage } from "@/lib/orders/workflow";

export type PillTone = "teal" | "slate" | "sky" | "amber" | "emerald" | "rose" | "violet";

export const STAGE_TONE: Record<OrderStage, PillTone> = {
  toPlace: "teal",
  onHold: "slate",
  placing: "sky",
  inProgress: "amber",
  shipped: "sky",
  delivered: "emerald",
  returns: "violet",
  cancelled: "slate",
  stuck: "rose",
  other: "slate",
};

export const CARDINAL_TONE: Record<CardinalKind, PillTone> = {
  none: "slate",
  processing: "sky",
  accepted: "emerald",
  warning: "amber",
  hold: "rose",
  error: "rose",
  review: "rose",
  backordered: "amber",
  substitution: "amber",
  shipped: "sky",
  partial: "sky",
  delivered: "emerald",
  deleted: "rose",
  unknown: "slate",
};

