"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  DeliverableKnowledgeProfile,
  DeliverableOutcomeProfile,
  DeliverableReliabilityProfile,
  IntelligenceDashboard,
  IntelligenceTrustProfile,
  RecommendationProfile,
} from "@/lib/api";
import {
  humanClassification,
  reliabilityStory,
  reliabilityWord,
  reliabilityTone,
  typicalDurationPhrase,
  understandingFor,
  variationPhrase,
} from "@/lib/intelligence-language";

type Props = {
  classification: string | null;
  data: IntelligenceDashboard;
  onClose: () => void;
};

const TONE_TEXT: Record<"good" | "moderate" | "low", string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  moderate: "text-amber-700 dark:text-amber-300",
  low: "text-slate-600 dark:text-slate-300",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "moderate" | "low" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold", tone ? TONE_TEXT[tone] : "text-slate-900 dark:text-white")}>
        {value}
      </div>
    </div>
  );
}

export function DeliverableTypeDetailDialog({ classification, data, onClose }: Props) {
  const open = classification != null;
  const knowledge: DeliverableKnowledgeProfile | undefined = data.deliverableProfiles.find(
    (p) => p.classification === classification
  );
  const reliability: DeliverableReliabilityProfile | undefined = data.reliabilityProfiles.find(
    (p) => p.classification === classification
  );
  const outcome: DeliverableOutcomeProfile | undefined = data.outcomeProfiles.find(
    (p) => p.classification === classification
  );
  const trust: IntelligenceTrustProfile | undefined = data.trustProfiles.find(
    (p) => p.classification === classification
  );
  const recommendations: RecommendationProfile[] = data.recommendationTrends
    .flatMap((g) => g.profiles)
    .filter((p) => p.classification === classification);

  const label =
    knowledge?.label ??
    reliability?.label ??
    outcome?.label ??
    trust?.label ??
    humanClassification(classification);

  const understanding = understandingFor({
    learningMaturity: knowledge?.learningMaturity,
    projectCount: knowledge?.projectCount ?? trust?.evidenceStrength.projectCount,
    sampleSize: knowledge?.sampleSize ?? trust?.evidenceStrength.sampleSize,
  });
  const variation = knowledge ? variationPhrase(knowledge) : null;
  const typicalDays =
    outcome?.historicalMedianDuration ??
    knowledge?.medianDuration ??
    outcome?.predictedMostLikelyDuration ??
    null;
  const projectCount = knowledge?.projectCount ?? trust?.evidenceStrength.projectCount ?? 0;
  const sampleSize = knowledge?.sampleSize ?? trust?.evidenceStrength.sampleSize ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            What Rana has learned about this type of work from previous projects.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Typical duration" value={typicalDurationPhrase(typicalDays)} />
          <Stat
            label="Compared with previous projects"
            value={variation?.label ?? "Still learning"}
            tone={variation?.tone}
          />
          <Stat
            label="How reliable is this?"
            value={reliabilityWord(knowledge?.confidenceLevel ?? trust?.evidenceStrength.benchmarkConfidence)}
            tone={reliabilityTone(knowledge?.confidenceLevel)}
          />
          <Stat label="How well understood" value={understanding.label} tone={understanding.tone} />
          <Stat
            label="Based on"
            value={`${sampleSize} work package${sampleSize === 1 ? "" : "s"}`}
          />
          <Stat
            label="Across"
            value={`${projectCount} previous project${projectCount === 1 ? "" : "s"}`}
          />
        </div>

        {reliability ? (
          <section>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">What usually happens</h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{reliabilityStory(reliability)}.</p>
            {reliability.averageVariancePercent != null ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                On average, this work {reliability.averageVariancePercent > 0 ? "ran over by" : "came in under by"}{" "}
                {Math.abs(Math.round(reliability.averageVariancePercent))}% compared with the original plan.
              </p>
            ) : null}
          </section>
        ) : null}

        {outcome && outcome.predictedMostLikelyDuration != null ? (
          <section>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">What to expect next time</h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Similar work most often takes around {Math.round(outcome.predictedMostLikelyDuration)} days.
            </p>
          </section>
        ) : null}

        {recommendations.length > 0 ? (
          <section>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">What usually needs reviewing</h4>
            <ul className="mt-2 space-y-2">
              {recommendations.slice(0, 4).map((r) => (
                <li
                  key={r.id}
                  className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/50 dark:text-slate-200"
                >
                  {r.recommendation}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {projectCount <= 1 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            This is based on only one project so far. Importing more completed programmes of this type will make it more
            reliable.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
