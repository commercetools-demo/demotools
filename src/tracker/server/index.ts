// @cboyke/demotools/tracker/server — server-only route factories + gate helpers
// for the demo-tracker integration. Keep this OUT of 'use client' files.

export {
  createTrackerProxyRoute,
  createGateRoute,
  type TrackerProxyOptions,
  type GateRouteOptions,
} from './routes.js';

export {
  isGateOpen,
  siteIsOpen,
  GATE_COOKIE,
  TRACKER_COOKIE,
  TRACKER_BASE_PATH,
  trackerSite,
  gateSlug,
  trackerOrigin,
  isGateEnabled,
} from './gate.js';
