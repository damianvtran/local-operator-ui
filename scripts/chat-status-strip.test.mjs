/**
 * The chat pane's one connection surface, executable.
 *
 *     node --test scripts/chat-status-strip.test.mjs
 *
 * The rules live in `chat-status.ts` rather than in the strip's JSX for the
 * reason this repository states everywhere: a decision written as a JSX
 * condition is a decision no test in this suite can reach - the strip reads the
 * connectivity hook and the window bridge, and this repository's desktop suite
 * is `node:test` over `scripts/*.test.mjs`. So the TABLE is imported and driven
 * with its inputs, and the SURFACE's own contract (which region it is, one Retry,
 * the roles, the dismissal) is pinned from the source.
 *
 * WHAT THIS FILE IS GUARDING, in the design round's own terms (D3, §F2): the app
 * mounted TWO bands in the shell root, above the window and over the sidebar,
 * each with its own reading of a lost daemon and its own Retry. §F2 replaces them
 * with one strip inside the pane, one message per root cause, one Retry.
 *
 * WHAT IT CANNOT SAY: that the strip LOOKS right. The wash, the two-line bound
 * and the strip's place in the column are pixels, and the pixels are the rig's
 * job (the status-strip states in the after set, with the geometry assertions
 * beside them).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const STRIP = "src/renderer/src/features/chat/components/chat-status-strip.tsx";
const PANE = "src/renderer/src/features/chat/components/chat-content.tsx";
const APP = "src/renderer/src/app.tsx";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/chat/chat-status";',
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const { CHAT_STATUS_COPY, chatStatusDisplay, chatStatusKey } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const read = (file) => readFileSync(file, "utf8");
const code = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------ the table */

test("each root cause states ONE sentence, and the four are §F2's own", () => {
	assert.equal(
		CHAT_STATUS_COPY.unreachable,
		"Can't reach the Local Operator server. Sending will wait.",
	);
	assert.equal(
		CHAT_STATUS_COPY["credential-refused"],
		"The running server refused this app's credential, so sign-in, settings and slash commands are unavailable.",
	);
	assert.equal(
		CHAT_STATUS_COPY.degraded,
		"The server is answering slowly. Your messages are queued.",
	);
	/*
	 * The row the spec's table does not have, and it is not a fifth root cause:
	 * with the network gone, the server sentence would blame the wrong end of the
	 * wire. The state machine the app reads distinguishes the two
	 * (`connectivityIssue`), so the strip must too.
	 */
	assert.equal(
		CHAT_STATUS_COPY["internet-offline"],
		"This machine is offline. Sending will wait.",
	);
});

test("the four states, their washes, their roles and their one action", () => {
	const at = (over) =>
		chatStatusDisplay({
			connectivityIssue: null,
			server: null,
			internetOffline: false,
			...over,
		});

	/*
	 * `connecting` and `attached` draw NOTHING. The row that matters is the first:
	 * a strip that flashes "can't reach the server" while the app is still finding
	 * out is a strip nobody reads.
	 */
	assert.equal(at({ server: { state: "connecting" } }), null);
	assert.equal(at({ server: { state: "attached" } }), null);
	assert.equal(at({ server: { state: "replaced" } }), null);

	const unreachable = at({
		connectivityIssue: "server_offline",
		server: { state: "detached", detail: null, pairing: null },
	});
	assert.equal(unreachable?.kind, "unreachable");
	assert.equal(unreachable?.wash, "danger-wash");
	assert.equal(unreachable?.role, "alert");
	assert.equal(unreachable?.action, "retry");
	assert.equal(unreachable?.title, CHAT_STATUS_COPY.unreachable);

	/*
	 * `wedged` is the same state on this surface as `detached` - the reader cannot
	 * send either way - and the two are separated by main's own `detail` line,
	 * which is what stops the strip describing a healthy server as a dead one.
	 */
	const wedged = at({
		server: {
			state: "wedged",
			detail: "Another process holds this key.",
			pairing: null,
		},
	});
	assert.equal(wedged?.kind, "unreachable");
	assert.equal(wedged?.detail, "Another process holds this key.");

	const degraded = at({
		server: { state: "degraded", detail: null, pairing: null },
	});
	assert.equal(degraded?.kind, "degraded");
	assert.equal(degraded?.wash, "warning-wash");
	assert.equal(degraded?.role, "status");
	assert.equal(degraded?.action, "retry");

	/*
	 * A re-route in flight is the same surface as a slow server: the connection is
	 * there, and the reader's position is "sending will queue".
	 */
	assert.equal(
		at({
			server: {
				state: "attached",
				reconnecting: true,
				detail: null,
				pairing: null,
			},
		})?.kind,
		"degraded",
	);

	const offline = at({
		connectivityIssue: "internet_offline",
		internetOffline: true,
	});
	assert.equal(offline?.kind, "internet-offline");
	assert.equal(offline?.wash, "warning-wash");
	assert.equal(offline?.dot, "warning");
	/*
	 * NOT drawn until the reading is CONFIRMED - the app's own debounce - because a
	 * single false sample from `navigator.onLine` is a routine event on a laptop
	 * that has just woken up.
	 */
	assert.equal(
		at({ connectivityIssue: "internet_offline", internetOffline: false }),
		null,
	);
});

