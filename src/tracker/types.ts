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

/** The `window.dt` global installed by the tracker script (`t.js`). */
export interface Dt {
  track: (type: string, props?: TrackProps) => void;
  context?: TrackerContext;
}
