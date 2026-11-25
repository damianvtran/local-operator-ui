/**
 * The column every first-run step lays out in: 480px, with the stage's own 32px
 * side padding taking over in a narrower window.
 *
 * ONE measure for the whole flow, so no step can widen it and make the header
 * or the progress track jump mid-flow (design round 1 D6, carried into the
 * stage). Its own module, with no imports, because it is a rule CI checks
 * (`scripts/provider-grid-pin.test.mjs`) without bundling the stage, the helix
 * and the brand mark's image to read one string.
 */
export const ONBOARDING_COLUMN_WIDTH = "w-[min(30rem,100%)]";
