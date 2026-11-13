import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * TOOL-ROW VERBS RESOLVE THROUGH THE CATALOGUE (French census, bug B1).
 *
 * `toolVerb` picks the verb column of a transcript tool row from three places:
 * Team Bridge's keyed verbs, the op-specific `TOOL_OP_VERBS` table and the
 * static `TOOL_VERBS` table. The two tables used to hold English literals, so a
 * French transcript still read `Ran` / `Searching` / `Listed sessions`. They now
 * hold catalogue KEYS and `toolVerb` calls `t()` at call time.
 *
 * Two guarantees, both asserted against the real module (bundled the way the
 * other i18n suites bundle theirs) rather than a copy of its logic:
 *
 * 1. BEHAVIOUR. With a synthetic non-English catalogue in which every verb key
 *    maps to a marker (`FR:<key>`), every verb path - static, op-specific,
 *    Team Bridge, generic fallback - returns the marker and never the English
 *    literal; switching the locale back repaints on the very next call (no
 *    module-load caching), which is what the `useI18nLocale` boundary relies on.
 * 2. SOURCE GUARD. The scanner (`check-strings.mjs`) deliberately ignores the
 *    `settled`/`running` property names, so this test is the fence: any value
 *    in the verb tables that is not a `ui.chat.canonical.tool_row.verb.*` key
 *    of the matching form fails, with a negative control proving the guard
 *    actually trips on an English literal.
 */

const ROOT = process.cwd();
const TRACE = join(ROOT, "src/renderer/src/features/chat/components/trace");
const modelSource = readFileSync(join(TRACE, "tool-row-model.ts"), "utf8");
const bridgeSource = readFileSync(join(TRACE, "bridge-row-model.ts"), "utf8");
const enCatalogue = JSON.parse(
	readFileSync(
		join(ROOT, "src/i18n/catalogues/en/ui.chat.canonical.json"),
		"utf8",
	),
);
const VERB_NS = "ui.chat.canonical.tool_row.verb.";

