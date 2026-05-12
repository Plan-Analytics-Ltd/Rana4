let approvalToken: string | null = null;

export function setInMemoryApprovalToken(token: string | null): void {
  const trimmed = token?.trim();
  approvalToken = trimmed ? trimmed : null;
}

export function getInMemoryApprovalToken(): string | null {
  return approvalToken;
}

export function clearInMemoryApprovalToken(): void {
  approvalToken = null;
}
