# Secure Data Migration Notes

## Runtime Architecture

- Runtime rate-card access now goes through `src/repositories/secureData`.
- The only runtime tables for rate-card and resource-registry data are `private_data.rate_card_secure` and `private_data.resource_registry_secure`.
- Sensitive security events are appended to `private_data.audit_log`; application history remains in the existing `audit_logs` table.
- Sensitive decrypts require rows in `private_data.access_approval_requests` and a scoped temporary approval token before payload decrypt.
- Secure table queries fetch only metadata plus `payload_enc`; JSON parsing and business interpretation happen after repository-mediated decryption.
- Repository list queries require `company_id` filters, support optional `resource_type` filters, and apply `LIMIT`, `OFFSET`, and `ORDER BY created_at` before decrypting rows.
- Rate-card rows are partitioned by metadata `resource_type`, using ids shaped like `company:{companyId}:rate-card:{base64url(resourceType)}`.
- `DB_ENCRYPTION_KEY` is read only inside `src/services/encryption` and is never returned to clients.

## Cleanup Recommendations

- Treat historical Prisma migrations that mention `rate_card_entries` or `resource_registry` as migration history only.
- Retire legacy SQL scripts that update `rate_card_entries`; they are not compatible with the encrypted vault model.
- Remove deployed database objects for `rate_card_entries`, `resource_registry`, `resource_summary`, and `company_resource_sequences` only after encrypted payload backfill and rollback planning are complete.
- Review database role grants so application roles can insert and select bounded audit slices but cannot update, delete, or truncate `private_data.audit_log`.

## Migration Notes

- For the metadata-aware shape, backfill one `rate_card_secure` row per company and rate-card resource type with `company_id`, `resource_type`, `created_at`, and encrypted payload fields set.
- Backfill one `resource_registry_secure` row per company and prefix using `company:{companyId}:resource-registry:{prefix}` with `resource_type` set to the prefix.
- Payloads should use `version: 1` and include all business fields needed by the backend because PostgreSQL no longer exposes readable columns.
- Backfill metadata columns before enabling the new repositories; rows with missing `company_id` will not be returned by metadata-filtered secure queries.

## Approval Workflow

- Approval requests are created in `pending` state and scoped by user, company, action, resource category, resource id, and resource type.
- Approved requests issue a temporary token returned once by the admin approval API; clients must send it as `X-Approval-Token`.
- Approval tokens are hashed at rest, expire automatically, and enforce `maxDecryptCount` plus `maxBatchSize`.
- Invalid, expired, revoked, or over-used tokens deny decrypts and emit immutable audit/abuse events.
- Notification providers are scaffolded for email, Slack, Discord, and webhook integrations through `src/services/approvals/notificationProviders.ts`.

## Future Hardening

- Replace the stub audit sink in `src/services/audit/secureAudit.service.ts` with an append-only audit table or external security log.
- Add approval state to `requireSensitiveAccess` before allowing high-risk decrypt actions.
- Move pgcrypto decrypt/encrypt behind a backend-native crypto implementation when key management and rotation are ready.
- Add key rotation metadata to encrypted payloads before introducing multiple active keys.
- Integrate KMS-backed key wrapping and rotation workflows.
- Evaluate partial searchable encryption only for explicitly approved metadata fields.
- Make secure audit/query metrics immutable and alert on unusually high decrypt counts.

## Audit Retention And Archival

- Keep hot audit data in PostgreSQL for operational search for 90-180 days, depending on compliance requirements.
- Export immutable audit rows to cold storage daily with checksum manifests and separate access controls.
- Mirror critical security events to a SIEM for alerting on denied-access bursts, high decrypt counts, and abnormal query frequency.
- Store hash-chain verification reports outside the primary database so tampering can be detected even if the database is compromised.
- Plan KMS-backed signing for future `hash` and `previous_hash` fields so audit integrity does not depend only on database trust.
- Add MFA or hardware-backed developer approvals for high-risk decrypt scopes.
- Add quorum approvals for broad company-level decrypt requests.
- Add tenant-isolated approval domains and signed approval attestations.
