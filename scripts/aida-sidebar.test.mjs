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
		contents: [
			'export * from "./src/renderer/src/features/aida/aida-control";',
			/*
			 * And the pieces the copy test CONSTRUCTS its cases from: the two error
			 * classes whose identity decides what is copy, and the refusal tables the
			 * pairing family is translated through. Exported from the same bundle so
			 * the test builds the real classes rather than lookalikes.
			 */
			'export { DesktopControlError, UserFacingError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { DESKTOP_REFUSAL_CODE, DESKTOP_REFUSAL_SENTENCE } from "./src/shared/desktop-contract";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	aidaControlFailureCopy,
	aidaControlReceipt,
	aidaGreetFailure,
	aidaGreetHeldNotice,
	aidaMessageText,
	aidaReservedAction,
	DesktopControlError,
	DESKTOP_REFUSAL_CODE,
	DESKTOP_REFUSAL_SENTENCE,
	UserFacingError,
} = await import(
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
		"the `=` escape is resolved by `aidaReservedAction` itself; see the escape's own test",
	);
	assert.equal(aidaReservedAction("paused"), null);
});

test("the `=` escape is a message, never a control (cross-host grammar)", () => {
	/*
	 * The TUI's `=pause` spelling, mirrored on this host so both hosts of this one
	 * command read the same grammar (agent review round 1, MINOR-3): the escape
	 * turns the argument back into a message, and the `=` itself never reaches her
	 * — `/aida =pause` is a message ABOUT the word, `/aida =pause now` is the
	 * sentence "pause now", and one leading `=` is exactly what is stripped.
	 */
	assert.equal(
		aidaReservedAction("=pause"),
		null,
		"an escaped word is never the control",
	);
	assert.equal(
		aidaReservedAction("=pause now"),
		null,
		"nor is an escaped continuation",
	);
	assert.equal(aidaMessageText("=pause"), "pause");
	assert.equal(aidaMessageText("=pause now"), "pause now");
	assert.equal(
		aidaMessageText("  =Status of my projects  "),
		"Status of my projects",
	);
	assert.equal(
		aidaMessageText("==pause"),
		"=pause",
		"ONE `=` is the escape; the rest is the message",
	);
	assert.equal(
		aidaMessageText("="),
		"",
		"an escape with nothing behind it is the bare form",
	);
	assert.equal(
		aidaMessageText("pause and think"),
		"pause and think",
		"unescaped text passes through unchanged",
	);
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

test("a failure's copy comes from the app's one copy path, never from the throw", () => {
	/*
	 * The routing the door depends on (agent review round 1, MINOR-1). A runtime
	 * exception's `message` is a stack fragment and a pairing refusal's is the
	 * DAEMON's prose about this app's ownership; neither is copy. EXECUTED here
	 * rather than pinned as source, because the defect was in the answer itself —
	 * the old function echoed `error.message` verbatim, which is the leak.
	 */
	assert.equal(
		aidaControlFailureCopy(new Error("TypeError: fetch failed")),
		"Aida's controls could not reach the backend.",
		"a runtime exception is not copy; the app's own sentence is",
	);
	assert.equal(
		aidaControlFailureCopy(undefined),
		"Aida's controls could not reach the backend.",
	);
	assert.equal(
		aidaControlFailureCopy(
			new UserFacingError("Aida is disabled on this backend."),
		),
		"Aida is disabled on this backend.",
		"an authored refusal travels as written",
	);
	assert.equal(
		aidaControlFailureCopy(
			new DesktopControlError(422, "Aida is disabled on this backend."),
		),
		"Aida is disabled on this backend.",
		"the backend's authored `detail` travels too",
	);
	assert.equal(
		aidaControlFailureCopy(
			new DesktopControlError(
				401,
				"the daemon's own prose about who owns the desktop plane",
				undefined,
				DESKTOP_REFUSAL_CODE.refused,
			),
		),
		DESKTOP_REFUSAL_SENTENCE[DESKTOP_REFUSAL_CODE.refused],
		"a pairing refusal is answered in this app's words, never the daemon's",
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
		/const aidaName = aida\.data\?\.name \?\? "Aida";/,
		"her display name is the payload's, with the shipped default for a backend that predates the field",
	);
	assert.match(
		nav,
		/label: aidaName,/,
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
		/if \(entry\.kind === "machine-panel" \|\| entry\.kind === "aida"\) return false;/,
		"the aida kind addresses no conversation, so it stays an exemption beside machine-panel; issue #625 added the third (the `sessionless` picker opt-in) without touching this one",
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
		branch.indexOf("needs a newer backend") >= 0,
		"the capability's refusal is still there to precede them",
	);
	/*
	 * BOTH INDICES ARE REQUIRED TO EXIST before they are compared (agent review
	 * round 1, MINOR-5): `-1 < n` passes, so a refusal whose text was emptied
	 * would satisfy a bare comparison — the pin could not fail on the change it
	 * exists to catch.
	 */
	const refusalAt = branch.indexOf("needs a newer backend");
	const reservedAt = branch.indexOf("aidaReservedAction");
	assert.ok(
		refusalAt >= 0 && reservedAt >= 0 && refusalAt < reservedAt,
		`the refusal must precede every route call in the branch (refusal@${refusalAt}, reserved@${reservedAt})`,
	);
	/*
	 * The reserved words come from the pure module, so the rule is executed by
	 * this suite rather than re-derived here.
	 */
	assert.match(branch, /aidaReservedAction\(argument\)/);
	/*
	 * And the `=` escape is resolved before the text is sent, in the one module
	 * that defines it (cross-host grammar, MINOR-3) — a send of the raw argument
	 * would deliver the escape character to her.
	 */
	assert.match(branch, /const message = aidaMessageText\(argument\);/);
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
	 * AND A REFUSED TEXT IS NOT LOST (agent review round 1, MINOR-4). The door
	 * consumed the composer line it was typed on, and the store's boundary rule
	 * puts a refusal raised BEFORE the echo was painted with the COMPOSER — so it
	 * must put the text back (through `returnAidaText`, i.e. the composer's own
	 * `returnPayload`) and say what happened. The row-busy `null` is the same
	 * obligation for a door that has no send lock: stated, and handed back on the
	 * same terms, rather than the silence it was.
	 */
	assert.match(branch, /isRefusedBeforeAdmission\(error\)/);
	assert.match(branch, /returnAidaText\(key, target, message\)/);
	assert.match(branch, /if \(admitted === null\)/);
	assert.match(branch, /SEND_FAILURE_COPY\.sendLock/);
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

/*
 * First-run setup's landing (first-run onboarding, U1/A2): "Meet <name>" sends
 * `greet`, and every refusal still lands the user in the chat - what differs is
 * the sentence, keyed on the transport's vetted CODE rather than on the
 * backend's prose. Executed, not pinned as source, for the reason the copy test
 * above gives.
 */
test("first-run greet refusals land in the chat with a sentence keyed on the code", () => {
	const refusal = (status, code) =>
		new DesktopControlError(
			status,
			"backend prose that may change",
			undefined,
			code,
		);
	// 409 aida_no_provider: a fact and its remedy, at info - nothing broke.
	const noProvider = aidaGreetFailure(refusal(409, "aida_no_provider"), "Ada");
	assert.equal(noProvider.kind, "info");
	assert.match(
		noProvider.text,
		/^Ada will say hello once an AI account is connected/,
	);
	// 409 aida_disabled: silence - setup does not advertise a switched-off feature.
	assert.equal(aidaGreetFailure(refusal(409, "aida_disabled"), "Ada"), null);
	// Anything else: an error that says where the user is, through the one copy path.
	const other = aidaGreetFailure(new Error("TypeError: fetch failed"), "Ada");
	assert.equal(other.kind, "error");
	assert.match(
		other.text,
		/^Ada's conversation could not be opened, so you are in a new chat instead\./,
	);
	assert.doesNotMatch(other.text, /TypeError/);
	// A paused Aida opens her conversation and says why she has not spoken yet;
	// an active or already-greeted one says nothing extra.
	assert.match(
		aidaGreetHeldNotice({ paused: true, greeted: false }, "Ada"),
		/\/aida resume/,
	);
	assert.equal(
		aidaGreetHeldNotice({ paused: false, greeted: false }, "Ada"),
		null,
	);
	// Older backend, no ledger: `greeted` is the frozen spelling of "settled", so
	// a pause over a hello she has ALREADY said owes the user nothing.
	assert.equal(
		aidaGreetHeldNotice({ paused: true, greeted: true }, "Ada"),
		null,
	);

	/*
	 * THE ADDITIVE FIELDS (the contract code review round 1 handed over). `held`
	 * is the owner outcome - a live session on this machine carries the greeting
	 * out - so the notice says WHERE it will arrive rather than leaving the user
	 * watching this window for it. A 200, never a refusal, and absent on an older
	 * backend (where it must not be read as `false`).
	 */
	assert.match(
		aidaGreetHeldNotice({ paused: false, greeted: false, held: true }, "Ada"),
		/is already open in another window/,
	);
	assert.equal(
		aidaGreetHeldNotice({ paused: false, greeted: false }, "Ada"),
		null,
	);
	/*
	 * And the ledger's settled states beat `paused`: `delivered`/`skipped` are
	 * terminal, so a pause over either must not promise a hello that will never
	 * come.
	 */
	for (const greeting_state of ["delivered", "skipped"]) {
		assert.equal(
			aidaGreetHeldNotice(
				{
					paused: true,
					greeted: greeting_state === "delivered",
					greeting_state,
				},
				"Ada",
			),
			null,
			`a ${greeting_state} greeting must not be re-promised`,
		);
	}
	// Unsettled and unpaused is the ordinary "she is about to speak" path.
	assert.equal(
		aidaGreetHeldNotice(
			{ paused: false, greeted: false, greeting_state: "armed" },
			"Ada",
		),
		null,
	);
});

test("setup's last step greets through the control op, never before the press", () => {
	/*
	 * A SHAPE pin, the same bargain `onboarding-step-block.test.mjs` strikes for
	 * this modal: rendering it needs a store, a dialog and a query client to
	 * assert one call. What matters, and what this holds: `greet` is sent from the
	 * press handler (attended - the operator's rule that the greeting is never
	 * requested by a background launch), its session id is what the conversation
	 * opens on, and the switch goes through the shared rule.
	 */
	const modal = readFileSync(
		"src/renderer/src/features/onboarding/components/onboarding-modal.tsx",
		"utf8",
	);
	assert.match(modal, /const state = await aidaControl\("greet"\);/);
	assert.match(modal, /openConversation\(navigate, state\.session_id\)/);
	assert.equal(
		modal.split('aidaControl("greet")').length - 1,
		1,
		"one greet call site: the press",
	);
	// Inside the press handler and nowhere else: the greet call sits between
	// `const meetAida = useCallback(` and the next hook, which is a press.
	const handler = modal.indexOf("const meetAida = useCallback(");
	const greet = modal.indexOf('aidaControl("greet")');
	assert.ok(handler >= 0 && greet > handler, "greet is not inside meetAida");
	assert.ok(
		modal.indexOf("}, [", handler) > greet,
		"greet must not be sent from an effect - that is a launch, not a press",
	);
	assert.match(
		modal,
		/await meetAida\(\)/,
		"the last step's primary press calls it",
	);
});
