import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SyntaxKind } from "typescript/unstable/ast";

import {
	ALLOWLIST,
	BASELINE,
	BASELINE_NOTE,
	allowlistReason,
	countsOf,
	failureSummary,
	loadAllowlist,
	loadBaseline,
	main,
	openSnapshot,
	ratchetFindings,
	runCheck,
	saveBaseline,
	scanSnapshot,
} from "./check-strings.mjs";

/*
 * The i18n scanner's falsifiability, on fixtures and on the real tree.
 *
 * The fixture (`fixtures/scan/violations.tsx`) pins every shape the scanner
 * claims to see and every shape it claims NOT to: the assertions below are the
 * difference between the module's docstring and its behaviour. The real-tree
 * case is the gate itself — the same code path CI runs — asserting the tree
 * this PR ships is at-or-below its own committed baseline, with every counted
 * file recorded.
 *
 * The compiler note: this suite spawns the TS 7 language server once per API
 * instance (`openSnapshot`), closes it in `after`, and never leaves it behind.
 */

const REPO = new URL("../..", import.meta.url).pathname;
const FIXTURE = "scripts/i18n/fixtures/scan/violations.tsx";

const fixtureApi = openSnapshot(REPO, [join(REPO, FIXTURE)]);
after(() => {
	fixtureApi.api.close();
});

function fixtureFindings() {
	const scanned = scanSnapshot(fixtureApi.snapshot, REPO, {
		extraScan: [FIXTURE],
	});
	return scanned.get(FIXTURE) ?? [];
}

test("the fixture's findings are exactly the flagged shapes, on pinned lines", () => {
	const found = fixtureFindings().map((finding) => ({
		line: finding.line,
		kind: finding.kind,
		text: finding.text,
	}));
	assert.deepEqual(found, [
		{ line: 22, kind: "jsx-text", text: "Flagged text" },
		{ line: 23, kind: "jsx-text", text: "items" },
		{ line: 27, kind: "attribute:aria-label", text: "Flagged aria" },
		{ line: 28, kind: "jsx-text", text: "Nested flagged text" },
		{ line: 30, kind: "attribute:alt", text: "Flagged alt" },
		{ line: 31, kind: "attribute:placeholder", text: "Flagged placeholder" },
		{
			line: 41,
			kind: "jsx-text",
			text: "Reasonless pragma is not an exemption",
		},
		{ line: 43, kind: "jsx-text", text: "Flagged ok" },
		{ line: 46, kind: "jsx-text", text: "Nested text" },
		{ line: 49, kind: "attribute:title", text: "Flagged title" },
		{ line: 49, kind: "jsx-text", text: "Tail" },
	]);
});

test("the fixture's exempt shapes stay unflagged", () => {
	const texts = fixtureFindings().map((finding) => finding.text);
	// A pragma inside the element exempts the element's own text...
	assert.ok(!texts.includes("Exempt text"));
	// ...and one between attributes exempts the attribute copy after it (an
	// attribute cannot carry a comment of its own; the enclosing element is
	// the span the walker consults).
	assert.ok(!texts.includes("Exempt aria"));
	assert.ok(!texts.includes("Exempt title"));
	// The reasonless pragma (its closer is not a reason) exempts nothing: the
	// span after it IS flagged, asserted above.
	// Punctuation, symbol and digit-only texts are not copy...
	assert.ok(
		!texts.includes("·") && !texts.includes("—") && !texts.includes("42"),
	);
	// ...and an expression-valued copy attribute is not a literal.
	assert.ok(!texts.some((text) => text === "Expression" || text === "Copy"));
});

