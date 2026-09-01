/**
 * Single source for the user-facing app version. A unit test asserts this
 * matches package.json so a release bump can never miss the public footers
 * again (v1.3.0 shipped with "v1.2.0" hardcoded in three places).
 */
export const APP_VERSION = 'v1.8.0';