const bundle = await build({
	stdin: {
		contents: [
			'export { toolVerb } from "./src/renderer/src/features/chat/components/trace/tool-row-model";',
			'export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@features": join(ROOT, "src/renderer/src/features"),
		"@shared": join(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The two verb tables' source text, from `TOOL_VERBS` up to `toolVerb`'s docblock. */
function verbTablesText(source) {
	const start = source.indexOf("const TOOL_VERBS:");
	const end = source.lastIndexOf(
		"/**",
		source.indexOf("export function toolVerb("),
	);
	assert.ok(
		start > 0 && end > start,
		"verb tables located in tool-row-model.ts",
	);
	return source.slice(start, end);
}

/**
 * Every `settled:`/`running:` VALUE in the tables that is not a verb key of the
 * matching form. Empty means the tables hold only catalogue keys.
 */
function nonKeyVerbValues(text) {
	const bad = [];
	for (const m of text.matchAll(/\b(settled|running)\s*:\s*([^,}\n]+)/g)) {
		const [, form, value] = m;
		const key = new RegExp(
			`^"ui\\.chat\\.canonical\\.tool_row\\.verb\\.[a-z0-9_]+\\.${form}"$`,
		);
		if (!key.test(value.trim())) bad.push(`${form}: ${value.trim()}`);
	}
	return bad;
}

/** Table entries as `{ tool, op|null, settled, running }`, read from the source text. */
function tableEntries(text) {
	const split = text.indexOf("const TOOL_OP_VERBS");
	const entries = [];
	const pair = String.raw`settled:\s*"([^"]+)",\s*running:\s*"([^"]+)"`;
	for (const m of text
		.slice(0, split)
		.matchAll(new RegExp(String.raw`^\t(\w+): \{\s*${pair}`, "gm"))) {
		entries.push({ tool: m[1], op: null, settled: m[2], running: m[3] });
	}
	let tool = null;
	const opText = text.slice(split);
	for (const m of opText.matchAll(
		new RegExp(
			String.raw`^\t(\w+): \{\s*$|^\t\t("?[\w-]+"?): \{\s*${pair}`,
			"gm",
		),
	)) {
		if (m[1]) tool = m[1];
		else
			entries.push({
				tool,
				op: m[2].replaceAll('"', ""),
				settled: m[3],
				running: m[4],
			});
	}
	return entries;
}

const tables = verbTablesText(modelSource);
const entries = tableEntries(tables);

/** Bridge verb tokens (`VERBS` keys in bridge-row-model.ts). */
const bridgeActions = [
	...bridgeSource
		.slice(bridgeSource.indexOf("const VERBS:"))
		.matchAll(/^\t(\w+): \(\) => \(\{/gm),
].map((m) => m[1]);

function useMarkerCatalogue() {
	mod.clearRegisteredCatalogues();
	const markers = {};
	for (const key of Object.keys(enCatalogue)) markers[key] = `FR:${key}`;
	mod.registerCatalogue("fr", markers);
	mod.setLocale("fr");
}

test("the table reader found the whole vocabulary (guards against a vacuous pass)", () => {
	// 98 static + op entries today; a parse that silently found a handful would
	// make every assertion below pass for the wrong reason.
	assert.ok(entries.length >= 90, `entries parsed: ${entries.length}`);
	assert.ok(entries.some((e) => e.tool === "bash" && e.op === null));
	assert.ok(entries.some((e) => e.tool === "sessions" && e.op === "spawn"));
	assert.ok(entries.some((e) => e.tool === "console" && e.op === "secure"));
	assert.ok(
		bridgeActions.length >= 15,
		`bridge actions: ${bridgeActions.length}`,
	);
});

test("every static and op-specific verb resolves through the catalogue, never English", () => {
	useMarkerCatalogue();
	try {
		for (const { tool, op, settled, running } of entries) {
			const got = mod.toolVerb(tool, op);
			const label = `${tool}${op ? `.${op}` : ""}`;
			assert.equal(got.settled, `FR:${settled}`, `${label} settled`);
			assert.equal(got.running, `FR:${running}`, `${label} running`);
			// Specific verbs stay specific: never degraded to the generic fallback.
			assert.equal(got.named, true, `${label} stays named`);
			assert.ok(
				!got.settled.includes("generic_verb"),
				`${label} must not fall to the generic verb`,
			);
		}
		// Case-insensitive tool names keep resolving (a provider may echo `Bash`).
		assert.equal(
			mod.toolVerb("Bash").settled,
			entries.find((e) => e.tool === "bash").settled.replace(/^/, "FR:"),
		);
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});

test("Team Bridge and the generic fallback also resolve through the catalogue", () => {
	useMarkerCatalogue();
	try {
		for (const action of bridgeActions.filter((a) => a !== "unknown")) {
			const got = mod.toolVerb("bridge", action);
			assert.match(
				got.settled,
				/^FR:ui\.chat\.canonical\.tool_row\.bridge\.verb\./,
				action,
			);
			assert.match(
				got.running,
				/^FR:ui\.chat\.canonical\.tool_row\.bridge\.verb\./,
				action,
			);
		}
		assert.equal(
			mod.toolVerb("mcp__linear_create_issue").settled,
			"FR:ui.chat.canonical.tool_row.generic_verb.settled",
		);
		// An op-aware tool with an op this build does not know takes the generic verb.
		assert.equal(
			mod.toolVerb("agent", "no-such-op").running,
			"FR:ui.chat.canonical.tool_row.generic_verb.running",
		);
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});

test("a locale switch repaints the next call with no remount (resolved at call time)", () => {
	useMarkerCatalogue();
	try {
		assert.equal(mod.toolVerb("grep").settled, `FR:${VERB_NS}searched.settled`);
		mod.setLocale("en");
		assert.equal(mod.toolVerb("grep").settled, "Searched");
		assert.equal(mod.toolVerb("sessions", "spawn").running, "Spawning session");
		mod.setLocale("fr");
		assert.equal(mod.toolVerb("grep").running, `FR:${VERB_NS}searched.running`);
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});

test("every verb key used by the tables exists in the English catalogue, and none is orphaned", () => {
	const used = new Set(
		entries.flatMap(({ settled, running }) => [settled, running]),
	);
	for (const key of used) {
		assert.ok(key in enCatalogue, `${key} missing from ui.chat.canonical.json`);
		assert.ok(key.startsWith(VERB_NS), key);
	}
	const catalogued = Object.keys(enCatalogue).filter((k) =>
		k.startsWith(VERB_NS),
	);
	assert.deepEqual([...used].sort(), catalogued.sort());
});

test("source guard: the verb tables hold only catalogue keys, never English literals", () => {
	assert.deepEqual(nonKeyVerbValues(tables), []);
	// Team Bridge's table goes through t() already; keep it that way.
	const bridgeTable = bridgeSource.slice(bridgeSource.indexOf("const VERBS:"));
	const bridgeEnd = bridgeTable.indexOf("export function bridgeVerb");
	assert.doesNotMatch(
		bridgeTable.slice(0, bridgeEnd),
		/\b(settled|running|failed)\s*:\s*["'`]/,
		"bridge verbs must be t() calls, not literals",
	);
});

test("source guard negative control: an English literal or a wrong-form key trips it", () => {
	const english = tables.replace(/(bash: \{\s*settled: )"[^"]+"/, '$1"Ran"');
	assert.notEqual(english, tables, "control mutation applied");
	assert.deepEqual(nonKeyVerbValues(english), ['settled: "Ran"']);
	const wrongForm = tables.replace(
		/(bash: \{\s*settled: )"[^"]+"/,
		`$1"${VERB_NS}ran.running"`,
	);
	assert.equal(nonKeyVerbValues(wrongForm).length, 1);
	// A brand-new English entry in the op table is caught the same way.
	const added = tables.replace(
		"const TOOL_OP_VERBS: Record<string, Record<string, VerbKeys>> = {",
		'$&\n\tfoo: { bar: { settled: "Did", running: "Doing" } },',
	);
	assert.equal(nonKeyVerbValues(added).length, 2);
});
