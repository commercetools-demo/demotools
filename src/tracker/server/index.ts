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
  gateVerdict,
  type GateVerdict,
  type GateVerdictInput,
  editorPreviewVerdict,
  gateRedirectPath,
  DEFAULT_PREVIEW_PARAM,
  type EditorPreviewOptions,
  type EditorPreviewVerdict,
  type HeaderReader,
  siteIsOpen,
  GATE_COOKIE,
  TRACKER_COOKIE,
  TRACKER_BASE_PATH,
  trackerSite,
  gateSlug,
  trackerOrigin,
  isGateEnabled,
} from './gate.js';
