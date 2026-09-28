#!/usr/bin/env node
/**
 * Aida's sidebar row, the reserved words of `/aida`, and the composer's `/aida`
 * branch — the three surfaces of local-operator-ui PR 1.
 *
 * WHAT THIS FILE IS FOR. The pieces this slice adds are decisions rather than
 * pictures, and each has a failure mode a frame cannot show:
 *
 *   - the ROW's two gates are two different facts (`features.aida` says the
 *     backend has the surface; the read's `enabled` says the install runs her),
 *     and collapsing them either shows a dead control on an install that turned
 *     her off or hides a working one;
 *   - the ROW's placement is a requirement (R3: above Agents, first in the
 *     column), and placement is exactly the property a component refactor moves
 *     without anything failing;
 *   - the RESERVED WORDS are a closed set matched against the WHOLE argument
 *     (`/aida pause and think about it` is a message, not a control), and a
 *     first-token reading would silently swallow the rest of a sentence;
 *   - the open-then-send ORDER is the one this file exists for: the send is
 *     admitted BEFORE the switch because `openSession` commits a validation
 *     window the send store refuses to write through — reverting the order
 *     leaves a `/aida <text>` whose text is eaten by the app's own guard, which
 *     no unit of either half would fail on.
 *
 * HOW EACH PART IS DRIVEN. The pure module (`aida-control.ts`) is bundled and
 * EXECUTED — the rule under test is the shipped rule, not a restatement. The
 * wiring is pinned as source text, the idiom `mesh-tab.test.mjs` and
 * `panel-presentation.test.mjs` use, because these are React-importing modules
 * and this repository's desktop suite has no DOM harness. Comments are stripped
 * before matching the class-bearing lines, so prose about a rule cannot satisfy
 * a pin for it.
 *
 * WHAT THIS FILE DOES NOT PROVE: that the row renders, that a real click opens
 * her conversation, or that the backend serves the route. Those are the driver
 * frames' and QA's subjects — this file pins the decisions those runs lean on.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/aida/aida-control";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { aidaControlFailureCopy, aidaControlReceipt, aidaReservedAction } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

/* ------------------------------------------------------------------- the rule */

test("the reserved words are the WHOLE argument, case-insensitively", () => {
	/*
	 * The three control words (design § 2.5), and the QUIET cases are the ones
	 * that matter: a first-token reading would take `/aida status of my projects`
	 * as a control op and drop the rest of the sentence the user addressed to
	 * her, and it would take `/aida pause` plus a typo'd continuation as a pause
	 * the user never asked for. Both are messages.
	 */
	assert.equal(aidaReservedAction("pause"), "pause");
	assert.equal(aidaReservedAction("resume"), "resume");
	assert.equal(aidaReservedAction("status"), "status");
	assert.equal(aidaReservedAction("  Pause  "), "pause");
	assert.equal(
		aidaReservedAction("pause and think about it"),
		null,
		"a continuation is a message to her, not a control op",
	);
	assert.equal(
		aidaReservedAction("status of my projects"),
		null,
		"only the bare word is the control",
	);
	assert.equal(aidaReservedAction(""), null);
	assert.equal(aidaReservedAction("   "), null);
	assert.equal(
		aidaReservedAction("=pause"),
		null,
		"no escape grammar on this surface: the TUI's `=pause` spelling is not re-derived here",
	);
	assert.equal(aidaReservedAction("paused"), null);
});

test("receipts confirm the op; status only reports", () => {
	const paused = { session_id: "123456abcdef", paused: true, greeted: false };
	const active = { session_id: "123456abcdef", paused: false, greeted: false };
	assert.deepEqual(aidaControlReceipt("pause", active), {
		text: "Aida is paused. She will not check in until you resume her.",
		kind: "success",
	});
	assert.deepEqual(aidaControlReceipt("resume", paused), {
		text: "Aida is resumed. She will check in on her usual schedule.",
		kind: "success",
	});
	/*
	 * The distinction this pins: the SAME state answers `status` and a pause, and
	 * the two sentences must differ — one reports, one confirms. A receipt table
	 * keyed on `state.paused` alone would say "paused" both times.
	 */
	assert.deepEqual(aidaControlReceipt("status", paused), {
		text: "Aida is paused.",
		kind: "info",
	});
	assert.deepEqual(aidaControlReceipt("status", active), {
		text: "Aida is active.",
		kind: "info",
	});
});

