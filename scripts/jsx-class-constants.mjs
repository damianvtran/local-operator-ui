/**
 * Module-level class constants in a JSX source file, by name.
 *
 * Shared by `glass-overlay.test.mjs` and `floating-surface-no-border.test.mjs`: both
 * contracts have to see a panel whose classes were factored out of its tag, and two
 * readers of the same shape that could disagree is the drift a shared helper
 * prevents (the same reason `jsx-opening-tags.mjs` is shared).
 */

/** A class constant's opening: a class-combining call or a string literal. */
export const CLASS_STRING_VALUE = /^(cn|clsx|twMerge)\(|^["`]/;
/** A module-level `const NAME =` (top level, `export` allowed). No `g`: per-call copy. */
const CLASS_CONSTANT_DECLARATION =
	/(?:^|\n)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=/;

/**
 * MODULE-LEVEL CLASS CONSTANTS: the other half of the class derivation above.
 *
 * `const LARGE_PREVIEW = cn("invisible absolute ... bg-elevated shadow-overlay ...")`
 * reaches its element as `className={LARGE_PREVIEW}`, and `openingTags` reads class
 * text INSIDE an opening tag only - so a panel whose classes were factored out is
 * invisible to the tag-level scan no matter how exactly it matches the signature.
 * That is the wrong way round: factoring the string out is the tidier code and so the
 * likelier shape for the next overlay too. Round 2 of review named two panels missing
 * for this reason (`attachments-preview.tsx`, `inline-image-tile.tsx`); running this
 * resolver on the tree also surfaced a third nobody had named (`inline-edit.tsx`),
 * which is the evidence that the gap was structural rather than those two files.
 *
 * WHAT IT READS, and therefore what it cannot: a `const NAME = <value>` at column 0
 * (an `export` in front is fine) whose value starts with a `cn(`/`clsx(`/`twMerge(`
 * call or a string literal, ending at the first `;` outside brackets and strings. A
 * value that is an object or an inline-style map is NOT a class string and is not
 * read - which is what keeps `themed-toast-container.tsx`'s
 * `boxShadow: "var(--shadow-overlay)"` out of the class (toasts may legitimately be a
 * surface of their own; that is a naming decision, not this row's). Still out of
 * reach, and stated rather than implied: a constant declared inside a component, an
 * alias assigned through a ternary, a string concatenated at runtime, and a constant
 * imported from another module.
 *
 * `opening` widens what counts as a class value for a caller that needs it: the
 * no-border guard also reads `[...]` arrays and `cva(...)` calls, because the menu
 * primitives' `panelClasses` and the sheet's variants are written that way. The
 * glass-overlay derivation keeps the narrow default it was measured with.
 */
export const moduleLevelClassConstants = (
	source,
	{ opening = CLASS_STRING_VALUE } = {},
) => {
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const constants = new Map();
	/* A fresh lastIndex per call: the shared literal carries no `g` on purpose. */
	const declaration = new RegExp(CLASS_CONSTANT_DECLARATION, "g");
	let match = declaration.exec(stripped);
	while (match !== null) {
		const start = match.index + match[0].length;
		let depth = 0;
		let quote = null;
		let end = -1;
		for (let i = start; i < stripped.length; i++) {
			const ch = stripped[i];
			if (quote !== null) {
				if (ch === quote && stripped[i - 1] !== "\\") quote = null;
				continue;
			}
			if (ch === '"' || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "(" || ch === "{" || ch === "[") depth += 1;
			else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
			else if (ch === ";" && depth === 0) {
				end = i;
				break;
			}
		}
		if (end !== -1) {
			declaration.lastIndex = end;
			const value = stripped.slice(start, end).trim();
			if (opening.test(value)) constants.set(match[1], value);
		}
		match = declaration.exec(stripped);
	}
	return constants;
};
