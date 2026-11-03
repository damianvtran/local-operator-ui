/**
 * What counts as a real `backdrop-filter` layer, in ONE place.
 *
 * The glass scale holds the renderer to a ceiling of one blur layer (the isolating
 * band's; docs/branding.md, Glass scale). Two checks count it - the stylesheet scan
 * in `contrast-contract.mjs` and the built-renderer scan in
 * `window-glass-cdp.test.mjs` - and they must agree on what a layer IS.
 *
 * A RULE IS A LAYER ONLY IF ITS `backdrop-filter` WOULD DO SOMETHING, and that is a
 * property of the RULE, not of the declaration's value alone. Tailwind writes every
 * backdrop utility's `backdrop-filter` as the same run of `var(--tw-backdrop-*,)`
 * placeholders and puts the effect in a SIBLING custom property of the same rule:
 *
 *   .backdrop-blur-md { --tw-backdrop-blur: blur(var(--blur-md)); backdrop-filter: <placeholders> }
 *   .backdrop-filter  {                                            backdrop-filter: <placeholders> }
 *
 * The first is a real blur on any element that carries the class; the second is the
 * bare shell that paints nothing (every placeholder defaults to empty). A utility class
 * is present in the build only when source names it, so a value-only judgement would
 * leave the ceiling blind to exactly the route a contributor would take. `none` and
 * an empty value are not layers either.
 */

/* Tailwind v4 writes the placeholders with an empty fallback: `var(--tw-backdrop-blur,)`. */
const PLACEHOLDER = /var\(\s*--tw-backdrop-[a-z-]+\s*(?:,\s*)?\)/g;

/* A non-empty value set on any `--tw-backdrop-<function>` property of the rule. */
const TW_BACKDROP_SET =
	/--tw-backdrop-(?:blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)\s*:\s*([^;}]*)/gi;

/** True when the rule's own declarations set a Tailwind backdrop function to something. */
export function setsTailwindBackdropValue(ruleBody) {
	for (const m of String(ruleBody ?? "").matchAll(TW_BACKDROP_SET))
		if (m[1].trim() !== "") return true;
	return false;
}

/**
 * True when a `backdrop-filter` value would actually filter the backdrop.
 * `ruleBody` is the declaration text of the rule the value sits in (CSS source or a
 * CSSOM `style.cssText`); it is what makes a placeholders-only value real.
 */
export function isRealBackdropFilter(value, ruleBody = "") {
	const v = String(value ?? "").trim();
	if (v === "" || v.toLowerCase() === "none") return false;
	if (v.replace(PLACEHOLDER, "").trim() !== "") return true;
	return setsTailwindBackdropValue(ruleBody);
}

/**
 * The own-declaration text of every block in CSS source (comments stripped by the
 * caller). Nested blocks (`@supports`, `@media`, CSS nesting) are separate entries and
 * their text is not repeated in the parent's. A block's prelude (a selector, or the
 * condition of `@supports (backdrop-filter: blur(1px))`) is not a declaration, so it is
 * dropped from the parent: a feature test must not read as a layer.
 */
function ruleBodies(css) {
	const bodies = [""];
	const stack = [0];
	for (const ch of css) {
		const top = stack[stack.length - 1];
		if (ch === "{") {
			bodies[top] = bodies[top].slice(0, bodies[top].lastIndexOf(";") + 1);
			bodies.push("");
			stack.push(bodies.length - 1);
		} else if (ch === "}") {
			if (stack.length > 1) stack.pop();
			/* Text after a closed child up to the next `;` is that child's, not a declaration. */
			const parent = stack[stack.length - 1];
			bodies[parent] = bodies[parent].slice(
				0,
				bodies[parent].lastIndexOf(";") + 1,
			);
		} else bodies[top] += ch;
	}
	return bodies;
}

/**
 * The real `backdrop-filter` layers in CSS source: one entry (the value) per RULE that
 * has one, so a rule that writes `-webkit-backdrop-filter` beside `backdrop-filter` is
 * one layer, not two, and a prefixed-only rule is still counted - the CDP check walks
 * the CSSOM, where either spelling is a layer.
 */
export function realBackdropDeclarations(css) {
	const layers = [];
	for (const body of ruleBodies(css)) {
		for (const m of body.matchAll(
			/(?<![-\w])(?:-webkit-)?backdrop-filter\s*:\s*([^;]*)/gi,
		)) {
			if (isRealBackdropFilter(m[1], body)) {
				layers.push(m[1].trim());
				break;
			}
		}
	}
	return layers;
}
