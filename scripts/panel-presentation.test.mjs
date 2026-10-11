import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

/*
 * The panels that need no conversation, and the ONE predicate that says so.
 *
 * `/info` and `/analytics` must run with no open conversation, and a panel must
 * be viewable from a page that is not chat. Both are properties of a split that
 * this repository cannot assert by rendering it here: the registry is what decides
 * which destinations need a pane, the dispatcher is what refuses, the composer is
 * what promises the refusal one keystroke earlier, and the palette is what routes.
 * Four places, one answer — and the failure mode when one of them disagrees is not
 * a crash: it is a composer that promises "needs an open conversation" for a
 * command that then runs, or a palette row that closes and opens nothing.
 *
 * Read off the sources rather than bundled, the way `palette-contract.test.mjs`
 * reads its two chords and for the same reason: the question is whether the
 * wiring exists at all, and bundling a React-importing module into a node test
 * would answer a question about this repository's modules with a question about
 * its bundler. `scripts/palette-panel-request.test.mjs` executes the one piece
 * that is genuinely pure (the store and its claim).
 *
 * Comments are stripped before matching so a commented-out call cannot satisfy a
 * pattern, and neither can prose ABOUT the pattern — several of these files
 * discuss the gate in their comments, which is where the design's citations point.
 */

const read = (path) => readFileSync(path, "utf8");

const code = (path) =>
	read(path)
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

const REGISTRY = "src/renderer/src/features/chat/pickers/picker-registry.tsx";
const DISPATCH = "src/renderer/src/features/chat/components/slash-dispatch.ts";
const PICKERS =
	"src/renderer/src/features/chat/pickers/destination-pickers.tsx";
const INPUT = "src/renderer/src/shared/components/composer/message-input.tsx";
const PALETTE =
	"src/renderer/src/features/command-palette/components/command-palette.tsx";
const SOURCES =
	"src/renderer/src/features/command-palette/use-palette-sources.ts";
const OUTLET = "src/renderer/src/features/chat/pickers/panel-outlet.tsx";
const STORE = "src/renderer/src/shared/store/panel-presentation-store.ts";
const HOST = "src/renderer/src/features/chat/pickers/picker-host.tsx";
const SLASH_COMMANDS =
	"src/renderer/src/features/chat/components/slash-commands.tsx";
const APP = "src/renderer/src/app.tsx";

test("the three machine panels are declared as one kind on the table", () => {
	const registry = code(REGISTRY);
	for (const destination of ["info", "usage", "analytics"]) {
		assert.match(
			registry,
			new RegExp(`${destination}:\\s*\\{\\s*kind:\\s*"machine-panel"`),
			`\`${destination}\` must resolve through the registry as a \`machine-panel\`; a name list in the dispatcher would be a second answer to "what does this destination need"`,
		);
	}
	/*
	 * The counter-case, and it is the load-bearing one: `/session` reads a
	 * conversation, so it must NOT be in this kind. A widened set here would put a
	 * session-scoped panel behind a host that has no session to scope it to.
	 */
	assert.match(
		registry,
		/session\.diagnostics":\s*\{\s*kind:\s*"picker"/,
		"`session.diagnostics` reports on a conversation and must keep the pane-only `picker` kind",
	);
});

test("destinationNeedsSession is defined once, on the table", () => {
	const registry = code(REGISTRY);
	assert.match(
		registry,
		/export function destinationNeedsSession\(\s*destination: string \| undefined,?\s*\): boolean/,
		"the predicate must be exported from the destination table",
	);
	/*
	 * The definition itself, not only its name: it answers `true` for a destination
	 * the table has no row for, which is the same answer the dispatcher's gate gives
	 * an unknown destination. A body that returned `false` there would let an
	 * unrouted command through the gate.
	 */
	assert.match(
		registry,
		/const entry = DESTINATIONS\[destination\];/,
		"the entry is read off the table, so a destination the table has no row for reads `undefined` rather than a name list",
	);
	assert.match(
		registry,
		/if \(!entry\) return true;/,
		"a destination the table has no row for answers `true`: the same refusal the dispatcher's gate gives it",
	);
	assert.match(
		registry,
		/if \(entry\.kind === "machine-panel" \|\| entry\.kind === "aida"\) return false;/,
		"the two KINDS that address no conversation stay exempt - a machine panel describes the machine, and `/aida` OPENS her conversation",
	);
	assert.match(
		registry,
		/return !\(entry\.kind === "picker" && entry\.sessionless === true\);/,
		"and the picker side has its own per-row exemption (issue #625): only a row carrying the measured `sessionless` opt-in is presentable on a pane with none",
	);
});