test("a failure's sentence travels verbatim when it has one", () => {
	assert.equal(
		aidaControlFailureCopy(new Error("Aida is disabled on this backend.")),
		"Aida is disabled on this backend.",
	);
	assert.equal(
		aidaControlFailureCopy(undefined),
		"Aida's controls could not reach the backend.",
	);
});

/* ------------------------------------------------------------------ the wiring */

const source = (path) => readFileSync(path, "utf8");
/** The file with comment lines removed, for pins that match code. */
const code = (path) =>
	source(path)
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/*")
			);
		})
		.join("\n");

const NAV =
	"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx";
const DISPATCH = "src/renderer/src/features/chat/components/slash-dispatch.ts";
const REGISTRY = "src/renderer/src/features/chat/pickers/picker-registry.tsx";

test("the rail's row is gated twice, and the second gate is the READ's enabled", () => {
	const nav = code(NAV);
	/*
	 * The capability first (fail-closed, like Projects): below it the backend
	 * predates the surface and the UI must not call her route at all.
	 */
	assert.match(
		nav,
		/const aidaEnabled = desktopFeatureEnabled\(\s*capabilities\.data,\s*"aida",\s*1,?\s*\);/,
		"the row's first gate is the capability",
	);
	/*
	 * Then the read's own answer, and it must be `=== true` rather than
	 * `!== false`: an install that turned Aida off (`aida.enabled=false`,
	 * `LOCAL_OPERATOR_NO_AIDA`) answers `enabled: false`, and a row there opens a
	 * conversation nothing creates and answers `409 aida_disabled` on every
	 * press. `!== false` would show it until the read landed — the disabled state
	 * must never render, so the pin is the strict reading.
	 */
	assert.match(
		nav,
		/const aidaVisible = aidaEnabled && aida\.data\?\.enabled === true;/,
		"the row's second gate is the read's `enabled`, strictly",
	);
	assert.match(
		nav,
		/const aida = useAidaTarget\(aidaEnabled\);/,
		"the read is gated on the capability, so the route is never called below it",
	);
});

test("Aida is the FIRST destination, above Agents (R3)", () => {
	const nav = source(NAV);
	const items = nav.indexOf("const navItems: NavItem[] = [");
	const aida = nav.indexOf('tourTag: "nav-item-aida"');
	const agents = nav.indexOf('tourTag: "nav-item-agents"');
	assert.ok(items >= 0 && aida > items, "the row belongs to navItems");
	assert.ok(
		aida < agents,
		"R3: her row sits above Agents — a later insertion would satisfy every other pin here and fail the requirement",
	);
	assert.match(nav, /icon: ChevronsUp,/, "R4's icon");
	assert.match(
		nav,
		/(\n\tChevronsUp,|ChevronsUp,\s*\n)/,
		"and it is imported from lucide-react",
	);
	assert.match(
		nav,
		/label: "Aida",/,
		"the row's own label; the collapsed strip's tooltip reads the same string via renderNavRow",
	);
});

