/**
 * The locale's list separator, and the sidebar sentences that now use it.
 *
 *     node --test scripts/i18n-list-separator.test.mjs
 *
 * THE DEFECT (i18n census N3). Three places joined interface text with a
 * literal ASCII ", ": the "More providers" names (pinned at runtime in
 * `scripts/provider-grid-pin.test.mjs`), the sidebar row's `sr-only` clauses
 * (", on studio", ", Pinned", ", opened by coder", ", 2 hours ago") and, through
 * a private `Intl.ListFormat`, the background-work clause. Under ur and zh-CN a
 * screen reader read a Latin comma inside an Arabic-script or Chinese sentence.
 * The fix is one shared pair in `src/i18n/format.ts`: `formatList` for a list
 * the locale may join with its own "and", `listSeparator` for the bare
 * separator a sentence with its own conjunction (or a clause appended to an
 * accessible name) needs.
 *
 * WHY SOURCE PINS FOR THE SIDEBAR. The row's `sr-only` spans live inside
 * `ChatSidebar`'s several-thousand-line render, which this suite has no harness
 * to mount (the existing pins in `scripts/chat-remote.test.mjs` read the same
 * source). The runtime half - what `listSeparator()` returns per locale - is
 * executed here, and the source half proves every clause joiner calls it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { formatList, listSeparator, setLocale } from "./src/i18n";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
});
const { formatList, listSeparator, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const source = (path) => readFileSync(path, "utf8");

test("listSeparator is CLDR's bare separator: en byte-identical, ur and zh-CN native", () => {
	assert.equal(listSeparator("en"), ", ");
	assert.equal(listSeparator("ur"), "\u060C ");
	assert.equal(listSeparator("zh-CN"), "\u3001");
	// Locales whose narrow list ends in a WORD still get only the separator:
	// the sentence that uses it carries its own conjunction.
	assert.equal(listSeparator("hi"), ", ");
	assert.equal(listSeparator("es"), ", ");
	for (const tag of ["en", "es", "fr", "ru", "vi", "hi", "zh-CN", "ur"])
		assert.doesNotMatch(listSeparator(tag), /\p{L}/u, tag);
});

test("listSeparator follows the current locale when none is pinned", () => {
	try {
		setLocale("ur");
		assert.equal(listSeparator(), "\u060C ");
		setLocale("zh-CN");
		assert.equal(listSeparator(), "\u3001");
		setLocale("en");
		assert.equal(listSeparator(), ", ");
	} finally {
		setLocale("en");
	}
});

test("the sidebar row's sr-only clauses join with listSeparator, never a literal comma", () => {
	const sidebar = source(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	);
	const srOnly = [
		...sidebar.matchAll(/<span className="sr-only">([\s\S]*?)<\/span>/g),
	].map((match) => match[1]);
	const literal = srOnly.filter((body) => /^\s*,\s/.test(body));
	assert.deepEqual(literal, [], "an sr-only clause still opens with ', '");
	// The five clause fragments the census named: remote host, unreachable
	// owner, Pinned, opened-by, relative time.
	const joined = srOnly.filter((body) =>
		/^\s*\{listSeparator\(\)\}\s*\{/.test(body),
	);
	assert.equal(joined.length, 5, joined.join("\n---\n"));
	// What the reader hears, per locale, for one of them.
	const spoken = (tag) => `${listSeparator(tag)}2 hours ago`;
	assert.equal(spoken("en"), ", 2 hours ago");
	assert.equal(spoken("ur"), "\u060C 2 hours ago");
	assert.equal(spoken("zh-CN"), "\u30012 hours ago");
});

test("the provider summary and the background-work clause use the shared joiners", () => {
	const catalog = source(
		"src/renderer/src/features/providers/provider-catalog.ts",
	);
	assert.doesNotMatch(catalog, /\.join\(", "\)/);
	assert.match(catalog, /listSeparator\(\)/);
	const subagents = source(
		"src/renderer/src/features/chat/chat-session-subagents.ts",
	);
	assert.doesNotMatch(subagents, /new ListFormat\(|Intl as unknown/);
	assert.match(subagents, /formatList\(items\)/);
	// The background-work joiner's output is unchanged for en and native elsewhere.
	assert.equal(formatList(["1 subagent", "1 job"], "en"), "1 subagent, 1 job");
	assert.equal(formatList(["a", "b", "c"], "ur"), "a\u060C b\u060C c");
	assert.equal(formatList(["a", "b", "c"], "zh-CN"), "a\u3001b\u3001c");
});
