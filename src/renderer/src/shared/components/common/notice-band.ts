/**
 * The notice band's one grammar (the chat pane's status strip + the backend
 * compatibility banner).
 *
 * WHY THIS STRING LIVES IN ONE MODULE RATHER THAN IN EACH CALLER. The two
 * surfaces used to carry two shapes for one family: the strip an inset rounded
 * wash-only band, the banner a full-bleed squared band with a bottom rule, so
 * stacked they read as two systems - and the operator's report is exactly that
 * stack (a red strip and an amber banner over one incident). The severity must
 * be carried by hue, glyph and copy ONLY, never by a different geometry; this
 * constant is the geometry half of that ruling, and having it in one place is
 * what keeps the two call sites from drifting apart again.
 *
 * The Alert base supplies the severity fill/border/mark/ink from its variant;
 * this string makes both call sites the same compact band: centred single row,
 * 12/8 padding, 8px gaps, and the mark at the 14px ramp step that pairs with
 * `text-body-sm`. The mark size is a descendant-arbitrary override because the
 * Alert draws its glyph inside its own `data-alert-mark` slot (whose own rule
 * is `[&_svg]:size-4`): the root class carries the higher specificity, so the
 * 14px step wins - confirmed in the rendered frame, not in this comment.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: the wrapper around the band. The pane's
 * 24px gutter and 4px rhythm (`shrink-0 px-6 py-1`) belong to the call site's
 * own column, and the banner keeps it too - it is the one class pair both
 * surfaces share by convention, and it is asserted where the bands' edges are
 * (see `scripts/contrast-contract.mjs`'s status band rows).
 */
export const NOTICE_BAND =
	"items-center gap-2 px-3 py-2 [&_[data-alert-mark]_svg]:size-3.5";