test("a refused credential outranks every row below it, and never states two causes", () => {
	/*
	 * THE CONTRADICTION THE TWO BANDS HAD, resolved in favour of the actionable
	 * fact: "the daemon's process is gone" describes the ATTEMPT, "the credential
	 * was refused" describes the ANSWER, and when both readings are live the strip
	 * states the second - it is the one the reader can act on - while the first
	 * becomes the detail line or is not shown at all.
	 */
	const both = chatStatusDisplay({
		connectivityIssue: "server_offline",
		server: {
			state: "detached",
			detail: "Pairing was refused by a server that is running.",
			pairing: { available: false, cause: "key-refused" },
		},
		internetOffline: false,
	});
	assert.equal(both?.kind, "credential-refused");
	assert.equal(both?.title, CHAT_STATUS_COPY["credential-refused"]);
	assert.equal(
		both?.detail,
		"Pairing was refused by a server that is running.",
		"the other reading survives as the detail line rather than as a second cause",
	);
	/*
	 * And there is exactly ONE message: the type has one `title`, so a second cause
	 * has nowhere to go but the one detail slot, which is what makes "the app never
	 * shows two root causes at once" a property of the shape rather than a rule
	 * someone has to remember.
	 */
	assert.equal(
		Object.keys(both ?? {}).filter((key) => key === "title").length,
		1,
	);
	/*
	 * The action is Retry rather than §F2's `Sign in`, and that is the code's
	 * departure from the table: the renderer has no sign-in path, and the one act
	 * that re-pairs is the reconnect IPC the compatibility band's own Retry calls.
	 * A control labelled for an act the app cannot perform is the "button that
	 * provably cannot work" this repository refuses to ship.
	 */
	assert.equal(both?.actionLabel, "Retry");
});

test("dismissal is keyed on the state, so a new cause is never muted", () => {
	const unreachable = chatStatusDisplay({
		connectivityIssue: "server_offline",
		server: { state: "detached", detail: null, pairing: null },
		internetOffline: false,
	});
	const offline = chatStatusDisplay({
		connectivityIssue: "internet_offline",
		internetOffline: true,
	});
	const degraded = chatStatusDisplay({
		connectivityIssue: null,
		server: { state: "degraded", detail: null, pairing: null },
		internetOffline: false,
	});
	assert.equal(chatStatusKey(null), null);
	assert.ok(chatStatusKey(unreachable));
	assert.notEqual(chatStatusKey(unreachable), chatStatusKey(degraded));
	assert.notEqual(chatStatusKey(unreachable), chatStatusKey(offline));
	/*
	 * The same kind with a different DETAIL is a different key: a refused
	 * credential after a re-pair is not the fact the reader dismissed.
	 */
	assert.notEqual(
		chatStatusKey(
			chatStatusDisplay({
				connectivityIssue: null,
				server: { state: "wedged", detail: "one", pairing: null },
				internetOffline: false,
			}),
		),
		chatStatusKey(
			chatStatusDisplay({
				connectivityIssue: null,
				server: { state: "wedged", detail: "two", pairing: null },
				internetOffline: false,
			}),
		),
	);
});

/* --------------------------------------------------------- the surface */

test("the strip is one live region, one Retry, and one dismissal", () => {
	const source = code(read(STRIP));
	// The table, not an if-chain in the JSX.
	assert.match(source, /chatStatusDisplay\(/);
	assert.match(source, /chatStatusKey\(/);
	// ONE live region whose role comes from the state rather than from the markup.
	assert.match(source, /role=\{display\.role\}/);
	assert.equal(
		(source.match(/role=\{/g) ?? []).length,
		1,
		"the strip must render exactly one live region",
	);
	/*
	 * ONE Retry, and it is the app's existing act: both bands' Retry already called
	 * this IPC, and the strip inherits it rather than inventing a second route to
	 * the same daemon.
	 */
	assert.match(source, /window\.api\?\.backend\?\.reconnect\?\.\(\)/);
	assert.equal(
		(source.match(/backend\?\.reconnect/g) ?? []).length,
		1,
		"one Retry, one call site",
	);
	// Its progress and its outcome are both in the strip (U7's report was a Retry
	// that did nothing visible).
	assert.match(source, /Retrying…/);
	assert.match(source, /Still unreachable\./);
	// The dismissal is a REAL collapse (a pill that re-expands), not a hide.
	assert.match(source, /data-lo-status-pill=""/);
	assert.match(source, /data-lo-status-strip=""/);
	assert.match(source, /aria-label=\{`Connection status/);
	// And Escape is scoped to the strip's own focus, so it can never be taken from
	// a running turn - §F2's ladder puts the strip below the question card.
	assert.match(source, /event\.key !== "Escape"/);
	assert.doesNotMatch(
		source,
		/window\.addEventListener\("keydown"/,
		"the strip must not take Escape from the window",
	);
	// In flow, in the pane, never positioned over the chrome (D3).
	assert.doesNotMatch(source, /\bfixed\b/);
});

test("the pane owns the status surfaces and the shell root owns none", () => {
	const app = code(read(APP));
	assert.doesNotMatch(app, /<ConnectivityBanner/);
	assert.doesNotMatch(app, /<BackendCompatibilityBanner/);
	const pane = code(read(PANE));
	assert.match(pane, /<ChatStatusStrip \/>/);
	/*
	 * The compatibility band moves WITH it rather than being dropped: it owns the
	 * backend-UPDATE flow - a different fact from the connection, with its own
	 * action - and §F2's four states have no update remedy.
	 */
	assert.match(pane, /<BackendCompatibilityBanner \/>/);
	assert.ok(
		pane.indexOf("<ChatHeader") < pane.indexOf("<ChatStatusStrip />"),
		"the strip sits under the pane's top row, not above it",
	);
});
