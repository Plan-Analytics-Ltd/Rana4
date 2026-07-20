/** Hidden developer tooling (activity templates, materialize, identity debug export, etc.). */
export const showActivityDevTools = process.env.NEXT_PUBLIC_SHOW_ACTIVITY_DEV_TOOLS === "true";

/** Alias — same flag gates Engineering Brain debug export UI. */
export const showIdentityDebugExport = showActivityDevTools;
