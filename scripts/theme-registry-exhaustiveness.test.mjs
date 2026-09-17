/*
 * The registry's other direction, executable.
 *
 *     node --test scripts/theme-registry-exhaustiveness.test.mjs
 *
 * WHY THIS FILE EXISTS. `themes` (`shared/themes/index.ts`) is built by mapping
 * the `definitions` array and the result is cast to `ThemeCollection`
 * (`Record<ThemeName, ThemeOption>`), because `Object.fromEntries` is typed with
 * a `string` index signature. The cast is a claim the compiler checks in ONE
 * direction only: `ThemeDefinition.id` is `ThemeName`, so a palette that is not
 * a union member is a type error, but a UNION MEMBER WITH NO PALETTE is not —
 * the cast says the key is there, `themes[name]` is `undefined`, no tile renders
 * for it and `getTheme` falls back to the default silently. That gap is round
 * 2's M-9, recorded then as "the cheap close is not available"; what makes it
 * cheap is that the two halves live in different worlds — the union only as
 * source text, the registry only at runtime — so one file can read both.
 *
 * WHAT IT PINS: the `ThemeName` union's members, in the order that file writes
 * them, are exactly `Object.keys(themes)` of the SHIPPED registry. Order is part
 * of the claim rather than decoration: the union's own docblock says its members
 * are written in the registry's presentation order so the two lists can be
 * diffed by eye, and the picker renders the registry in that order.
 *
 * WHAT IT CANNOT PROVE: that a palette's own values are right. That is what
 * `pnpm check-themes` (the generated stylesheet is fresh) and the contrast
 * contract are for, and both read the palette directory rather than this union.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const UNION = "src/renderer/src/shared/types/theme.ts";

/*
 * The registry is EVALUATED rather than parsed: it is TypeScript assembled out
 * of the palette modules, and `scripts/theme-grid-navigation.test.mjs` bundles
 * it the same way. So the object compared here is the one the renderer gets,
 * not a reading of the file that builds it.
 */
const bundle = await build({
	stdin: {
		contents: `export { themes } from "./src/renderer/src/shared/themes";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { themes } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * The `ThemeName` union's members, in the order the file writes them.
 *
 * The return type's own comments carry no quoted string, so this reads the
 * members themselves rather than their documentation.
 */
const unionMembers = () => {
	const source = readFileSync(join(ROOT, UNION), "utf8");
	const block = source.match(/export type ThemeName =([\s\S]*?);/);
	assert.ok(
		block,
		`${UNION} must still declare \`ThemeName\` as a union of string literals`,
	);
	return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};

test("the ThemeName union is exactly the registry's keys, in the same order", () => {
	assert.deepEqual(
		unionMembers(),
		Object.keys(themes),
		"a union member with no palette renders no tile and makes `getTheme` fall back silently",
	);
});
