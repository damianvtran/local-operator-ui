import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE COMMAND REGISTRY IS ONE DOCUMENT PER LANGUAGE (i18n programme, C5).
 *
 * `commands.list` does not hand the renderer copy it can translate: each row's
 * description is rendered by the BACKEND in the language it resolved for the
 * request. One shared `desktopKeys.commands` therefore handed the French reader
 * the English rows cached before the switch - 46 backend-resolved descriptions
 * left English inside otherwise-French chrome for up to the five-minute
 * `staleTime`.
 *
 * The fix is the KEY, not an invalidation: an invalidation marks the same
 * document stale and re-renders the old data while the refetch is in flight,
 * which is exactly the frame this closes. A locale-scoped key makes the switch a
 * different query, so there is nothing stale to paint.
 *
 * What this test proves, and what it cannot:
 *  - it proves the key is locale-scoped, that BOTH readers use the ONE builder,
 *    that no reader still queries the bare key, and that the key follows the
 *    locale store at CALL time (no reimport, no captured module constant);
 *  - it does NOT prove the app renders a French popup after a live switch. That
 *    is the real-app check the reviewers run against a pushed head: switch to
 *    `fr`, type `/`, and read the descriptions.
 *
 * MUTATION CONTROL: point either reader back at `desktopKeys.commands` (or drop
 * the locale from `commandsFor`) and the corresponding assertion below fails -
 * that is the counterfactual this file exists to keep armed.
 */

const ROOT = process.cwd();

/* Hoisted for the lint rule the rest of `scripts/` follows: these are the same
 * two shapes everywhere below, and reading them once makes the counterfactual
 * wording easy to compare. */
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const STORY_FILE_RE = /\.stories\./;
/** The frame this whole file exists to refuse: a reader on the bare key. */
const BARE_COMMAND_KEY_RE = /queryKey:\s*desktopKeys\.commands\s*,/;

const bundle = await build({
	stdin: {
		contents: `
			export { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
			export { currentLocale, setLocale } from "@shared/i18n";
		`,
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react/jsx-runtime", "electron"],
});
assert.ok(bundle.outputFiles[0], "the commands-key bundle did not compile");
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const source = (path) => readFileSync(join(ROOT, path), "utf8");

/** Every renderer file that could spell the query key by hand. */
function rendererSources(dir = "src/renderer/src") {
	const out = [];
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...rendererSources(rel));
		else if (SOURCE_FILE_RE.test(entry.name) && !STORY_FILE_RE.test(entry.name))
			out.push(rel);
	}
	return out;
}

test("the commands key carries the locale, under the catalogue's own prefix", () => {
	const { desktopKeys } = mod;
	const en = desktopKeys.commandsFor("en");
	const fr = desktopKeys.commandsFor("fr");
	assert.deepEqual([...en], ["desktop", "commands", "en"]);
	assert.deepEqual([...fr], ["desktop", "commands", "fr"]);
	assert.notDeepEqual(en, fr, "two languages must not share one cache entry");
	// The prefix stays the invalidation handle: a caller that forgets the whole
	// registry must not have to know which languages were ever fetched.
	assert.deepEqual(en.slice(0, desktopKeys.commands.length), [
		...desktopKeys.commands,
	]);
});

test("the key follows the resolved locale at call time, with no reimport", () => {
	const { desktopKeys, currentLocale, setLocale } = mod;
	setLocale("en");
	const cold = desktopKeys.commandsFor(currentLocale());
	setLocale("fr");
	const after = desktopKeys.commandsFor(currentLocale());
	setLocale("en");
	const back = desktopKeys.commandsFor(currentLocale());
	assert.deepEqual([...cold], ["desktop", "commands", "en"]);
	assert.deepEqual(
		[...after],
		["desktop", "commands", "fr"],
		"a resolved locale switch must move the key, or the French reader is served the English document",
	);
	assert.deepEqual(
		[...back],
		[...cold],
		"switching back re-reads the English entry",
	);
});

test("both readers build the key from that one function", () => {
	for (const path of [
		"src/renderer/src/features/chat/components/slash-commands.tsx",
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
	]) {
		const text = source(path);
		assert.ok(
			text.includes("desktopKeys.commandsFor(locale)"),
			`${path} must query the locale-scoped key`,
		);
		assert.ok(
			!BARE_COMMAND_KEY_RE.test(text),
			`${path} must not query the bare registry key - that is the stale-English frame`,
		);
		assert.ok(
			text.includes("useI18nLocale()"),
			`${path} must take the locale from the store the app renders with, not a preference of its own`,
		);
	}
});

test("no other renderer file queries the bare commands key", () => {
	const offenders = rendererSources().filter((path) => {
		if (path.endsWith("api/local-operator/desktop-hooks.ts")) return false;
		return BARE_COMMAND_KEY_RE.test(source(path));
	});
	assert.deepEqual(
		offenders,
		[],
		"every reader shares the one locale-scoped key",
	);
});
