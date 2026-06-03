"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { FormField, FormSection, fieldClass } from "@/components/schedule/form-section";
import {
  ResourceAssignmentsEditor,
  type ResourceAssignmentDraft,
} from "@/components/resource-assignments-editor";
import {
  ACTIVITY_FORM_SCOPE_COPY,
  type ActivityFormScope,
} from "@/lib/activity-form-utils";
import type { ActivityCodeType, AssuranceNote, Deliverable, RateCardEntry } from "@/lib/api";

export type ActivityDefinitionFormProps = {
  scope: ActivityFormScope;
  formActivityCode: string;
  onActivityCode: (v: string) => void;
  formName: string;
  onName: (v: string) => void;
  formBestDuration: string;
  onBestDuration: (v: string) => void;
  formLikelyDuration: string;
  onLikelyDuration: (v: string) => void;
  mayEditP6Codes: boolean;
  codeTypes: ActivityCodeType[];
  formP6Codes: Record<string, string>;
  onP6Code: (typeId: string, codeId: string) => void;
  rateCardEntries: RateCardEntry[] | null;
  formResourceDrafts: ResourceAssignmentDraft[];
  onResourceDrafts: (drafts: ResourceAssignmentDraft[]) => void;
  submitting: boolean;
  lockActivityCode?: boolean;
  activityCodeHint?: string | null;
  activityCodeAvailable?: boolean | null;
  activityCodeChecking?: boolean;
  suggestedActivityCode?: string | null;
  nextAvailableActivityId?: string | null;
  nextAvailableLoading?: boolean;
  onUseSuggestedCode?: (code: string) => void;
  /** Deliverable scope only */
  deliverables?: Deliverable[];
  loadingDeliverables?: boolean;
  formDeliverableId?: string;
  onDeliverableId?: (id: string) => void;
  formLinkedDeliverableIds?: string[];
  onLinkedDeliverableIds?: (ids: string[]) => void;
  formIsSharedAcrossDeliverables?: boolean;
  onIsSharedAcrossDeliverables?: (value: boolean) => void;
  allowEmptyDeliverable?: boolean;
  assuranceNotes?: AssuranceNote[];
  formAssuranceNoteId?: string;
  onAssuranceNoteId?: (id: string) => void;
  /** Reserved for default-activity sequencing (predecessors, order rules). */
  extraSections?: ReactNode;
};

