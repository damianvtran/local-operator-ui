/**
 * RENDERER LITERALS THE RENDERED CENSUS FOUND PAINTING IN ENGLISH IN EVERY LOCALE.
 *
 * WHY THIS FILE EXISTS. The census of the installed desktop app (0.52.3, scratch
 * backend, DOM text harvested per locale) found English in all seven locales that
 * the string scanner cannot see, because none of it is JSX text or a copy
 * attribute: it is built inside pure models and helpers - template literals
 * (`${n} actions`), a regex that rewrote an already-translated label back to
 * English (`.replace(/^(Open|Close) run details/, "Run details")`), nouns glued
 * to a keyed phrase (`Show 4 more` + `agents`), and prefixes that were stripped
 * again with `startsWith`. This file pins the fix at the model seam.
 *
 * WHAT IS ASSERTED, in the order that matters:
 *  1. ENGLISH IS UNCHANGED BYTE FOR BYTE. Translators and every English-reading
 *     test already work against these strings, so the keyed English must equal
 *     what the literals produced (exact strings below; the PR also carries a
 *     differential run of the base and the branch over ~9,000 inputs).
 *  2. UNDER A SYNTHETIC LOCALE whose catalogue holds only marker values
 *     (`⟦key …⟧`), every string below is built from the catalogue: once the
 *     markers are removed NO Latin letters remain. A literal that never reached
 *     the catalogue stays visible. This is the check that fails against the
 *     pre-fix source (see NEGATIVE CONTROL).
 *  3. Data that is not copy stays data: a tool's own name is not translated.
 *
 * NEGATIVE CONTROL. `CENSUS_CONTROL_BASE=origin/main node --test
 * scripts/i18n/key-census-literals.test.mjs` replaces the modules under test with
 * their pre-fix bytes and keeps the same assertions: it must fail (missing
 * `draftRowLabel`/`groupWithheldSentence`, English left in the marker output).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { withAbsentLocale } from "./absent-locale.mjs";

const ROOT = process.cwd();
const controlBase = process.env.CENSUS_CONTROL_BASE;
const RENDERER_SOURCE = /\/src\/renderer\/.*\.tsx?$/;

const bundle = await build({
	stdin: {
		contents: [
			'export * as fold from "./src/renderer/src/features/chat/canonical/trace-fold-model";',
			'export * as ask from "./src/renderer/src/features/chat/ask-queue";',
			'export * as paging from "./src/renderer/src/features/chat/sidebar-scope-paging";',
			'export * as drafts from "./src/renderer/src/features/chat/draft-rows";',
			'export * as at from "./src/renderer/src/features/chat/components/at-contract";',
			'export * as slash from "./src/renderer/src/features/chat/components/slash-contract";',
			'export * as wake from "./src/renderer/src/features/chat/components/run-details/wake-controls-model";',
			'export * as rd from "./src/renderer/src/features/chat/components/run-details/run-detail-model";',
			'export * as sbv from "./src/renderer/src/features/chat/chat-sidebar-view";',
			'export { currentLocale, registerCatalogue, setLocale, t } from "@shared/i18n";',
		].join("\n"),
		resolveDir: ROOT,
	},
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	plugins: controlBase
		? [
				{
					name: "pre-fix-control",
					setup(builder) {
						builder.onLoad({ filter: RENDERER_SOURCE }, ({ path }) => {
							try {
								return {
									contents: execFileSync(
										"git",
										["show", `${controlBase}:${relative(ROOT, path)}`],
										{
											encoding: "utf8",
											maxBuffer: 1 << 28,
											stdio: ["ignore", "pipe", "ignore"],
										},
									),
									loader: path.endsWith("x") ? "tsx" : "ts",
								};
							} catch {
								return undefined;
							}
						});
					},
				},
			]
		: [],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const CATALOGUE_DIR = "src/i18n/catalogues/en/";
const english = (namespace) =>
	JSON.parse(readFileSync(`${CATALOGUE_DIR}${namespace}.json`, "utf8"));
const KEYED = {
	...english("ui.chat.canonical"),
	...english("ui.chat.asks"),
	...english("ui.chat.sidebar"),
	...english("ui.chat.pickers"),
	...english("ui.chat.run_details"),
};

/** The keys this change added, by prefix: every one must resolve to a marker below. */
const NEW_PREFIXES = [
	"ui.chat.canonical.fold.count.",
	"ui.chat.canonical.fold.sentence.",
	"ui.chat.canonical.fold.receipt.",
	"ui.chat.canonical.fold.unit_separator",
	"ui.chat.asks.scope.",
	"ui.chat.asks.scope_line",
	"ui.chat.asks.clause.",
	"ui.chat.sidebar.groups.empty",
	"ui.chat.sidebar.groups.loading",
	"ui.chat.sidebar.groups.withheld",
	"ui.chat.sidebar.catalogue.show_more_agents",
	"ui.chat.sidebar.catalogue.show_more_teams",
	"ui.chat.sidebar.drafts.row_label",
	"ui.chat.sidebar.drafts.discard_label",
	"ui.chat.pickers.at_menu.footer.",
	"ui.chat.pickers.slash.row_slot.",
	"ui.chat.run_details.wake.managed_",
];
const NEW_KEYS = Object.keys(KEYED).filter((key) =>
	NEW_PREFIXES.some((prefix) => key.startsWith(prefix)),
);

