/**
 * THE SIDEBAR'S ONE INLINE INSET (operator report, 2026-11-04).
 *
 * Every horizontal band of a sidebar column - the Back row, the organization
 * header, the quick rows, each section, the owner-audit list and the account
 * foot - pads its CONTENT BOX by this, and every control inside pads itself by
 * the same `px-2` again. So a leading mark starts at 16px from the column's
 * start edge, and the LAST trailing mark of any row (a mute bell, an unread or
 * attention badge, a section's "+" or "...", the organization "+", the hover
 * "...", the settings gear) ends 16px from its end edge: one line on each side.
 *
 * WHY A SHARED CONSTANT RATHER THAN A REPEATED `px-2`. The operator saw the
 * Channels header and its rows 4px left of Back/Drafts (sections padded `px-1`,
 * the nav `px-3`) and a mute bell touching the column's end edge. Both were the
 * same drift: each band chose its own inset, and nothing tied them together.
 * `scripts/team-bridge-sidebar-inset.test.mjs` pins every band to this value.
 *
 * Logical (`px` is symmetric), so the Urdu column mirrors with no second rule.
 * The scroll area's thumb is an overlay (Radix, `w-2.5`), so it takes none of
 * this inset and a scrollbar appearing never shifts a row; the 16px keeps the
 * trailing column 6px clear of the thumb.
 */
export const SIDEBAR_INSET = "px-2";
