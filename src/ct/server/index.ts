// @cboyke/demotools/ct/server — server-only commercetools resilience helpers.
// Keep out of 'use client' files (these read server env / do server fetches).

export { getSessionSecret } from './session-secret.js';

export {
  isProjectExpiredError,
  isProjectExpired,
  markProjectExpiredFromError,
  checkProjectActive,
} from './project-status.js';

export {
  isProductSearchDisabledError,
  createProductSearchStatus,
  type ProductSearchStatus,
} from './product-search.js';
