import type { ReactNode } from "react";
import { Activity, Calendar, Clock, GitBranch, Link2, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { XerProjectPreview } from "@/lib/api";
import { formatPreviewDate } from "@/lib/project-detection-ui";

function StatItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 text-slate-400 dark:text-slate-500">{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

export function ProgrammeStatisticsGrid({ preview }: { preview: XerProjectPreview }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Programme summary</h3>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        <StatItem icon={<Activity className="h-4 w-4" />} label="Activities" value={String(preview.activityCount)} />
        <StatItem
          icon={<Link2 className="h-4 w-4" />}
          label="Relationships"
          value={String(preview.relationshipCount)}
        />
        <StatItem icon={<GitBranch className="h-4 w-4" />} label="WBS" value={String(preview.wbsCount)} />
        <StatItem icon={<Calendar className="h-4 w-4" />} label="Calendars" value={String(preview.calendarCount)} />
        <StatItem
          icon={<Clock className="h-4 w-4" />}
          label="Project start"
          value={formatPreviewDate(preview.projectStart)}
        />
        <StatItem
          icon={<Clock className="h-4 w-4" />}
          label="Project finish"
          value={formatPreviewDate(preview.projectFinish)}
        />
        <StatItem icon={<Wrench className="h-4 w-4" />} label="Resources" value={String(preview.resourceCount)} />
      </div>
    </section>
  );
}

export function DetectedFieldRow({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="border-b border-slate-100 py-4 last:border-b-0 dark:border-slate-800">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required ? " *" : ""}
      </label>
      <Input
        className="mt-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}
