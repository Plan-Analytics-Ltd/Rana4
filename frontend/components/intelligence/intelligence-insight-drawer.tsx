"use client";

import { DeliverableBenchmarkPanel } from "@/components/deliverables/deliverable-benchmark-panel";
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

export function IntelligenceInsightDrawer({
  open,
  onOpenChange,
  projectId,
  deliverableId,
  deliverableName,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>{deliverableName ?? "Deliverable insight"}</SheetTitle>
          <SheetDescription>
            What Rana4 found, why it matters, and what you may wish to review — without leaving your current page.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <DeliverableBenchmarkPanel
            projectId={projectId}
            deliverableId={deliverableId}
            enabled={open}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