test("an allowlist entry needs a reason and matches exact paths or prefixes", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-allowlist-"));
	try {
		const path = join(dir, "allowlist.json");
		writeFileSync(
			path,
			JSON.stringify({
				schema: 1,
				entries: [
					{ path: "src/renderer/src/vendor/", reason: "vendored" },
					{ path: "src/renderer/src/kept.tsx", reason: "generated" },
				],
			}),
		);
		const entries = loadAllowlist(path);
		assert.equal(
			allowlistReason("src/renderer/src/vendor/inner/x.tsx", entries),
			"vendored",
		);
		assert.equal(
			allowlistReason("src/renderer/src/kept.tsx", entries),
			"generated",
		);
		// An exact path does not prefix-match, and a prefix does not exact-match.
		assert.equal(
			allowlistReason("src/renderer/src/kept.tsx.bak", entries),
			undefined,
		);
		assert.equal(
			allowlistReason("src/renderer/src/vendorx/a.tsx", entries),
			undefined,
		);

		writeFileSync(
			path,
			JSON.stringify({ entries: [{ path: "src/a.tsx", reason: "  " }] }),
		);
		assert.throws(() => loadAllowlist(path), /reason/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the shipped allowlist parses and every entry carries a reason", () => {
	const entries = loadAllowlist(ALLOWLIST);
	for (const entry of entries) {
		assert.ok(
			entry.reason.trim() !== "",
			`allowlist entry ${entry.path} has no reason`,
		);
	}
});

test("an unbaselined file with literals FAILS", () => {
	// No entry at all: the fixture's 11 literals must fail, not print as advice.
	// This is the exact state every new file starts in.
	const { counts, failures } = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: {}, note: "" },
	});
	assert.equal(counts[FIXTURE], 11);
	assert.deepEqual(
		failures.map((finding) => finding.path),
		[FIXTURE],
	);
	assert.equal(failures[0].ceiling, null);
});

test("a ceiling breach FAILS; a file at its ceiling passes", () => {
	const count = fixtureFindings().length;
	const breached = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: { [FIXTURE]: count - 1 }, note: "" },
	});
	assert.equal(breached.failures.length, 1);
	assert.equal(breached.failures[0].count, count);
	assert.equal(breached.failures[0].ceiling, count - 1);

	const atCeiling = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: { [FIXTURE]: count }, note: "" },
	});
	assert.deepEqual(atCeiling.failures, []);
});

test("the failure summary names --init --force only when an entry is missing", () => {
	// Both shapes are built from the fixture's real findings: a missing entry
	// (no baseline record) and a ceiling breach (recorded, then exceeded).
	const count = fixtureFindings().length;
	const missing = ratchetFindings({ [FIXTURE]: count }, {});
	const breached = ratchetFindings(
		{ [FIXTURE]: count },
		{ [FIXTURE]: count - 1 },
	);
	assert.equal(missing[0].ceiling, null);
	assert.equal(breached[0].ceiling, count - 1);

	const missingLine = failureSummary(missing);
	assert.ok(missingLine.includes("`--init --force` capture"), missingLine);

	// A ceiling breach is fixed by extracting, not by capturing the bigger
	// number: `--init --force` would record the literal the breach reports.
	const breachLine = failureSummary(breached);
	assert.ok(!breachLine.includes("--init"), breachLine);
	assert.ok(breachLine.includes("Extract the string"), breachLine);
	assert.ok(breachLine.includes("i18n/allowlist.json"), breachLine);

	// One missing entry among breaches still needs its own remedy named.
	const mixed = failureSummary([...breached, ...missing]);
	assert.ok(mixed.includes("`--init --force` capture"), mixed);
});

test("an allowlisted file passes with no baseline entry", () => {
	const { counts, failures } = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: {}, note: "" },
		allowlist: [{ path: FIXTURE, reason: "fixture: pinned by this suite" }],
	});
	assert.deepEqual(counts, {});
	assert.deepEqual(failures, []);
});

