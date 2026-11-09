/**
 * The "the server is updating" predicate, at an import path of its own.
 *
 * WHY A SEPARATE MODULE FOR ONE RE-EXPORT. The predicate lives beside
 * `DesktopControlError` in `desktop-api.ts`, because `userFacingMessage` there
 * reads it. The canonical sessions store needs it too, but the store's desktop
 * suites replace `@shared/api/local-operator/desktop-api` wholesale with a
 * fixture that re-exports a fixed list of names (the transport is what they
 * stub). Importing through this path resolves `./desktop-api` to the real
 * file - the same module instance those fixtures re-export from, so the
 * `instanceof` checks inside still see one class - without widening every
 * fixture's export list for a pure function.
 */
export { isServerUpdatingError } from "./desktop-api";
