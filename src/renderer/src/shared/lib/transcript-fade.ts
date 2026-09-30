/**
 * The transcript's top-fade depth, in px, as ONE named value.
 *
 * `styles/index.css` owns the mask — the scroll-linked ramp's endpoints, its
 * `animation-range`, and the no-timeline fallback all carry this depth — and
 * CSS cannot import TS, so the coupling is kept honest by a suite pin
 * (`scripts/transcript-fade.test.mjs` reads the stylesheet and fails if any of
 * the three stops stops matching this constant).
 *
 * WHY IT IS SHARED CODE AND NOT A STYLE DETAIL (issue #680, design round 1's
 * D1): a jump that anchors a row at 0px lands it entirely inside this ramp —
 * measured peak ink 189 against 238 unmasked — so the landing's inset and the
 * rail's reading line must both clear the fade. They derive it from here, and
 * a future edit to the fade that forgets them fails the pin instead of
 * silently dimming every jump's target again.
 */
export const TRANSCRIPT_TOP_FADE_PX = 24;