test("the five sessionless pickers carry the opt-in, and only they do", () => {
	const registry = code(REGISTRY);
	/*
	 * Issue #625, the slice design § 12.5 set aside as "one table row each when
	 * they are wanted": `/help`, `/theme`, `/login`, `/logout` and `/resume`
	 * present on a pane with no conversation. Each is pinned by its full row —
	 * id, kind, component, flag — so a row that lost the opt-in, swapped its kind
	 * or handed the flag to a neighbour fails BY NAME rather than by count.
	 */
	for (const [id, row] of [
		[
			"commands",
			/commands:\s*\{\s*kind:\s*"picker",\s*component:\s*HelpPalette,\s*sessionless:\s*true/,
		],
		[
			"sessions.resume",
			/"sessions\.resume":\s*\{\s*kind:\s*"picker",\s*component:\s*ResumePicker,\s*sessionless:\s*true/,
		],
		[
			"appearance",
			/appearance:\s*\{\s*kind:\s*"picker",\s*component:\s*ThemePicker,\s*sessionless:\s*true/,
		],
		[
			"auth.login",
			/"auth\.login":\s*\{\s*kind:\s*"picker",\s*component:\s*LoginPicker,\s*sessionless:\s*true/,
		],
		[
			"auth.logout",
			/"auth\.logout":\s*\{\s*kind:\s*"picker",\s*component:\s*LogoutPicker,\s*sessionless:\s*true/,
		],
	]) {
		assert.match(
			registry,
			row,
			`\`${id}\` must carry the opt-in on its own row`,
		);
	}
	/*
	 * The count, because the row pins above cannot see a SIXTH row quietly
	 * joining the set: five measured rows, five occurrences — an edit that marks
	 * another destination has to come back through this file.
	 */
	const flagged = registry.match(/sessionless:\s*true/g) ?? [];
	assert.equal(
		flagged.length,
		5,
		`exactly the five measured rows carry the opt-in; found ${flagged.length}`,
	);
	/*
	 * The counter-cases: neighbours that read `sessionId` themselves and must
	 * keep refusing on a pane with none. A widened kind — or a copy of the flag
	 * beside the predicate — puts a picker that reads the session in front of an
	 * empty id, which is the defect this opt-in exists NOT to introduce.
	 */
	for (const [id, row] of [
		["skills", /skills:\s*\{[^}]*sessionless/],
		["mcp", /mcp:\s*\{[^}]*sessionless/],
		["sessions.reload", /"sessions\.reload":\s*\{[^}]*sessionless/],
		["session.diagnostics", /"session\.diagnostics":\s*\{[^}]*sessionless/],
	]) {
		assert.doesNotMatch(
			registry,
			row,
			`\`${id}\` reads \`sessionId\` and must not carry the opt-in`,
		);
	}
});

test("exactly four call sites use the predicate, and they are the four that must", () => {
	/*
	 * Design § 14.1: a FIFTH copy of the predicate is the defect this pins. The four
	 * are the dispatcher's gate, the composer's staged line, the composer's Enter
	 * footer and the palette's routing — and each is matched with the call it
	 * belongs to rather than by counting occurrences, because an occurrence can move
	 * to a file where it means nothing.
	 *
	 * The footer joined in round 1's remediation (code review m3): it printed "this
	 * pane needs an open conversation" from the raw pane bit, which is the one
	 * question the predicate exists to centralise — a machine panel runs on a
	 * sessionless pane, so the refusal it promised was one the dispatcher no longer
	 * gives. Unreachable then because no machine panel declares a staging route; a
	 * false promise the moment one does.
	 */
	assert.match(
		code(DISPATCH),
		/if \(destinationNeedsSession\(spec\.destination\)\) \{/,
		"the dispatcher's refusal must be asked of the predicate rather than of `sessionId` alone",
	);
	assert.match(
		code(INPUT),
		/destinationNeedsSession\(row\.command\.destination\)/,
		"the composer's staged line must fold the predicate in, or it prints the refusal the dispatcher no longer gives",
	);
	assert.match(
		code(SLASH_COMMANDS),
		/paneHasSession: destinationNeedsSession\(activeDestination\)/,
		"the Enter footer's pane clause must be folded with the same predicate the note and the dispatcher read",
	);
	const palette = code(PALETTE);
	assert.match(
		palette,
		/destinationNeedsSession\(destination\)/,
		"the palette must route to chat only for a destination that needs a session",
	);
	assert.match(
		palette,
		/if \(\s*destinationNeedsSession\(destination\) &&\s*!location\.pathname\.startsWith\("\/chat"\)\s*\)/,
		"the route move must be guarded by the predicate AND the current route",
	);
});

test("the dispatcher presents a flagged picker with no session, and posts nothing", () => {
	const dispatch = code(DISPATCH);
	/*
	 * Issue #625: on a pane with no conversation the sessionless picker rows are
	 * presented DIRECTLY — the same agreement the machine panels already have —
	 * instead of the refusal, and without an owner round trip (there is no
	 * session for a POST path to name). The pins are positional: the presenter is
	 * declared; the gate calls it after the refusal; and the machine-panel call
	 * beside it is intact, because that behavior is deliberately unchanged.
	 */
	const presenterAt = dispatch.indexOf("const presentSessionlessPicker = (");
	assert.ok(
		presenterAt >= 0,
		"the sessionless presenter exists as its own named function — removing it must come back through this file",
	);
	const gateOpen = dispatch.indexOf("if (!sessionId) {", presenterAt);
	assert.ok(
		gateOpen > presenterAt,
		"the gate follows the presenter declaration",
	);
	const gateEnd = dispatch.indexOf(
		'if (entry?.kind === "machine-panel") {',
		gateOpen,
	);
	assert.ok(
		gateEnd > gateOpen,
		"the gate closes before the with-session machine-panel branch",
	);
	const gate = dispatch.slice(gateOpen, gateEnd);
	assert.match(
		gate,
		/if \(destinationNeedsSession\(spec\.destination\)\) \{/,
		"the gate still asks the predicate first",
	);
	const refusalAt = gate.indexOf("needs an open conversation");
	const presentAt = gate.indexOf("presentSessionlessPicker(spec, args);");
	assert.ok(
		refusalAt >= 0 && presentAt >= 0 && refusalAt < presentAt,
		`the refusal precedes the presenter (refusal@${refusalAt}, presenter@${presentAt}), so a destination the predicate did not exempt keeps its own sentence`,
	);
	assert.match(
		gate,
		/if \(entry\?\.kind === "picker"\) \{\s*presentSessionlessPicker\(spec, args\);\s*return "consumed";\s*\}/,
		"a picker kind that passed the predicate presents directly rather than falling into the machine-panel presenter",
	);
	assert.match(
		gate,
		/presentMachinePanel\(spec, args, ""\);/,
		"the machine panels keep their sessionless presenter, unchanged",
	);
	const presenter = dispatch.slice(presenterAt, gateOpen);
	assert.match(presenter, /session_id: ""/, "the action addresses no session");
	assert.match(
		presenter,
		/spec: draftPickerSpec\(spec\.destination, commandsQuery\.data\)/,
		"the spec resolves through the table like the other presenters",
	);
	assert.match(
		presenter,
		/sessionId: ""/,
		"the pane context hands the adapters an empty id, which is the honest one",
	);
	assert.ok(
		!/sessions\.command|desktopResult/.test(presenter),
		"NO owner round trip: the sessionless path posts nothing — the machine-panel branch's own rationale",
	);
});

test("the predicate has one definition and exactly four call sites, repo-wide", () => {
	/*
	 * Design § 14.1, stated as a count rather than as separate matches: a FIFTH copy
	 * of the predicate — a second `Set` of names, a second `sessionId ? …` term — is
	 * the defect this test exists to prevent, and the failure it causes is silent in
	 * both directions (a composer promising a refusal that no longer happens, or one
	 * that never prints it for a command that will be refused).
	 *
	 * Walked rather than listed, because the point is the whole renderer: a new
	 * file that re-derives the answer must fail this test, and a test that named
	 * the files it knows about could not do that.
	 */
	const files = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = `${directory}/${entry.name}`;
			if (entry.isDirectory()) walk(path);
			else if (/\.tsx?$/.test(entry.name)) files.push(path);
		}
	};
	walk("src/renderer/src");

	const definitions = [];
	const callers = [];
	for (const path of files) {
		const source = code(path);
		if (/export function destinationNeedsSession\(/.test(source)) {
			definitions.push(path);
		}
		if (
			source.includes("destinationNeedsSession(") &&
			!definitions.includes(path)
		) {
			callers.push(path);
		}
	}
	assert.deepEqual(
		definitions,
		[REGISTRY],
		`the predicate must be defined once, on the destination table; found ${definitions.join(", ")}`,
	);
	for (const path of [DISPATCH, INPUT, SLASH_COMMANDS, PALETTE]) {
		assert.ok(
			callers.includes(path),
			`\`${path}\` is one of the four call sites and must ask the predicate`,
		);
	}
	assert.equal(
		callers.length,
		4,
		`exactly four call sites (the dispatcher's gate, the composer's staged line, the composer's Enter footer, the palette's routing); found ${callers.join(", ")}`,
	);
});

test("PickerOutlet maps a machine panel down to exactly its own context", () => {
	const registry = code(REGISTRY);
	/*
	 * Design § 14.3: `{action, sessionId, frontend, onClose}` and nothing else. The
	 * pane's `note`, `commands`, `dispatch`, `rebind` and `draft` are the pane's own
	 * handles, and a machine panel's contract does not mention them — passing one
	 * would oblige the shell host to invent a value for a field that writes into a
	 * transcript it does not have.
	 */
	assert.match(
		registry,
		/if \(entry\.kind === "machine-panel"\) \{/,
		"the pane keeps presenting the machine panels, with its conversation half intact",
	);
	for (const field of [
		"action={context.action}",
		"sessionId={context.sessionId}",
	]) {
		assert.ok(
			registry.includes(field),
			`PickerOutlet's machine-panel branch must pass \`${field}\` explicitly`,
		);
	}
	assert.match(
		registry,
		/frontend=\{context\.canonical\.frontend \?\? null\}/,
		"`frontend` must be mapped down from the handle rather than passed as the handle",
	);
	assert.match(
		registry,
		/onClose=\{context\.onClose\}/,
		"the machine panel closes through the pane's own close path",
	);
	assert.match(
		registry,
		/export function machinePanelFor\(/,
		"the shell host and the pane must resolve a component through the same table accessor",
	);
});

test("the shell host asks the store's decision, and acts on every answer", () => {
	const outlet = code(OUTLET);
	/*
	 * The SEQUENCE lives in `shellHostAction` (the store) and is executed in
	 * `palette-panel-request.test.mjs`; what is pinned here is that this host asks
	 * it, with the two facts only the host has — the destination table's own answer,
	 * and the claim read at the instant the request arrives — and that it acts on
	 * every answer rather than on the two that existed before M1.
	 */
	assert.match(
		outlet,
		/const action = shellHostAction\(\{/,
		"the host must ask the store for the decision rather than chain its own `if`s",
	);
	assert.match(
		outlet,
		/presentable: Boolean\(machinePanelFor\(request\.destination\)\)/,
		"whether this host can present the request must be asked of the destination table",
	);
	assert.match(
		outlet,
		/claimed: usePanelPresentationStore\.getState\(\)\.presenterClaimed/,
		"the claim is read with `getState()` — a fact about the moment the request ARRIVES, not a subscribed value that would re-run this effect when a claim flips",
	);
	assert.match(
		outlet,
		/if \(action === "yield"\) \{\s*setPanel\(null\);\s*return;\s*\}/,
		"a request this host cannot present must make it YIELD — clear its own panel — or the pane's picker opens under a machine panel that never clears (code review round 1, M1)",
	);
	assert.match(
		outlet,
		/if \(action === "retire"\) \{/,
		"an expired request is retired rather than acted on",
	);
	assert.match(
		outlet,
		/if \(action !== "present"\) return;/,
		"`hold` is the pane's answer to give, so the host must do nothing for it",
	);
	assert.match(
		outlet,
		/sessionId=""/,
		'`""` is how a machine panel is told there is no conversation in front of the user',
	);
	assert.match(
		outlet,
		/frontend=\{null\}/,
		"the shell has no canonical handle to read conversation facts from",
	);
	assert.match(
		outlet,
		/request\.invoker \?\?/,
		"the invoker rides on the request, because the palette's own search field unmounts in the same commit (UX round 1, U1)",
	);
	assert.match(
		code(APP),
		/<PanelOutlet \/>/,
		"the shell host must be mounted at the shell, not inside the chat route",
	);
	assert.match(
		code(STORE),
		/export function shellHostAction\(/,
		"the decision must be exported so the sequence can be executed rather than read",
	);
});

test("the pane claims the presentation slot it owns", () => {
	assert.match(
		code(DISPATCH),
		/usePanelPresentationStore\(\s*\(state\) => state\.claimPresenter,?\s*\)/,
		"the dispatcher is the pane's slot owner; it must register the claim",
	);
	assert.match(
		code(DISPATCH),
		/useEffect\(\(\) => claimPresenter\(\), \[claimPresenter\]\)/,
		"the claim is released by the effect's own cleanup, so a dead pane cannot hold the slot",
	);
});

test("the pane presents the conversation a request names, before its own (#739)", () => {
	/*
	 * The consume effect's ONE new decision: `request.sessionId ?? pane's ?? ""`.
	 * Read off the source because the effect is React; what is asserted is the
	 * precedence and that it feeds BOTH places the pickers read the conversation
	 * from - the action and the context - so the two cannot name different
	 * conversations. Everything else the effect hands over stays the pane's, and
	 * `rebind` in particular is still the pane's `openConversation`, which is what
	 * makes completing a fork from a row's menu land on the new fork.
	 */
	const dispatch = code(DISPATCH);
	const start = dispatch.indexOf("const addressed = ");
	assert.ok(
		start >= 0,
		"the consume effect no longer resolves an addressed id",
	);
	const effect = dispatch.slice(start, dispatch.indexOf("}, [", start));
	assert.match(
		effect,
		/const addressed = panelRequest\.sessionId \?\? sessionId \?\? "";/,
		"the precedence is no longer the request's conversation, then the pane's, then none",
	);
	assert.match(
		effect,
		/session_id: addressed,/,
		"the ACTION no longer carries the addressed conversation",
	);
	assert.match(
		effect,
		/\n\s*sessionId: addressed,/,
		"the CONTEXT no longer carries the addressed conversation",
	);
	assert.ok(
		!/session_id: sessionId|\n\s*sessionId: sessionId/.test(effect),
		"a field still substitutes the pane's own session for the request's",
	);
	assert.match(
		effect,
		/\n\s*rebind,/,
		"the pane's rebind is no longer handed over - a fork would complete without opening the child",
	);
	assert.match(
		dispatch,
		/invoker\.current = panelRequest\.sessionId \? panelRequest\.invoker : null;/,
		"a request from outside the pane no longer returns focus to its door (and the palette's must still return none)",
	);
	/*
	 * The store carries the field and the parameters, and only a non-empty id
	 * becomes a key. The cut point rides along by the same rule (#1002):
	 * `entryId` names the transcript entry a destination acts on, and the same
	 * `«spread only when set»` treatment is what keeps a request that names none
	 * byte-identical to the one the palette has always sent.
	 */
	const store = code(STORE);
	assert.match(
		store,
		/sessionId\?: string;/,
		"PanelRequest lost its optional addressed conversation",
	);
	assert.match(
		store,
		/requestPanel: \(\s*destination: string,\s*invoker\?: HTMLElement \| null,\s*sessionId\?: string,\s*facts\?: \{ id\?: string; excerpt\?: string; subjectName\?: string \},?\s*\) => void;/,
		"requestPanel lost a parameter - the request's facts travel as the fourth, as one object",
	);
	/*
	 * THIS IS A SIGNATURE PIN, and deliberately no more (agent review round 1,
	 * N3): a source regex cannot fail for a store that keeps the field and drops
	 * the value, so the BEHAVIOUR - the key present when named, absent when not,
	 * and the label following its target - is asserted against the real store in
	 * `scripts/palette-panel-request.test.mjs`. What this guard adds is the one
	 * thing that file cannot see: that the widening sits in the parameter list a
	 * caller writes against.
	 */
	/*
	 * And the palette is untouched: it never names a conversation, so its request
	 * resolves to the pane's own exactly as before.
	 */
	assert.match(
		code(PALETTE),
		/requestPanel\(destination, returnFocusTo\.current\);/,
		"the palette's request changed shape - it must keep naming no conversation",
	);
});

test("the addressed conversation's own name rides the request into the picker (#920)", () => {
	/*
	 * The second fact a requester outside the pane can hold - the NAME of the
	 * conversation it addressed - and why it must ride the request rather than be
	 * re-derived: the presenter holds a pane, and for a conversation the user
	 * never opened the pane has NO reading of its name at all, so a rename picker
	 * that fell back to the pane's title would open on the WRONG conversation's
	 * name (the asymmetry #920 exists for). Both halves are pinned, because either
	 * one alone regresses silently: a dispatcher that stops threading
	 * `subjectName` into the action leaves the picker seeding from the pane's
	 * title, and a picker that ignores the fact seeds from the pane's even when it
	 * arrived. The behaviour of the store's spread is asserted on the real store
	 * in `scripts/palette-panel-request.test.mjs`, the split the signature pin
	 * above states.
	 */
	assert.match(
		code(DISPATCH),
		/\.\.\.\(panelRequest\.subjectName\s*\?\s*\{ subjectName: panelRequest\.subjectName \}\s*:\s*\{\}\),/,
		"the consume effect no longer threads the addressed conversation's name into the action",
	);
	assert.match(
		code(PICKERS),
		/function readSubjectName\(data: Record<string, unknown>\): string \| null \{/,
		"the rename picker no longer reads the request's subject name defensively",
	);
	assert.match(
		code(PICKERS),
		/action\.args \|\|\s*readSubjectName\(action\.data\) \|\|\s*canonical\.frontend\?\.conversation_title \|\|/,
		"the rename picker no longer prefers the request's subject name over the pane's title",
	);
});

test("the picker host hides the native browser view while it is open", () => {
	/*
	 * A `WebContentsView` paints above all DOM, so a panel opened over `/browser`
	 * would be a dialog the user cannot see. Registered in the one host BOTH
	 * presenters render through, so a picker added later inherits it.
	 */
	assert.match(
		code(HOST),
		/useSuppressBrowserView\(open, "panel-picker"\);/,
		"PickerHost must register with the browser-view policy",
	);
});

test("the palette gates the machine rows on liveness, the credential and a pane", () => {
	const sources = code(SOURCES);
	/*
	 * Two gates, one answer each. The machine rows are gated on liveness AND on
	 * main's own answer about the credential: `/v1/capabilities` is an
	 * unauthenticated route, so `canStageDraft` alone is satisfied by an origin
	 * every other op of ours is refused at, and the row then opens a panel reading
	 * "Desktop authorization is required." per section (QA round 1, Q-1).
	 */
	assert.match(
		sources,
		/if \(!canStageDraft \|\| desktopPlaneRefused\) return \[\];/,
		"the liveness bit is the gate the machine rows keep (a row that could open nothing is the dead control this palette refuses to offer), and the credential term is what keeps an unauthenticated origin from offering one",
	);
	assert.match(
		sources,
		/pairing.available === false/,
		"only main's explicit `false` closes the gate: an absent record is a host with no desktop bridge or an answer still in flight, not a refusal - and the read is the pairing RECORD rather than the boolean beside it, because that boolean was written `true` at every attach and `false` nowhere (design § 1.4, § 5.2)",
	);
	assert.match(
		sources,
		/\.\.\.\(paneCanPresent && sessionPanelsAvailable/,
		"`/session` must keep BOTH gates: it reads a conversation and the pane is its only presenter",
	);
	assert.match(
		sources,
		/destination: "analytics",/,
		"Analytics must be offered outside the pane gate",
	);
});
