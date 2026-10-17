import { Badge } from "@/components/ui/Badge";
import { STAGE_LABEL, type LifecycleStage } from "@/lib/listingReview";

const STAGE_VARIANT: Record<LifecycleStage, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  awaiting_host_review: "warning",
  changes_requested: "warning",
  host_approved: "brand",
  ready_to_publish: "brand",
  awaiting_fystay_review: "warning",
  live: "success",
  suspended: "danger",
  withdrawn: "neutral",
  hidden: "neutral",
};

/** A listing's lifecycle stage (see lifecycleStage), as one badge. */
export function StageBadge({ stage }: { stage: LifecycleStage }) {
  return <Badge variant={STAGE_VARIANT[stage]}>{STAGE_LABEL[stage]}</Badge>;
}