test("baseline files round-trip as schema 2; a schema-1 scope is ignored", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-baseline-"));
	try {
		const path = join(dir, "baseline.json");
		saveBaseline(path, { "src/b.tsx": 2, "src/a.tsx": 1 }, "note");
		const loaded = loadBaseline(path);
		assert.deepEqual(loaded.files, { "src/a.tsx": 1, "src/b.tsx": 2 });
		assert.equal(loaded.schema, 2);
		// The scope concept is gone, not merely empty.
		assert.equal(loaded.enforced, undefined);
		/*
		 * A schema-1 baseline is still accepted — its ceilings apply — but its
		 * `enforced` list is ignored: a stale scope must not resurrect a
		 * report-only mode on a branch that predates the global rule.
		 */
		writeFileSync(
			path,
			JSON.stringify({
				schema: 1,
				enforced: ["src/i18n/"],
				files: { "src/c.tsx": 3 },
			}),
		);
		const legacy = loadBaseline(path);
		assert.equal(legacy.schema, 1);
		assert.deepEqual(legacy.files, { "src/c.tsx": 3 });
		assert.equal(legacy.enforced, undefined);
		// A missing baseline reads as empty (fail closed), not a crash.
		const missing = loadBaseline(join(dir, "absent.json"));
		assert.deepEqual(missing.files, {});
		assert.equal(missing.note, BASELINE_NOTE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a malformed baseline ceiling is dropped, not coerced, and fails closed", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-baseline-"));
	try {
		const path = join(dir, "baseline.json");
		/*
		 * The hole this pins: `Number("twelve")` is NaN, and `ratchetFindings`
		 * fails only when `count > ceiling` — false for NaN — so a coerced
		 * ceiling would silently exempt the file it was meant to hold to. Each
		 * malformed shape must become NO entry, and therefore a `null`-ceiling
		 * failure for a file that still has literals.
		 */
		writeFileSync(
			path,
			JSON.stringify({
				schema: 2,
				note: "",
				files: {
					"src/string.tsx": "twelve",
					"src/negative.tsx": -1,
					"src/fractional.tsx": 1.5,
					"src/null.tsx": null,
					"src/zero.tsx": 0,
				},
			}),
		);
		const loaded = loadBaseline(path);
		assert.deepEqual(loaded.files, { "src/zero.tsx": 0 });
		const literals = 3;
		const findings = ratchetFindings(
			{
				"src/string.tsx": literals,
				"src/negative.tsx": literals,
				"src/fractional.tsx": literals,
				"src/null.tsx": literals,
				"src/zero.tsx": literals,
			},
			loaded.files,
		);
		assert.deepEqual(findings, [
			{ path: "src/fractional.tsx", count: literals, ceiling: null },
			{ path: "src/negative.tsx", count: literals, ceiling: null },
			{ path: "src/null.tsx", count: literals, ceiling: null },
			{ path: "src/string.tsx", count: literals, ceiling: null },
			// A valid zero ceiling still applies: literals against it are a breach.
			{ path: "src/zero.tsx", count: literals, ceiling: 0 },
		]);
		// A zero-count file passes against its zero ceiling.
		assert.deepEqual(ratchetFindings({ "src/zero.tsx": 0 }, loaded.files), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("countsOf skips allowlisted files before counting", () => {
	const scanned = new Map([
		[
			"src/renderer/src/vendor/x.tsx",
			[{ line: 1, kind: "jsx-text", text: "a" }],
		],
		["src/renderer/src/kept.tsx", [{ line: 1, kind: "jsx-text", text: "b" }]],
	]);
	const counts = countsOf(scanned, [
		{ path: "src/renderer/src/vendor/", reason: "vendored" },
	]);
	assert.deepEqual(counts, { "src/renderer/src/kept.tsx": 1 });
});

test("the real tree is at or below its baseline, and every counted file is recorded", () => {
	const { scanned, counts, failures } = runCheck();
	assert.ok(scanned.size > 1000, `scanned only ${scanned.size} files`);
	assert.deepEqual(
		failures,
		[],
		`findings: ${failures.map((finding) => finding.path).join(", ")}`,
	);
	/*
	 * The honesty invariant, in both directions: no stale zero ceiling (an
	 * entry whose file no longer has literals) and no uncounted entry (a file
	 * with literals that nobody recorded). The first is a ceiling no slice
	 * lowers; the second is the silence this gate now refuses to produce.
	 */
	assert.deepEqual(
		Object.keys(counts).sort(),
		Object.keys(loadBaseline(BASELINE).files).sort(),
	);
});

test("--update lowers a ceiling, and refuses every raise", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-update-"));
	try {
		const baselinePath = join(dir, "baseline.json");
		/*
		 * Two real, counted files outside any in-flight extraction, so the harness
		 * is not coupled to a migration's progress: a file whose literals were all
		 * keyed stops being "a file `--update` can lower", and the assertion that
		 * pinned this to the agent-hub details page failed exactly that way when
		 * its last sixteen literals were extracted.
		 *
		 * 99 sits above the lower target's real count so the update has something
		 * to lower; the raise target is recorded at 1 while the tree carries more,
		 * so the raise is refused and its entry stays intact.
		 */
		const lowerTarget =
			"src/renderer/src/features/chat/components/message-item/error-block.tsx";
		const raiseTarget =
			"src/renderer/src/features/chat/components/mermaid-diagram.tsx";
		saveBaseline(baselinePath, { [lowerTarget]: 99, [raiseTarget]: 1 }, "note");
		const options = { baselinePath, allowlistPath: ALLOWLIST };
		assert.equal(main(["--update", lowerTarget], options), 0);
		assert.equal(loadBaseline(baselinePath).files[lowerTarget], 18);
		// A file recorded at 1 while the tree carries 15: refused, entry intact.
		assert.equal(main(["--update", raiseTarget], options), 1);
		assert.equal(loadBaseline(baselinePath).files[raiseTarget], 1);
		// The preceding refusal proves raiseTarget still has literals. Remove
		// only its scratch-baseline entry to exercise the missing-entry case;
		// a translated product file may legitimately have zero literals now.
		const afterRaise = loadBaseline(baselinePath);
		delete afterRaise.files[raiseTarget];
		saveBaseline(baselinePath, afterRaise.files, "note");
		assert.equal(main(["--update", raiseTarget], options), 1);
		assert.equal(
			Object.hasOwn(loadBaseline(baselinePath).files, raiseTarget),
			false,
		);
		// A clean file with no entry: nothing to do, no refusal.
		assert.equal(main(["--update", "src/i18n/index.ts"], options), 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Run `fn` with stdout captured, returning its exit code and the text. */
function captureStdout(fn) {
	const chunks = [];
	const write = process.stdout.write;
	process.stdout.write = (chunk) => {
		chunks.push(String(chunk));
		return true;
	};
	try {
		return { code: fn(), out: chunks.join("") };
	} finally {
		process.stdout.write = write;
	}
}

test("--init --force reports added, raised, lowered and pruned files", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-init-"));
	try {
		const baselinePath = join(dir, "baseline.json");
		const { counts } = runCheck();
		const rels = Object.keys(counts).sort();
		/*
		 * A scratch baseline that exercises each branch at once: one counted file
		 * missing (that is the `added` case), one entry below its count, one above,
		 * and one entry for a file with no literals (pruned).
		 */
		const [added, raised, lowered] = rels;
		const files = { ...counts };
		delete files[added];
		files[raised] = Math.max(0, counts[raised] - 1);
		files[lowered] = counts[lowered] + 2;
		files["src/i18n/gone.tsx"] = 4;
		saveBaseline(baselinePath, files, "note");

		const { code, out } = captureStdout(() =>
			main(["--init", "--force"], { baselinePath, allowlistPath: ALLOWLIST }),
		);
		assert.equal(code, 0);
		assert.ok(out.includes("added 1:"), out);
		assert.ok(out.includes("raised 1:"), out);
		assert.ok(out.includes("lowered 1:"), out);
		assert.ok(out.includes("pruned 1:"), out);
		assert.ok(out.includes(`  ${added}: ${counts[added]}`), out);
		assert.ok(
			out.includes(
				`  ${raised}: ${Math.max(0, counts[raised] - 1)} -> ${counts[raised]}`,
			),
			out,
		);
		assert.ok(
			out.includes(
				`  ${lowered}: ${counts[lowered] + 2} -> ${counts[lowered]}`,
			),
			out,
		);
		assert.ok(out.includes("  src/i18n/gone.tsx: 4 -> 0"), out);
		// The capture is the tree, not the seeded scratch baseline, and it
		// stamps the current note rather than inheriting stale prose.
		const captured = loadBaseline(baselinePath);
		assert.deepEqual(captured.files, counts);
		assert.equal(captured.note, BASELINE_NOTE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * THE ONBOARDING COPY'S CALL-SITE BINDING (UI slice 2, rounds R1-1/R2).
 *
 * These checks reuse this suite's existing `fixtureApi.snapshot` for their
 * call-site binding; `onboarding-i18n-contract.test.mjs` remains API-free
 * and owns the independent value pins and render assertions. That is the
 * observable structure, NOT a demonstrated CI cure or causal diagnosis:
 * the Linux Desktop job still exceeded its execution ceiling after this
 * relocation (local-operator-ui #1002).
 *
 * WHAT IT BINDS, with the counterexamples that motivated each shape: every
 * key must be the literal argument of a REAL `t()` call in its wiring file
 * (comments cannot appear in an AST); plain messages take no second
 * argument; parameterised messages bind the exact producer expressions;
 * the greeting branches bind to the `oweGreeting` conditional's two arms;
 * the acquisition call sits inside the element whose live `href` is
 * `credential.url`; the modal's titles flow through `stepTitles`; the plan's
 * block reasons sit in the `catalogueHasModels` / `catalogue.ready`
 * branches. Value pins and the live-render layer stay in
 * `scripts/onboarding-i18n-contract.test.mjs`.
 */

const ONBOARDING_BASE = "src/renderer/src/features/onboarding/components/";

/** key -> [committed English, wiring file] (the values serve the param split). */
const BINDING = [
	[
		"ui.onboarding.connect.intro",
		"Local Operator needs an AI account to work. Radient is the easiest: one browser sign-in and nothing to paste. Already pay for ChatGPT or Claude? Sign in with that instead. Anything else is under More providers.",
		"steps/connect-provider-step.tsx",
	],
	[
		"ui.onboarding.default_model.block.loading_models",
		"Loading the model list…",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.block.pick_a_model",
		"Pick a model to continue.",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.change",
		"Change",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.connected_pick",
		"{brand} is connected. Pick the model new chats should use.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.empty_helper",
		"No providers are connected yet. Go back a step to connect one.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.fallback_name",
		"{brand}'s default model",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.intro",
		"New chats use this model. Every agent can pick a different one later.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.loading",
		"Loading your models",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.none_connected",
		"No provider is connected yet. Go back to connect one, or skip setup and connect one later from the chat.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		"Nothing will be saved: your Local Operator can't list {brand} models yet, so setup finishes without a default model. Pick one in Settings before your first message.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.provider_fallback",
		"this provider's",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.applied",
		"your default",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.suggested",
		"suggested for your account",
		"steps/default-model-step.tsx",
	],
	["ui.onboarding.dialog.setup", "Setup", "onboarding-dialog.tsx"],
	[
		"ui.onboarding.extras.greeting_done",
		"{name} is your chief of staff. Her conversation is where you pick up with her, and it is one keystroke away in the sidebar. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.greeting_owed",
		"{name} is your chief of staff. She will say hello first, ask what to call you and what you would like help with, and show you around. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.next_meet",
		"Next: meet {name}",
		"steps/extras-step.tsx",
	],
	["ui.onboarding.modal.action.back", "Back", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.continue", "Continue", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.finish", "Finish", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.meet", "Meet {name}", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.skip", "Skip", "onboarding-modal.tsx"],
	[
		"ui.onboarding.modal.action.skip_for_now",
		"Skip for now",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.action.skip_to_chat",
		"Skip to chat",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.error.aida_open_failed",
		"{name}'s conversation could not be opened, so you are in a new chat instead.",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.step_of",
		"Step {current, number} of {total, number}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.steps_total",
		"{total, plural, one {# step} other {# steps}}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.connect_provider",
		"Connect an AI account",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.default_model",
		"Your default model",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras",
		"Web search (optional)",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras_with_name",
		"Web search, then meet {name}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.fallback",
		"First-time setup",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.search.each_key_saved",
		"Each key is saved on your device as soon as you leave its field.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.intro",
		"Agents can look things up while they work — today's prices, this week's news — instead of relying on what the model already knows.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.mode.free", "Free", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.mode.free_detail",
		"Uses a rotating pool of free providers — DuckDuckGo, Tavily's free tier, Exa and Parallel. No key needed; the pool is shared, so searches can be slower at busy times.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys",
		"Add API keys",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys_detail",
		"Bring your own keys for the search providers you use.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.label",
		"Search setup",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.recommended",
		"Recommended",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.get_your",
		"Get your {name}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.not_saved",
		"Not saved — {message}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.placeholder",
		"Paste your API key",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.save_failed",
		"The key could not be saved.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.row.saved", "Saved", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.row.saving",
		"Saving {name}",
		"steps/search-api-step.tsx",
	],
];
/**
 * key -> [[parameter name, exact producer expression source]] for the 12
 * parameterised messages. The expressions are the committed call-site
 * producers, compared as AST slices with whitespace normalised: a comment
 * decoy cannot satisfy a node, and a same-shape wrong producer (a different
 * `brandOf(...)` argument) is a different node.
 */

const PARAM_SITES = [
	["ui.onboarding.modal.title.extras_with_name", [["name", "aidaName"]]],
	["ui.onboarding.modal.action.meet", [["name", "aidaName"]]],
	["ui.onboarding.modal.error.aida_open_failed", [["name", "aidaName"]]],
	[
		"ui.onboarding.modal.step_of",
		[
			["current", "activeIndex + 1"],
			["total", "STEP_SEQUENCE.length"],
		],
	],
	["ui.onboarding.modal.steps_total", [["total", "STEP_SEQUENCE.length"]]],
	["ui.onboarding.extras.next_meet", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_owed", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_done", [["name", "aidaName"]]],
	[
		"ui.onboarding.default_model.connected_pick",
		[["brand", "brandOf(choice.provider)"]],
	],
	[
		"ui.onboarding.default_model.fallback_name",
		[["brand", "choice.provider ? brandOf(choice.provider) : choice.hosting"]],
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		[
			[
				"brand",
				'shownRow ? brandOf(shownRow) : t("ui.onboarding.default_model.provider_fallback")',
			],
		],
	],
	["ui.onboarding.search.row.not_saved", [["message", "message"]]],
	["ui.onboarding.search.row.saving", [["name", "credential.name"]]],
	["ui.onboarding.search.row.get_your", [["name", "credential.name"]]],
];

/** The three titles that flow through the modal's `stepTitles` table. */
const TABLE_KEYS = [
	"ui.onboarding.modal.title.connect_provider",
	"ui.onboarding.modal.title.default_model",
	"ui.onboarding.modal.title.extras",
];

const PLAN_KEYS = {
	"ui.onboarding.default_model.block.pick_a_model": "PICK_A_MODEL_KEY",
	"ui.onboarding.default_model.block.loading_models": "LOADING_MODELS_KEY",
};

const astFiles = [...new Set(BINDING.map(([, , file]) => file))];

const bval = (key) => BINDING.find(([k]) => k === key)[1];
const slug = (s) => s.replace(/\s+/g, "").replace(/,}/g, "}");

const bslice = (sf, node) => sf.text.slice(node.getStart(sf), node.getEnd());

function bwalk(node, visit) {
	if (!node) return;
	visit(node);
	node.forEachChild((child) => bwalk(child, visit));
}

function bsfOf(file) {
	const abs = join(REPO, ONBOARDING_BASE, file);
	return fixtureApi.snapshot
		.getDefaultProjectForFile(abs)
		?.program.getSourceFile(abs);
}

function btCalls(sf) {
	const calls = [];
	bwalk(sf, (node) => {
		if (
			node.kind === SyntaxKind.CallExpression &&
			node.expression?.kind === SyntaxKind.Identifier &&
			node.expression.text === "t" &&
			node.arguments?.[0]?.kind === SyntaxKind.StringLiteral
		) {
			calls.push({ key: node.arguments[0].text, call: node });
		}
	});
	return calls;
}

test("every key is the literal argument of a real t() call (comments cannot satisfy this)", () => {
	for (const file of astFiles) {
		const sf = bsfOf(file);
		assert.ok(sf, `${file}: not parsed by the snapshot`);
		const live = new Set(btCalls(sf).map(({ key }) => key));
		const expected = BINDING.filter(
			([key, , f]) =>
				f === file && !(key in PLAN_KEYS) && !TABLE_KEYS.includes(key),
		).map(([key]) => key);
		assert.deepEqual(
			[...live].sort(),
			expected.slice().sort(),
			`${file}: the live t() key set moved (a key moved into a comment, or an untracked call appeared)`,
		);
	}
});

test("plain messages take no second argument; parameterised messages bind exact producers", () => {
	const byFile = new Map();
	for (const [key, expected, file] of BINDING) {
		if (key in PLAN_KEYS || TABLE_KEYS.includes(key)) continue;
		if (!byFile.has(file)) byFile.set(file, bsfOf(file));
		const call = btCalls(byFile.get(file)).find((c) => c.key === key);
		assert.ok(call, `${key}: no live t() call`);
		const params = PARAM_SITES.find(([k]) => k === key);
		if (!params) {
			assert.equal(
				call.call.arguments.length,
				1,
				`${key}: a plain message grew a second argument`,
			);
			assert.ok(
				/^\{\w+\}/.test(expected) === false && !expected.includes("{"),
				`${key}: a plain expected sentence must not carry placeholders`,
			);
			continue;
		}
		const second = call.call.arguments[1];
		assert.ok(second, `${key}: the parameter object is missing`);
		assert.equal(
			second.kind,
			SyntaxKind.ObjectLiteralExpression,
			`${key}: the second argument is not an object literal`,
		);
		const sf = byFile.get(file);
		const names = second.properties.map((p) => p.name?.text);
		assert.deepEqual(
			names.slice().sort(),
			params[1].map(([name]) => name).sort(),
			`${key}: the parameter names moved`,
		);
		for (const [name, expectedExpr] of params[1]) {
			const prop = second.properties.find((p) => p.name?.text === name);
			const actual = slug(bslice(sf, prop.initializer ?? prop.name));
			assert.equal(
				actual,
				slug(expectedExpr),
				`${key}: ${name} is no longer produced by ${expectedExpr}`,
			);
		}
	}
});

test("the modal's titles flow through the stepTitles table and the plan's blocks through its branches", () => {
	// stepTitles: the table's values ARE the three committed keys.
	const modal = bsfOf("onboarding-modal.tsx");
	let table = null;
	bwalk(modal, (node) => {
		if (
			node.kind === SyntaxKind.VariableDeclaration &&
			node.name?.text === "stepTitles"
		) {
			let init = node.initializer;
			for (
				let i = 0;
				i < 3 &&
				init &&
				init.kind !== SyntaxKind.ObjectLiteralExpression &&
				init.expression;
				i += 1
			)
				init = init.expression;
			table = init;
		}
	});
	assert.ok(table, "the stepTitles table is gone");
	assert.deepEqual(
		table.properties.map((p) => p.initializer?.text).sort(),
		TABLE_KEYS.slice().sort(),
		"the stepTitles table no longer carries the committed keys",
	);
	assert.ok(
		btCalls(modal).length >= 10,
		"the modal's live t() calls thinned out",
	);
	let consumes = false;
	bwalk(modal, (node) => {
		if (
			node.kind === SyntaxKind.CallExpression &&
			node.expression?.kind === SyntaxKind.Identifier &&
			node.expression.text === "t" &&
			node.arguments?.[0]?.kind !== SyntaxKind.StringLiteral &&
			slug(bslice(modal, node.arguments?.[0] ?? node)) === "stepTitles[step]"
		)
			consumes = true;
	});
	assert.ok(
		consumes,
		"the modal stopped rendering titles through t(stepTitles[step])",
	);

	// The plan: constant initialisers + branch-scoped consumption.
	const plan = bsfOf("steps/default-model-plan.ts");
	assert.ok(plan, "the plan source did not resolve in the snapshot");
	const consts = new Map();
	bwalk(plan, (node) => {
		if (
			node.kind !== SyntaxKind.VariableDeclaration ||
			!node.name?.text?.endsWith("_KEY")
		)
			return;
		/*
		 * The initialisers are `"key" as const`: unwrap the assertion - the
		 * committed identity is the STRING, and `as const` is why the value can
		 * flow into `t()` with its literals intact.
		 */
		let init = node.initializer;
		while (
			init &&
			(init.kind === SyntaxKind.AsExpression ||
				init.kind === SyntaxKind.SatisfiesExpression)
		)
			init = init.expression;
		if (init?.kind === SyntaxKind.StringLiteral)
			consts.set(node.name.text, init.text);
	});
	for (const [key, constName] of Object.entries(PLAN_KEYS)) {
		assert.equal(
			consts.get(constName),
			key,
			`${constName} no longer names ${key}`,
		);
	}
	let pickInBranch = false;
	let loadingInBranch = false;
	bwalk(plan, (node) => {
		if (
			node.kind === SyntaxKind.ConditionalExpression &&
			node.condition?.kind === SyntaxKind.Identifier &&
			node.condition.text === "catalogueHasModels"
		) {
			node.whenTrue &&
				bwalk(node.whenTrue, (n) => {
					if (
						n.kind === SyntaxKind.CallExpression &&
						n.expression?.text === "t" &&
						n.arguments?.[0]?.kind === SyntaxKind.Identifier &&
						n.arguments[0].text === "PICK_A_MODEL_KEY"
					)
						pickInBranch = true;
				});
			node.whenFalse &&
				bwalk(node.whenFalse, (n) => {
					if (
						n.kind === SyntaxKind.ConditionalExpression &&
						n.condition?.kind === SyntaxKind.PropertyAccessExpression &&
						slug(bslice(plan, n.condition)) === "catalogue.ready"
					)
						n.whenFalse &&
							bwalk(n.whenFalse, (m) => {
								if (
									m.kind === SyntaxKind.CallExpression &&
									m.expression?.text === "t" &&
									m.arguments?.[0]?.kind === SyntaxKind.Identifier &&
									m.arguments[0].text === "LOADING_MODELS_KEY"
								)
									loadingInBranch = true;
							});
				});
		}
	});
	assert.ok(
		pickInBranch,
		"PICK_A_MODEL_KEY left the catalogueHasModels branch",
	);
	assert.ok(loadingInBranch, "LOADING_MODELS_KEY left the not-ready branch");

	// The greeting branches: owed in the conditional's true arm, done in false.
	const extras = bsfOf("steps/extras-step.tsx");
	let owedTrue = false;
	let doneFalse = false;
	bwalk(extras, (node) => {
		if (
			node.kind === SyntaxKind.ConditionalExpression &&
			node.condition?.kind === SyntaxKind.Identifier &&
			node.condition.text === "oweGreeting"
		) {
			owedTrue = tCallsIn(node.whenTrue).includes(
				"ui.onboarding.extras.greeting_owed",
			);
			doneFalse = tCallsIn(node.whenFalse).includes(
				"ui.onboarding.extras.greeting_done",
			);
		}
	});
	assert.ok(owedTrue, "the owed greeting left the oweGreeting true arm");
	assert.ok(doneFalse, "the delivered greeting left the oweGreeting false arm");

	// The acquisition call sits inside the element whose href is credential.url.
	const search = bsfOf("steps/search-api-step.tsx");
	let anchorBound = false;
	bwalk(search, (node) => {
		if (
			node.kind !== SyntaxKind.JsxElement ||
			!node.openingElement?.attributes?.properties
		)
			return;
		const href = node.openingElement.attributes.properties.find(
			(a) => a.kind === SyntaxKind.JsxAttribute && a.name?.text === "href",
		);
		if (!href) return;
		const expr = href.initializer?.expression;
		if (!expr || slug(bslice(search, expr)) !== "credential.url") return;
		let inside = false;
		bwalk(node, (n) => {
			if (
				n.kind === SyntaxKind.CallExpression &&
				n.expression?.text === "t" &&
				n.arguments?.[0]?.text === "ui.onboarding.search.row.get_your"
			)
				inside = true;
		});
		if (inside) anchorBound = true;
	});
	assert.ok(
		anchorBound,
		"the get-your call is no longer inside an element whose live href is credential.url",
	);
});

/** The t() keys appearing within a node's subtree. */
function tCallsIn(node) {
	const keys = [];
	bwalk(node, (n) => {
		if (
			n.kind === SyntaxKind.CallExpression &&
			n.expression?.kind === SyntaxKind.Identifier &&
			n.expression.text === "t" &&
			n.arguments?.[0]?.kind === SyntaxKind.StringLiteral
		)
			keys.push(n.arguments[0].text);
	});
	return keys;
}
