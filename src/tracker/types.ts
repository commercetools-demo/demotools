// Shared types for the demo-tracker integration.

export type TrackProps = Record<string, unknown>;

/**
 * The `window.dt.context` shape. `store`/`channel` become the report filter
 * dimensions; `customer` is set only when a real customer is signed in. Keep
 * `store` and `channel` as two independent fields — never concatenate them.
 * The index signature allows demo-specific extra dimensions (e.g. b2b passes
 * `businessUnit`) — the tracker records whatever context keys it's given.
 */
export interface TrackerContext {
  store?: unknown;
  channel?: unknown;
  customer?: { id?: unknown; email?: unknown };
  [key: string]: unknown;
}

/**
 * The `window.dt` global. Two stages: `<TrackerScripts>` writes an inline
 * `{ context, gate }` during parse, and `t.js` later adds `track`.
 *
 * `track` is therefore OPTIONAL — declaring it required is what let
 * `dt?.track(...)` typecheck against a stage-1 `window.dt` and silently throw
 * at runtime. Keep it optional so the compiler forces a `typeof` guard.
 */
export interface Dt {
  track?: (type: string, props?: TrackProps) => void;
  context?: TrackerContext;
}
