## Project permissions (frozen roles)

### Roles (do not add new roles lightly)
- **ADMIN**: full access, delete resources, manage members
- **EDITOR**: create + update, cannot delete or manage members
- **VIEWER**: read-only

### Single source of truth
- Backend: `src/permissions/projectPermissions.ts`
- Frontend mirror (UX-only): `frontend/lib/project-permissions.ts`

All checks must go through **`hasPermission(role, entity, action)`** (or `requirePermission(...)` on backend).

### Permission matrix

#### `activity`
- **read**: VIEWER, EDITOR, ADMIN
- **create**: EDITOR, ADMIN
- **update**: EDITOR, ADMIN
- **delete**: ADMIN

#### `relationship`
- **read**: VIEWER, EDITOR, ADMIN
- **create**: EDITOR, ADMIN
- **update**: EDITOR, ADMIN
- **delete**: ADMIN

#### `deliverable`
- **read**: VIEWER, EDITOR, ADMIN
- **create**: EDITOR, ADMIN
- **update**: EDITOR, ADMIN
- **delete**: ADMIN

#### `standard`
- **read**: VIEWER, EDITOR, ADMIN
- **create**: EDITOR, ADMIN
- **update**: EDITOR, ADMIN
- **delete**: ADMIN

#### `fragnet`
- **read**: VIEWER, EDITOR, ADMIN
- **create**: EDITOR, ADMIN
- **update**: EDITOR, ADMIN
- **delete**: ADMIN

#### `assuranceNote`
- **read**: VIEWER, EDITOR, ADMIN
- **create**: EDITOR, ADMIN
- **update**: EDITOR, ADMIN
- **delete**: ADMIN

#### `auditLog`
- **read**: VIEWER, EDITOR, ADMIN

#### `rateCard`
- **read**: VIEWER, EDITOR, ADMIN
- **update**: ADMIN
- **delete**: ADMIN

#### `invitation`
- **create**: ADMIN

#### `projectMember`
- **create**: ADMIN
- **update**: ADMIN
- **delete**: ADMIN

