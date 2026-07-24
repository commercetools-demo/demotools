// @cboyke/demotools/ct — shared commercetools "resilience" pieces: the
// trial-expired + Product-Search-disabled banners (client-renderable) and, from
// the /ct/server subpath, the detection probes + getSessionSecret. These encode
// hard-won graceful-degradation fixes so they're maintained once for every demo.

export { default as ProjectExpiredBanner } from './ProjectExpiredBanner.js';
export { default as ProductSearchDisabledBanner } from './ProductSearchDisabledBanner.js';

export {
  isCommercetoolsHostedImage,
  appendRenditionSuffix,
  type RenditionSize,
} from './image-config.js';
