/**
 * Every colour role a palette carries (`mode` excluded), and the sanitiser for a
 * palette that crosses a PROCESS boundary as data.
 *
 * WHY THIS EXISTS. A composed theme (contrast preset or custom accent) has no
 * block in the static `themes.generated.css`; the main window writes one into a
 * runtime `<style>`. The browser approvals card is a separate document whose CSP
 * is `style-src 'self'` - it cannot take an injected `<style>` - so the app sends
 * it the composed VALUES, and the card sets them as `--lo-*` custom properties
 * through CSSOM. That payload is renderer-produced data arriving in main and then
 * in another document, so it is held to two closed grammars: keys must be a role
 * named here, values must be one of the two CSS value grammars `css.mjs`
 * accepts. Anything else is dropped, and a payload missing any role is refused
 * whole (a half palette would paint the card in two themes).
 *
 * WHY A LIST RATHER THAN THE CONTRACT'S `REQUIRED_ROLES`. That table lives in a
 * 200 KB module the main process has no other reason to load, and it omits
 * `hairlineStrong`, which the palettes also carry. `scripts/theme-engine-picker
 * .test.mjs` pins this list to the union of every shipped palette's keys, so it
 * cannot drift silently.
 */

import { isSafePaletteValue } from "./css.mjs";

export const PALETTE_ROLES = Object.freeze([
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"messageSurface",
	"mediaSurface",
	"rowHover",
	"rowSelected",
	"ink",
	"inkMuted",
	"inkDim",
	"inkDisabled",
	"hairline",
	"hairlineStrong",
	"borderControl",
	"accent",
	"accentHover",
	"accentActive",
	"chartBarHover",
	"tokenCommand",
	"accentWash",
	"onAccent",
	"accentAlt",
	"accentAltWash",
	"success",
	"successWash",
	"successBorder",
	"warning",
	"warningWash",
	"warningBorder",
	"danger",
	"dangerWash",
	"dangerBorder",
	"info",
	"infoWash",
	"infoBorder",
	"overlayShadow",
	"scrim",
]);

/**
 * `{ role: value }` for every role, or null. Never partial: an unknown key is
 * dropped, an unsafe value or a missing role refuses the whole payload.
 */
export const sanitizePaletteVars = (value) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const out = {};
	for (const role of PALETTE_ROLES) {
		const v = value[role];
		if (!isSafePaletteValue(v)) return null;
		out[role] = v;
	}
	return out;
};
