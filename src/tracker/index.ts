// @cboyke/demotools/tracker — client + isomorphic surface for the demo-tracker
// analytics + password-gate integration. Import server-only route factories and
// gate helpers from `@cboyke/demotools/tracker/server`.

export { track, trackBeacon } from './track.js';
export { default as TrackEvent } from './TrackEvent.js';
export { default as DemoGate, type DemoGateProps } from './DemoGate.js';
export { default as TrackerScripts, type TrackerScriptsProps } from './TrackerScripts.js';

export {
  GATE_COOKIE,
  TRACKER_COOKIE,
  TRACKER_BASE_PATH,
  trackerSite,
  gateSlug,
  trackerOrigin,
  isGateEnabled,
} from './config.js';

export type { Dt, TrackProps, TrackerContext } from './types.js';