test("the row's press RESOLVES rather than navigates, through the shared opener", () => {
	const nav = code(NAV);
	/*
	 * The one row whose press is not "navigate to `path`": her id is not known
	 * until the desktop route answers, so the row carries `onSelect` and the
	 * button asks it first. Both halves are pinned because either alone is inert:
	 * a row with `onSelect` and a button that ignores it navigates to `/chat`
	 * with nothing open, and a button reading an unset field changes nothing.
	 */
	assert.match(
		nav,
		/onClick=\{\(\) =>\s*item\.onSelect \? item\.onSelect\(\) : navigate\(item\.path\)\s*\}/,
		"the button honours `onSelect` when the row has one",
	);
	assert.match(nav, /onSelect: selectAida,/, "and the row declares it");
	assert.match(
		nav,
		/const openAida = useAidaOpener\(\);/,
		"the press goes through the shared opener rather than a second resolution",
	);
	assert.match(
		nav,
		/void openAida\(navigate, aida\.data\)\.catch\(\(error\) =>\s*\n?\s*showErrorToast\(aidaControlFailureCopy\(error\)\)/,
		"and a failure is stated on the toast lane rather than swallowed (the row owns no other surface)",
	);
});

test("`/aida` is a table destination, with the two predicate answers that follow", () => {
	const registry = code(REGISTRY);
	/*
	 * The destination lives on the TABLE rather than as a string in the
	 * dispatcher, because `destinationNeedsSession` derives from the table: a
	 * destination outside it answers "needs a conversation", which would have the
	 * composer's staged line promise a refusal for a command that then runs.
	 */
	assert.match(registry, /"aida\.open": \{ kind: "aida" \},/);
	assert.match(
		registry,
		/return kind !== "machine-panel" && kind !== "aida";/,
		"the aida kind addresses no conversation, so it joins machine-panel as the second exemption",
	);
});

test("the dispatcher's aida branch: capability fail-closed, and the send before the switch", () => {
	const dispatch = code(DISPATCH);
	const at = dispatch.indexOf('if (entry?.kind === "aida") {');
	assert.ok(at >= 0, "the branch is keyed on the table's kind");
	const branch = dispatch.slice(
		at,
		dispatch.indexOf("if (entry && entry.argsBehavior", at),
	);
	/*
	 * Fail-closed first: with the capability absent the route must not be called,
	 * and the user is told in the capability's own terms.
	 */
	assert.match(
		branch,
		/if \(!aidaCapable\) \{/,
		"the capability is asked before anything is called",
	);
	assert.ok(
		branch.indexOf("needs a newer backend") <
			branch.indexOf("aidaReservedAction"),
		"and its refusal precedes every route call in the branch",
	);
	/*
	 * The reserved words come from the pure module, so the rule is executed by
	 * this suite rather than re-derived here.
	 */
	assert.match(branch, /aidaReservedAction\(argument\)/);
	/*
	 * THE ORDER PIN, and the reason this file exists: the message is admitted
	 * BEFORE the view moves onto her conversation. `openSession` commits a
	 * validation window the send store refuses to write through
	 * (`isSessionUnvalidated`), so `openConversation` first has the app's own
	 * guard eat the text for the whole read window — measured behaviour, not a
	 * preference.
	 */
	const admit = branch.indexOf("admitChatDraft(");
	const open = branch.indexOf("openConversation(");
	assert.ok(admit >= 0, "the text becomes a message");
	assert.ok(
		admit < open,
		`the admission must precede the switch (admit@${admit}, open@${open})`,
	);
	assert.match(
		branch,
		/paneDraftKey\(/,
		"the send lands on the row a pane would write, so the pane that mounts reads the same claim",
	);
	/*
	 * And the read the branch resolves through is gated on the capability: `UI
	 * must not call the route below` (design § 3.4) is true of the READ too.
	 */
	assert.match(
		dispatch,
		/const aida = useAidaTarget\(aidaCapable\);/,
		"the read is gated on the same capability bit as the branch",
	);
});

test("the two ops exist in the shared vocabulary with the route they map to", () => {
	const contract = source("src/shared/desktop-contract.ts");
	assert.match(
		contract,
		/z\s*\n\s*\.object\(\{ op: z\.literal\("aida\.status"\) \}\)\s*\n\s*\.strict\(\),/,
	);
	assert.match(
		contract,
		/action: z\.enum\(\["open", "pause", "resume", "greet", "status"\]\),/,
		"the control op's action vocabulary is closed at the boundary",
	);
	assert.match(
		contract,
		/case "aida\.status":\s*\n\s*return \{ path: "\/v1\/desktop\/aida", method: "GET" \};/,
	);
	assert.match(
		contract,
		/body: \{ op: request\.action \},/,
		"the action travels under the route's own `op` field",
	);
});