export function ActivityDefinitionForm(props: ActivityDefinitionFormProps) {
  const {
    scope,
    formActivityCode,
    onActivityCode,
    formName,
    onName,
    formBestDuration,
    onBestDuration,
    formLikelyDuration,
    onLikelyDuration,
    mayEditP6Codes,
    codeTypes,
    formP6Codes,
    onP6Code,
    rateCardEntries,
    formResourceDrafts,
    onResourceDrafts,
    submitting,
    lockActivityCode = false,
    activityCodeHint = null,
    activityCodeAvailable = null,
    activityCodeChecking = false,
    suggestedActivityCode = null,
    nextAvailableActivityId = null,
    nextAvailableLoading = false,
    onUseSuggestedCode,
    deliverables = [],
    loadingDeliverables = false,
    formDeliverableId = "",
    onDeliverableId,
    formLinkedDeliverableIds = [],
    onLinkedDeliverableIds,
    formIsSharedAcrossDeliverables = false,
    onIsSharedAcrossDeliverables,
    allowEmptyDeliverable = false,
    assuranceNotes = [],
    formAssuranceNoteId = "",
    onAssuranceNoteId,
    extraSections,
  } = props;

  const copy = ACTIVITY_FORM_SCOPE_COPY[scope];

  return (
    <div className="space-y-8 py-2">
      <FormSection title="Basic info" description={copy.basicDescription}>
        {scope === "deliverable" && onDeliverableId ? (
          <>
            <FormField label="Deliverable">
              <select
                value={formDeliverableId}
                onChange={(e) => onDeliverableId(e.target.value)}
                disabled={loadingDeliverables || deliverables.length === 0}
                className={fieldClass}
                required={!allowEmptyDeliverable}
              >
                {allowEmptyDeliverable ? <option value="">No deliverable / use project-level bucket</option> : null}
                {deliverables.length === 0 ? <option value="">No deliverables on this fragnet</option> : null}
                {deliverables.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </FormField>
            {onIsSharedAcrossDeliverables ? (
              <FormField label="Sharing">
                <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={formIsSharedAcrossDeliverables}
                    onChange={(e) => onIsSharedAcrossDeliverables(e.target.checked)}
                    disabled={loadingDeliverables}
                  />
                  <span className="space-y-1">
                    <span className="block font-medium text-slate-900 dark:text-slate-100">
                      Shared across deliverables
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {formIsSharedAcrossDeliverables
                        ? "One activity is shared by the deliverables you select below."
                        : "A separate copy of this activity is added to every deliverable in this fragnet."}
                    </span>
                  </span>
                </label>
              </FormField>
            ) : null}
            {formIsSharedAcrossDeliverables && onLinkedDeliverableIds ? (
              <FormField label="Also used on">
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  {deliverables.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No deliverables available in this fragnet.</p>
                  ) : (
                    deliverables.map((d) => {
                      const checked = new Set([formDeliverableId, ...formLinkedDeliverableIds]).has(d.id);
                      return (
                        <label key={d.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set([formDeliverableId, ...formLinkedDeliverableIds]);
                              if (e.target.checked) next.add(d.id);
                              else if (d.id !== formDeliverableId) next.delete(d.id);
                              onLinkedDeliverableIds([...next]);
                            }}
                          />
                          <span>{d.name}</span>
                          {d.id === formDeliverableId ? (
                            <span className="text-xs text-slate-500 dark:text-slate-400">(primary)</span>
                          ) : null}
                        </label>
                      );
                    })
                  )}
                </div>
              </FormField>
            ) : null}
          </>
        ) : (
          <p className="rounded-md border border-violet-200/80 bg-violet-50/50 px-3 py-2 text-sm text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-100">
            Applies to all deliverables in this fragnet.
          </p>
        )}
        <FormField label="Activity code">
          <Input
            className="h-10"
            value={formActivityCode}
            onChange={(e) => onActivityCode(e.target.value)}
            placeholder={copy.codePlaceholder}
            required
            readOnly={lockActivityCode}
            disabled={lockActivityCode}
            aria-invalid={activityCodeAvailable === false}
          />
          {!lockActivityCode ? (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {nextAvailableLoading ? (
                "Loading next available ID…"
              ) : nextAvailableActivityId ? (
                <>
                  Next available activity ID is{" "}
                  <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                    {nextAvailableActivityId}
                  </span>
                  {onUseSuggestedCode ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
                        onClick={() => onUseSuggestedCode(nextAvailableActivityId)}
                      >
                        Use {nextAvailableActivityId}
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                "Select a project and fragnet to see the next ID"
              )}
            </p>
          ) : null}
          {!lockActivityCode && formActivityCode.trim() ? (
            <p
              className={
                activityCodeChecking
                  ? "text-xs text-slate-500"
                  : activityCodeAvailable === true
                    ? "text-xs text-emerald-700 dark:text-emerald-400"
                    : activityCodeAvailable === false
                      ? "text-xs text-red-700 dark:text-red-400"
                      : "text-xs text-slate-500"
              }
            >
              {activityCodeChecking ? "Checking availability…" : activityCodeHint ?? ""}
            </p>
          ) : null}
          {!activityCodeChecking &&
          activityCodeAvailable === false &&
          onUseSuggestedCode &&
          suggestedActivityCode ? (
            <button
              type="button"
              className="text-xs font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
              onClick={() => onUseSuggestedCode(suggestedActivityCode)}
            >
              Use {suggestedActivityCode}
            </button>
          ) : null}
        </FormField>
        <FormField label="Name">
          <Input
            className="h-10"
            value={formName}
            onChange={(e) => onName(e.target.value)}
            placeholder="Activity name"
            required
          />
        </FormField>
      </FormSection>

      <FormSection title="Durations" description="Duration values are in days.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Best duration">
            <Input
              className="h-10"
              type="number"
              min={1}
              value={formBestDuration}
              onChange={(e) => onBestDuration(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Likely duration">
            <Input
              className="h-10"
              type="number"
              min={1}
              value={formLikelyDuration}
              onChange={(e) => onLikelyDuration(e.target.value)}
              required
            />
          </FormField>
        </div>
      </FormSection>

      {mayEditP6Codes && codeTypes.length > 0 ? (
        <FormSection title="Activity codes (P6)" description="One value per type when exporting to Primavera.">
          <div className="space-y-4">
            {codeTypes.map((t) => (
              <FormField key={t.id} label={t.name}>
                <select
                  value={formP6Codes[t.id] ?? "__NONE__"}
                  onChange={(e) => onP6Code(t.id, e.target.value)}
                  className={fieldClass}
                  disabled={submitting}
                >
                  <option value="__NONE__">— None —</option>
                  {(t.codes ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortName || c.name}
                    </option>
                  ))}
                </select>
              </FormField>
            ))}
          </div>
        </FormSection>
      ) : null}

      {scope === "deliverable" && assuranceNotes.length > 0 && onAssuranceNoteId ? (
        <FormSection title="Assurance">
          <FormField label="Assurance note">
            <select
              value={formAssuranceNoteId}
              onChange={(e) => onAssuranceNoteId(e.target.value)}
              className={fieldClass}
            >
              <option value="">None</option>
              {assuranceNotes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.noteText.slice(0, 80)}
                  {n.noteText.length > 80 ? "…" : ""}
                </option>
              ))}
            </select>
          </FormField>
        </FormSection>
      ) : null}

      <FormSection title="Resources">
        <ResourceAssignmentsEditor
          entries={rateCardEntries}
          value={formResourceDrafts}
          onChange={onResourceDrafts}
          disabled={submitting}
          durationDays={Math.max(0.01, Number(formBestDuration) || 1)}
        />
      </FormSection>

      {extraSections}
    </div>
  );
}

/** @deprecated Use ActivityDefinitionForm with scope="deliverable" */
export function DeliverableActivityForm(
  props: Omit<ActivityDefinitionFormProps, "scope"> & {
    showDeliverable?: boolean;
  }
) {
  const { showDeliverable = true, ...rest } = props;
  if (!showDeliverable) {
    return <ActivityDefinitionForm scope="deliverable" {...rest} onDeliverableId={undefined} />;
  }
  return <ActivityDefinitionForm scope="deliverable" {...rest} />;
}
