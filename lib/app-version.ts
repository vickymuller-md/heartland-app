/**
 * Single source for the user-facing app version. A unit test asserts this
 * matches package.json so a release bump can never miss the public footers
 * again (v1.3.0 shipped with "v1.2.0" hardcoded in three places).
 */
export const APP_VERSION = 'v1.10.0';

/** Last verified archive; a deployment version can advance before its DOI is published. */
export const APP_ARCHIVE_VERSION = 'v1.10.0';
export const APP_ARCHIVE_DOI = '10.5281/zenodo.23074656';
