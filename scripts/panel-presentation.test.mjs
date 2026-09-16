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
const INPUT = "src/renderer/src/features/chat/components/message-input.tsx";
const PALETTE =
	"src/renderer/src/features/command-palette/components/command-palette.tsx";
const SOURCES =
	"src/renderer/src/features/command-palette/use-palette-sources.ts";
const OUTLET = "src/renderer/src/features/chat/pickers/panel-outlet.tsx";
const HOST = "src/renderer/src/features/chat/pickers/picker-host.tsx";
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
		/return DESTINATIONS\[destination\]\?\.kind !== "machine-panel";/,
		"the predicate must be `kind !== machine-panel`, with no session or route term",
	);
});

test("exactly three call sites use the predicate, and they are the three that must", () => {
	/*
	 * Design § 14.1: a FOURTH copy of the predicate is the defect this pins. The
	 * three are the dispatcher's gate, the composer's staged line and the palette's
	 * routing — and each is matched with the call it belongs to rather than by
	 * counting occurrences, because an occurrence can move to a file where it means
	 * nothing.
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

test("the predicate has one definition and exactly three call sites, repo-wide", () => {
	/*
	 * Design § 14.1, stated as a count rather than as three separate matches: a
	 * FOURTH copy of the predicate — a second `Set` of names, a second
	 * `sessionId ? …` term — is the defect this test exists to prevent, and the
	 * failure it causes is silent in both directions (a composer promising a
	 * refusal that no longer happens, or one that never prints it for a command
	 * that will be refused).
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
	for (const path of [DISPATCH, INPUT, PALETTE]) {
		assert.ok(
			callers.includes(path),
			`\`${path}\` is one of the three call sites and must ask the predicate`,
		);
	}
	assert.equal(
		callers.length,
		3,
		`exactly three call sites (the dispatcher's gate, the composer's staged line, the palette's routing); found ${callers.join(", ")}`,
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

test("the shell host presents only machine panels, only when no pane claims the slot", () => {
	const outlet = code(OUTLET);
	assert.match(
		outlet,
		/if \(usePanelPresentationStore\.getState\(\)\.presenterClaimed\) return;/,
		"the claim is what arbitrates between two mounted hosts",
	);
	assert.match(
		outlet,
		/if \(!machinePanelFor\(request\.destination\)\) return;/,
		"a destination this host cannot present must be LEFT for the pane rather than consumed",
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
		/PANEL_REQUEST_TTL_MS/,
		"an expired request is retired rather than acted on",
	);
	assert.match(
		code(APP),
		/<PanelOutlet \/>/,
		"the shell host must be mounted at the shell, not inside the chat route",
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

test("the palette gates the machine rows on liveness and the session row on a pane", () => {
	const sources = code(SOURCES);
	assert.match(
		sources,
		/if \(!canStageDraft\) return \[\];/,
		"the liveness bit is the gate the machine rows keep (a row that could open nothing is the dead control this palette refuses to offer)",
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
