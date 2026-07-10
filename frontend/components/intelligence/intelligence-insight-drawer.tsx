"use client";

import { DeliverableBenchmarkPanel } from "@/components/deliverables/deliverable-benchmark-panel";
import { OpenInPlanningWorkspaceButton } from "@/components/intelligence/open-in-planning-workspace-button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  deliverableId: string;
  deliverableName?: string;
};

/**
 * The drawer and the floating Ask Rana assistant form one interaction
 * workspace: interacting with Ask Rana must not dismiss the drawer.
 */
function isInsideAskRana(event: {
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
}): boolean {
  const target = event.detail?.originalEvent?.target ?? event.target;
  if (!(target instanceof Node)) return false;
  const el = target instanceof Element ? target : target.parentElement;
  return !!el?.closest("[data-ask-rana-root]");
}

export function IntelligenceInsightDrawer({
  open,
  onOpenChange,
  projectId,
  deliverableId,
  deliverableName,
}: Props) {
  return (
    // Non-modal so Ask Rana (a portal sibling) stays fully interactive:
    // no focus trap, no body pointer-events lock. The backdrop still absorbs
    // background clicks, and clicks on it dismiss via outside detection.
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className="max-w-xl"
        data-intelligence-drawer
        onPointerDownOutside={(event) => {
          if (isInsideAskRana(event)) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isInsideAskRana(event)) event.preventDefault();
        }}
        onFocusOutside={(event) => {
          if (isInsideAskRana(event)) event.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>{deliverableName ?? "Deliverable insight"}</SheetTitle>
          <SheetDescription>
            What Rana found, why it matters, and what to do next — without leaving your current page.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <DeliverableBenchmarkPanel
            projectId={projectId}
            deliverableId={deliverableId}
            enabled={open}
          />
        </SheetBody>
        <div className="shrink-0 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Reviewed the insight? Open the planning workspace to adjust durations or logic on this deliverable.
          </p>
          <OpenInPlanningWorkspaceButton />
        </div>
      </SheetContent>
    </Sheet>
  );
}
