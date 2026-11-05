/**
 * The CSS block a palette becomes: one emitter for the build AND the renderer.
 *
 * WHY ONE FUNCTION. `scripts/generate-theme-css.mjs` writes one
 * `[data-theme="<id>"]` block per built-in palette into the committed
 * `themes.generated.css`; the theme composition engine writes the same kind of
 * block into a runtime `<style>` for a palette composed at a contrast preset or
 * with a custom accent. If the two emitted different text - another property
 * order, a missing `color-scheme`, a different kebab rule - a composed theme would
 * render roles the static CSS never names, and the drift would show up only on
 * the composed path. The generator imports this, so `pnpm gen-themes --check`
 * against the unchanged committed file is the proof that both paths agree.
 *
 * CONSTRAINT: the values are written verbatim. That is safe for the built-ins
 * (source-controlled) and for composed palettes (every value the engine writes
 * is a 6-digit hex it produced, plus the built-in's own `overlayShadow`/`scrim`).
 * A caller emitting a palette that came from OUTSIDE - an imported custom theme -
 * must validate it first with `isSafePaletteValue`, or a value like
 * `red; } body { display: none` becomes a stylesheet rule.
 */

/** camelCase role -> kebab-case custom property suffix. */
export const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The `[data-theme="<id>"]` block for one palette, byte-for-byte what the
 * generator commits.
 */
export const paletteBlock = (id, palette) => {
	const lines = Object.entries(palette)
		.filter(([role]) => role !== "mode")
		.map(([role, value]) => `\t--lo-${kebab(role)}: ${value};`)
		.join("\n");
	/* `color-scheme` makes the platform paint native scrollbars, form controls
	   and the caret to match the palette. Without it a dark theme keeps a white
	   scrollbar track, which is the single most visible "unthemed" artefact in
	   an Electron app. */
	return `[data-theme="${id}"] {\n\tcolor-scheme: ${palette.mode};\n${lines}\n}`;
};

/* The two grammars a palette value may take: a flat hex, or the `rgb(r g b / a)`
   (optionally preceded by a box-shadow offset list) the built-ins use for
   `overlayShadow` and `scrim`. Nothing else can contain a `;`, `}` or quote. */
const HEX_VALUE = /^#[0-9A-Fa-f]{6}$/;
const RGB_VALUE =
	/^(?:-?\d+(?:px)? ){0,4}rgb\(\d{1,3} \d{1,3} \d{1,3} \/ (?:0|1|0?\.\d+)\)$/;
/** An id the overlay sanitiser accepts too (`/^[A-Za-z0-9_-]{1,40}$/`). */
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** True when `value` is one of the two grammars above. */
export const isSafePaletteValue = (value) =>
	typeof value === "string" && (HEX_VALUE.test(value) || RGB_VALUE.test(value));

/** True when `id` can be written inside `[data-theme="..."]` unescaped. */
export const isSafeThemeId = (id) => typeof id === "string" && SAFE_ID.test(id);