/** `⟦key arg={arg}…⟧`: the placeholders the English message names, kept as plain arguments. */
const markerFor = (key) => {
	const args = [
		...new Set(
			[...KEYED[key].matchAll(/\{(\w+)\s*[,}]/g)]
				.map((match) => match[1])
				.filter((name) => name !== "number" && name !== "plural"),
		),
	];
	return `⟦${key}${args.map((arg) => ` ${arg}={${arg}}`).join("")}⟧`;
};
const MARKERS = Object.fromEntries(
	NEW_KEYS.map((key) => [key, markerFor(key)]),
);

/** What is left once every marker is removed: must carry no Latin letters. */
const MARKER = /⟦[^⟦⟧]*⟧/g;
const afterMarkers = (text) => {
	// Markers nest (a joiner marker wraps its parts' markers): peel innermost-first.
	let out = text;
	for (
		let next = out.replace(MARKER, "");
		next !== out;
		next = out.replace(MARKER, "")
	)
		out = next;
	return out;
};
const LATIN = /[A-Za-z]/;
const assertNoEnglish = (text, label) =>
	assert.doesNotMatch(
		afterMarkers(text),
		LATIN,
		`${label}: English left in ${JSON.stringify(text)}`,
	);

const act = (name, op) => ({ name, op, failed: false });
const row = (kind, extra = {}) => ({
	record: { id: `${kind}-${Math.random()}`, kind, ...extra },
	gap: "trace",
	closesTurn: false,
});
const view = (over = {}) => ({
	unread: false,
	asks: [],
	published: true,
	rows: [],
	open: 0,
	waiting: 0,
	movedOn: 0,
	delivering: 0,
	total: 0,
	truncated: false,
	urgent: false,
	soonestExpiryMs: null,
	head: null,
	...over,
});

const everyAskState = [
	view(),
	view({ open: 2, waiting: 2 }),
	view({ open: 1, waiting: 1 }),
	view({ open: 0, delivering: 3 }),
	view({ open: 0, delivering: 1 }),
	view({ open: 2, movedOn: 2 }),
	view({ open: 1, movedOn: 1 }),
	view({ open: 5, truncated: true }),
];

test("the new keys exist and the marker table covers every one", () => {
	assert.ok(
		NEW_KEYS.length >= 75,
		`expected the census keys, found ${NEW_KEYS.length}`,
	);
	for (const key of NEW_KEYS) assert.ok(MARKERS[key].startsWith("⟦ui."), key);
});

test("tool-summary fold: English is unchanged", () => {
	const six = Array.from({ length: 6 }, () => act("read"));
	assert.equal(
		m.fold.foldSummary([...six.slice(0, 2), act("read")]),
		"Explored 3 files",
	);
	assert.equal(
		m.fold.foldSummary([act("read"), act("read"), act("search_the_web")]),
		"Explored 2 files, searched the web 1 time",
	);
	assert.equal(
		m.fold.foldSummary([act("bash"), act("eval"), act("edit"), act("edit")]),
		"1 shell · 1 python · 2 edits",
	);
	assert.equal(
		m.fold.foldCounts([
			act("read"),
			act("read"),
			act("search_the_web"),
			act("bash"),
			act("edit"),
			act("edit"),
		]),
		"2 files · 1 web search · 1 shell · 2 edits",
	);
	assert.equal(m.fold.foldCounts([]), "0 actions");
	// The turn foot / bar / aria use the same keyed phrase for the bare total.
	const total = (count) =>
		m.t("ui.chat.canonical.fold.count.actions", { count });
	assert.equal(total(1), "1 action");
	assert.equal(total(6), "6 actions");
	assert.equal(
		m.t("ui.chat.canonical.fold.count.actions_partial", { count: 1 }),
		"1+ actions",
	);
	assert.equal(
		m.t("ui.chat.canonical.fold.count.actions_partial", { count: 40 }),
		"40+ actions",
	);
	assert.equal(
		m.fold
			.foldCountUnits(
				["a", "b", "c", "d", "e", "f"].map((label, index) => ({
					label,
					count: index === 5 ? 4 : 1,
				})),
			)
			.at(-1),
		"and 4 other actions",
	);
	assert.deepEqual(
		m.fold.receiptFoldUnits([row("peer"), row("peer"), row("wake")]),
		["2 incoming messages", "1 wake receipt"],
	);
});

