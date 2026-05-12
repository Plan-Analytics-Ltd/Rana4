export type ApprovalNotificationEvent =
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "approval_expired"
  | "approval_revoked";

export type ApprovalNotification = {
  event: ApprovalNotificationEvent;
  approvalRequestId: string;
  companyId: string;
  requestingUserId: string;
  resourceCategory: string;
  resourceType?: string | null;
  requestedAction: string;
};

export type ApprovalNotificationProvider = {
  name: "email" | "slack" | "discord" | "webhook" | string;
  notify(event: ApprovalNotification): Promise<void>;
};

const providers: ApprovalNotificationProvider[] = [];

export function registerApprovalNotificationProvider(provider: ApprovalNotificationProvider): void {
  providers.push(provider);
}

export async function notifyApprovalProviders(event: ApprovalNotification): Promise<void> {
  await Promise.allSettled(providers.map((provider) => provider.notify(event)));
}
