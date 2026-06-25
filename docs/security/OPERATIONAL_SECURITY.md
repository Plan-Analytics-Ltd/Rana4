# Operational Security Checklist

## Secrets

- Keep `.env` out of git and inject production secrets through the deployment platform or container secret store.
- Never echo `DB_ENCRYPTION_KEY`, `JWT_SECRET`, `APPROVAL_SIGNING_SECRET`, or `AUDIT_SIGNING_SECRET` in CI logs.
- Use separate secrets per environment and per deployment target.
- Rotate secrets with a staged plan: add new secret, deploy readers, re-encrypt or re-sign if needed, then remove the old secret.
- Scope Neon credentials by role: runtime users should have only required schema/table privileges, not owner privileges.

## Approval Tokens

- Approval tokens are returned once from the approval API and stored only in frontend memory.
- Do not put approval tokens in localStorage, sessionStorage, IndexedDB, URLs, query strings, logs, screenshots, or support tickets.
- Send approval tokens only as `X-Approval-Token`.
- Treat token reuse, expired-token reuse, and approval bypass attempts as security events.

## Logging

- All server console output passes through `sanitizeForLogging`.
- Logs redact authorization headers, cookies, approval tokens, encryption keys, decrypted payloads, and encrypted blobs.
- Client-facing errors should remain generic. Use immutable audit logs for security investigation details.

## CI/CD

- Add secret scanning to pull requests and block `.env` commits.
- Disable shell tracing around deployment commands that read secrets.
- Separate build-time public variables from runtime secrets.
- Restrict production deploy permissions and use protected environments for release approvals.

## Infrastructure

- Enforce HTTPS at the edge and keep `ENFORCE_HTTPS=true` in production.
- Use least-privilege database roles for runtime access.
- Prefer container/platform secret injection over baked images or repository files.
- Plan KMS migration for envelope encryption, audit signing, and key rotation.
- Export immutable audit logs to cold storage and SIEM with checksum manifests.

## Startup Checks

- Startup validates required secrets, weak secrets, reused secrets, production CORS, and database SSL safety.
- Optional self-tests run with `SECURITY_SELF_TESTS=true`.
- Startup must fail closed. Do not bypass failed security validation during production deploys.