test("tool-summary fold: every unit comes from the catalogue", () => {
	const restore = withAbsentLocale(m, MARKERS);
	try {
		const names = [
			"read",
			"grep",
			"bash",
			"eval",
			"edit",
			"search_the_web",
			"fetch",
			"task",
			"agent",
			"team",
			"team_delete",
			"hub",
			"secret",
			"project",
			"project_delete",
			"wake",
			"jobs",
			"console",
			"network",
			"browser",
			"todo",
			"send",
			"ask",
			"wait",
			"lsp",
			"web_read",
			"list_variables",
			"read_variable",
			"sessions",
		];
		for (const name of names) {
			const run = [act(name), act(name), act(name)];
			assertNoEnglish(m.fold.foldCounts(run), `foldCounts(${name})`);
			assertNoEnglish(m.fold.foldSummary(run), `foldSummary(${name})`);
		}
		for (const op of ["view", "cancel"]) {
			for (const name of ["todo", "jobs"]) {
				assertNoEnglish(m.fold.foldCounts([act(name, op)]), `${name} ${op}`);
			}
		}
		// The two-class sentence uses the `_follow` spelling for the trailing clause
		// and the keyed joiner, never a lowercased copy of a translated string.
		const sentence = m.fold.foldSummary([act("read"), act("bash")]);
		assert.ok(sentence.includes("sentence.files"));
		assert.ok(sentence.includes("sentence.commands_follow"));
		assert.ok(sentence.includes("sentence.join"));
		assertNoEnglish(sentence, "two-class sentence");
		// The cap tail and the generic total.
		assertNoEnglish(
			m.fold.foldCounts(names.map((name) => act(name))),
			"capped line",
		);
		assertNoEnglish(m.fold.foldCounts([]), "empty total");
		// Receipt family units.
		assertNoEnglish(
			m.fold
				.receiptFoldUnits([
					row("peer"),
					row("wake"),
					row("custom", { customType: "job_result" }),
					row("custom", { customType: "monitor_prompt" }),
					row("custom", {
						customType: "future_receipt",
						receipt: { expectsReply: true, steer: true },
					}),
				])
				.join(m.fold.foldUnitSeparator()),
			"receipt units",
		);
		// A tool's own name is DATA: only the order of count and name is keyed.
		assert.ok(m.fold.foldCounts([act("ai_search")]).includes("ai_search"));
		// The bar's title joins with the keyed separator.
		assert.ok(
			m.fold.foldCounts([act("read"), act("bash")]).includes("unit_separator"),
		);
	} finally {
		restore();
	}
});

test("Requests rail: English is unchanged, and every label comes from the catalogue", () => {
	assert.equal(m.ask.askScopeSubject("session"), "This conversation");
	assert.equal(m.ask.askScopeSubject("fleet"), "All conversations");
	assert.equal(
		m.ask.askScopeLine("session", view()),
		"This conversation · All asks settled",
	);
	assert.equal(
		m.ask.askChipCountClause(view({ open: 1, waiting: 1 })),
		"1 question waiting",
	);
	assert.equal(
		m.ask.askChipCountClause(view({ open: 2, waiting: 2 })),
		"2 questions waiting",
	);
	assert.equal(
		m.ask.askChipCountClause(view({ open: 0, delivering: 1 })),
		"1 answer not yet delivered — you can still change it",
	);
	assert.equal(
		m.ask.askChipCountClause(view({ open: 0, delivering: 3 })),
		"3 answers not yet delivered — you can still change them",
	);
	assert.equal(
		m.ask.askChipCountClause(view({ open: 2, movedOn: 2 })),
		"2 questions timed out",
	);
	assert.equal(
		m.ask.askChipCountClause(view({ open: 5, truncated: true })),
		"5 outstanding",
	);
	const restore = withAbsentLocale(m, MARKERS);
	try {
		for (const scope of ["session", "fleet"]) {
			assertNoEnglish(m.ask.askScopeSubject(scope), scope);
			for (const state of everyAskState) {
				assertNoEnglish(
					m.ask.askScopeLine(scope, state),
					`${scope} ${JSON.stringify(state.open)}`,
				);
				assertNoEnglish(m.ask.askChipCountClause(state), "chip clause");
			}
		}
	} finally {
		restore();
	}
});

