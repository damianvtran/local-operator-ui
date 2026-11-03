/**
 * What counts as a real `backdrop-filter` layer, in ONE place.
 *
 * The glass scale holds the renderer to a ceiling of one blur layer (the isolating
 * band's; docs/branding.md, Glass scale). Two checks count it - the stylesheet scan
 * in `contrast-contract.mjs` and the built-renderer scan in
 * `window-glass-cdp.test.mjs` - and they must agree on what a layer IS.
 *
 * A DECLARATION IS A LAYER ONLY IF ITS VALUE DOES SOMETHING. Tailwind ships inert
 * shells in every build, `.backdrop-blur` and `.backdrop-filter`, whose value is
 * only `var(--tw-backdrop-*)` placeholders (each defaults to empty) - they paint
 * nothing and are present on the base commit too. Counting them made the ceiling
 * fail on every real build. `none` and an empty value are not layers either.
 */

/* Tailwind v4 writes the placeholders with an empty fallback: `var(--tw-backdrop-blur,)`. */
const PLACEHOLDER = /var\(\s*--tw-backdrop-[a-z-]+\s*(?:,\s*)?\)/g;

/** True when a `backdrop-filter` value would actually filter the backdrop. */
export function isRealBackdropFilter(value) {
	const v = String(value ?? "").trim();
	if (v === "" || v.toLowerCase() === "none") return false;
	return v.replace(PLACEHOLDER, "").trim() !== "";
}

/** The real `backdrop-filter` declarations in CSS source (comments stripped by the caller). */
export function realBackdropDeclarations(css) {
	/* `(?<![-\w])` keeps `-webkit-backdrop-filter` (the same layer, prefixed) from counting twice. */
	return [...css.matchAll(/(?<![-\w])backdrop-filter\s*:\s*([^;}]*)/g)]
		.map((m) => m[1].trim())
		.filter(isRealBackdropFilter);
}
