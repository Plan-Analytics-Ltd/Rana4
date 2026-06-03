import { recalculateProjectSchedule } from "./scheduling/scheduler.service.js";

export async function recalculateProjectScheduleAfterMutation(
  projectId: string,
  companyId: string
): Promise<void> {
  try {
    await recalculateProjectSchedule({
      projectId,
      companyId,
      scenario: "best",
      persist: true,
    });
  } catch (error) {
    console.error("recalculateProjectScheduleAfterMutation", { projectId, error });
  }
}
