# API documentation

The OpenAPI 3.0 specification is maintained in source code:

- `src/api/openapi.json` — specification document
- `src/api/openapi.ts` — loader used by the Express server

In development, Swagger UI is available at `/api-docs` when `NODE_ENV` is not `production`.

To update the API contract, edit `src/api/openapi.json` and restart the backend.