test("sidebar group sentences, draft rows and the section foot: English unchanged, keyed", () => {
	const empty = (pageable) =>
		m.paging.groupChatsView({
			pageable,
			scope: undefined,
			held: 0,
			total: pageable ? 0 : null,
		});
	assert.equal(empty(false).sentence, "No chats yet");
	assert.equal(
		m.paging.groupWithheldSentence(),
		"They may be archived. Search with Include archived.",
	);
	assert.equal(m.drafts.draftRowLabel("Fix it"), "Draft: Fix it");
	assert.equal(m.drafts.discardDraftLabel("Fix it"), "Discard draft “Fix it”");
	assert.equal(m.sbv.sectionMoreName(4, "agents"), "Show 4 more agents");
	assert.equal(m.sbv.sectionMoreName(4, "teams"), "Show 4 more teams");
	assert.equal(m.sbv.sectionMoreName(1000, "agents"), "Show 1000 more agents");
	const restore = withAbsentLocale(m, MARKERS);
	try {
		assertNoEnglish(empty(false).sentence, "No chats yet");
		assertNoEnglish(m.paging.groupWithheldSentence(), "withheld");
		assertNoEnglish(m.drafts.draftRowLabel("𝑡𝑖𝑡𝑙𝑒"), "draft label");
		assertNoEnglish(m.drafts.discardDraftLabel("𝑡𝑖𝑡𝑙𝑒"), "discard label");
		// The census's "再显示4条 agents": the section noun is inside the keyed phrase.
		assertNoEnglish(m.sbv.sectionMoreName(4, "agents"), "agents foot");
		assertNoEnglish(m.sbv.sectionMoreName(4, "teams"), "teams foot");
	} finally {
		restore();
	}
});

test("@ menu footer, slash row slot, managed wake and the trigger's name", () => {
	assert.equal(
		m.at.atFooter({ path: "package.json", directory: false }),
		"Enter inserts @package.json · Esc closes",
	);
	assert.equal(
		m.at.atFooter({ path: "Library", directory: true }),
		"Enter opens Library · Esc closes",
	);
	assert.equal(m.at.atFooter(undefined), "Nothing to insert · Esc closes");
	assert.equal(
		m.slash.commandRowSlot(
			{ arguments: "required", destination: "x" },
			undefined,
		),
		"needs a value",
	);
	assert.equal(
		m.slash.commandRowSlot(
			{ arguments: "none", destination: "session.fast" },
			"on",
		),
		"currently on",
	);
	assert.equal(m.wake.managedWakeShortLabel("Aida"), "managed by Aida");
	assert.equal(
		m.wake.managedWakeNote("Aida"),
		"This wake is Aida's own schedule, so it can't be cancelled here. To stop these check-ins, use /aida pause.",
	);
	// The rail button's accessible name is the keyed pane name, not a rewrite of the verb phrase.
	assert.equal(
		m.rd.runDetailTriggerLabel(null, undefined, {
			open: false,
			cap: "⌘R",
			name: true,
		}),
		"Run details (⌘R)",
	);
	assert.equal(
		m.rd.runDetailTriggerLabel(null, undefined, { open: false, cap: "⌘R" }),
		"Open run details (⌘R)",
	);
	assert.equal(
		m.rd.runDetailTriggerLabel(null, undefined, { open: true }),
		"Close run details",
	);
	const restore = withAbsentLocale(m, {
		...MARKERS,
		// Existing keys, given markers so the head of the label is provably the catalogue's.
		"ui.chat.header.open_run_details": "⟦open⟧",
		"ui.chat.header.close_run_details": "⟦close⟧",
		"ui.chat.run_details.pane_label": "⟦pane⟧",
	});
	try {
		const bare = (options) =>
			m.rd.runDetailTriggerLabel(null, undefined, options);
		assert.equal(bare({ open: false }), "⟦open⟧");
		assert.equal(bare({ open: true }), "⟦close⟧");
		assert.equal(bare({ open: false, name: true }), "⟦pane⟧");
		assert.equal(bare({ open: true, cap: "⌘R", name: true }), "⟦pane⟧ (⌘R)");
		assertNoEnglish(
			m.at.atFooter({ path: "package.json", directory: false }),
			"@ footer",
		);
		assertNoEnglish(
			m.at.atFooter({ path: "Library", directory: true }),
			"@ dir footer",
		);
		assertNoEnglish(m.at.atFooter(undefined), "@ nothing");
		assertNoEnglish(
			m.slash.commandRowSlot(
				{ arguments: "required", destination: "x" },
				undefined,
			),
			"slot",
		);
		assertNoEnglish(
			m.slash.commandRowSlot(
				{ arguments: "none", destination: "session.fast" },
				"off",
			),
			"fast",
		);
		assertNoEnglish(m.wake.managedWakeShortLabel("𝐴𝑖𝑑𝑎"), "managed by");
		assertNoEnglish(m.wake.managedWakeNote("𝐴𝑖𝑑𝑎"), "managed note");
	} finally {
		restore();
	}
});
