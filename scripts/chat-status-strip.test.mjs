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

	/*
	 * AND `reconnecting` ALONE IS NOT A REACHABLE SERVER (UX round 1's U3, fixed in
	 * round 2). A daemon whose PROCESS IS GONE is `detached` with a retry in flight,
	 * and this row used to catch it on `reconnecting` and draw the degraded copy over
	 * a dead process - measured in the running app at +14 s after the kill, with the
	 * strip's own Retry answering "Still unreachable" beside it. Both spellings of a
	 * gone server are asserted, because `wedged` is the other one and it is the state
	 * the credential row above does NOT claim.
	 */
	const deadWhileRetrying = at({
		connectivityIssue: "server_offline",
		server: {
			state: "detached",
			reconnecting: true,
			detail: null,
			pairing: null,
		},
	});
	assert.equal(deadWhileRetrying?.kind, "unreachable");
	assert.equal(deadWhileRetrying?.wash, "danger-wash");
	assert.equal(deadWhileRetrying?.title, CHAT_STATUS_COPY.unreachable);
	assert.equal(
		at({
			server: {
				state: "wedged",
				reconnecting: true,
				detail: null,
				pairing: null,
			},
		})?.kind,
		"unreachable",
	);
	/*
	 * The degraded row is still reachable IN ITS OWN RIGHT - the fix narrows the row
	 * rather than deleting it - and no server record at all is still "not connected"
	 * rather than "answering slowly".
	 */
	assert.equal(
		at({ server: { state: "degraded", detail: null, pairing: null } })?.kind,
		"degraded",
	);
	assert.equal(
		at({ connectivityIssue: "server_offline", server: null })?.kind,
		"unreachable",
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

test("a refusal is stated only while its daemon is there, and the absence takes over", () => {
	/*
	 * THE RULING UX ROUND 1's U1 OVERTURNED. This test used to assert the
	 * opposite - that a refused credential outranked a gone process - and the
	 * walk that found U1 measured what that meant in the live app: the daemon was
	 * killed, main's pairing record still said `credential-refused`, and the strip
	 * went on asserting "The daemon is running." to a reader whose only truthful
	 * statement was that nothing answered (the renderer's own log said `Server is
	 * offline` throughout). A refusal is a CURRENT fact or it is nothing:
	 * a daemon that answers and refuses is `wedged` (daemon-status's
	 * `unattachable` arm), and a daemon that is gone is `detached` (the `pid-dead`
	 * and `no-candidate` arms) - so the row is gated on the state, and the absence
	 * falls through to the `unreachable` row below.
	 */
	const refused = (state) =>
		chatStatusDisplay({
			connectivityIssue: state === "detached" ? "server_offline" : null,
			server: {
				state,
				detail:
					"A daemon is running at http://127.0.0.1:18955, but it refused this app's credential for its desktop plane (HTTP 401). The daemon is running.",
				pairing: { available: false, cause: "credential-refused" },
			},
			internetOffline: false,
		});

	/* A daemon that is THERE and refusing: the refusal is the reader's fact. */
	const wedged = refused("wedged");
	assert.equal(wedged?.kind, "credential-refused");
	assert.equal(wedged?.title, CHAT_STATUS_COPY["credential-refused"]);
	/*
	 * And there is exactly ONE message: the type has one `title`, so a second
	 * cause has nowhere to go but the one detail slot, which is what makes "the
	 * app never shows two root causes at once" a property of the shape rather
	 * than a rule someone has to remember.
	 */
	assert.equal(
		Object.keys(wedged ?? {}).filter((key) => key === "title").length,
		1,
	);
	/*
	 * The action is Retry rather than §F2's `Sign in`, and that is the code's
	 * departure from the table: the renderer has no sign-in path, and the one act
	 * that re-pairs is the reconnect IPC the compatibility band's own Retry calls.
	 * A control labelled for an act the app cannot perform is the "button that
	 * provably cannot work" this repository refuses to ship.
	 */
	assert.equal(wedged?.actionLabel, "Retry");

	/* The same record with the daemon GONE: the absence is the fact now. */
	const gone = refused("detached");
	assert.equal(gone?.kind, "unreachable");
	assert.notEqual(
		chatStatusKey(wedged),
		chatStatusKey(gone),
		"the death of the daemon moves the key, so a dismissed strip re-arms (U1)",
	);
});

/*
 * § 0.1's other half: the four causes the COMPATIBILITY BANNER owns leave this
 * surface silent, and so does a record that states no cause at all.
 *
 * WHY THIS IS A TEST AND NOT AN IMPLICATION. The row-1 gate moving from
 * `available === false` to the cause is only half the fix; the other half is
 * that the connection rows must not take over the incident the banner is
 * already stating - measured on the governed scene the repo committed
 * (`docs/evidence/any-daemon-attach/after-frames-other-principal.json`): state
 * `detached` beside cause `governed-elsewhere`, where the unreachable row
 * painted "Can't reach the Local Operator server" as a second band under the
 * banner's own sentence. The states each cause really occurs in are asserted
 * rather than one, since a successor is reachable while attached and the other
 * three are not.
 */
test("the causes the banner owns leave the strip silent, in the states they occur in", () => {
	const at = (cause, state = "attached") =>
		chatStatusDisplay({
			connectivityIssue: null,
			server: { state, detail: null, pairing: { available: false, cause } },
			internetOffline: false,
		});

	for (const cause of [
		"successor",
		"governed-elsewhere",
		"pre-handshake",
		"unpaired",
		null,
	]) {
		for (const state of ["attached", "detached", "wedged"]) {
			assert.equal(
				at(cause, state),
				null,
				`${cause} + ${state}: the strip must not state a cause the banner owns`,
			);
		}
	}

	/*
	 * AND IT CANNOT PASS VACUOUSLY: the SAME state, without a pairing record,
	 * still paints the connection row - which is what makes the silence above a
	 * property of the cause rather than of a fixture that never drew anything.
	 * The last case is the server-gone scene as the live rig recorded it (no
	 * pairing record, `connectivityIssue: server_offline`), where the strip is
	 * the voice § 2.3's `!answered` yield leaves the pane.
	 */
	const bare = (state) =>
		chatStatusDisplay({
			connectivityIssue: null,
			server: { state, detail: null, pairing: null },
			internetOffline: false,
		});
	assert.equal(bare("detached")?.kind, "unreachable");
	assert.equal(
		chatStatusDisplay({
			connectivityIssue: "server_offline",
			server: {
				state: "detached",
				detail: "The daemon's process is gone.",
				pairing: null,
			},
			internetOffline: false,
		})?.kind,
		"unreachable",
	);
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
	 * THE FACT, NOT MAIN'S PROSE (UX round 1's U5). The same kind with a
	 * different DETAIL is the SAME key: main re-spells one unchanged condition
	 * (two spellings of the same refusal, plus a mid-scene refinement), and the
	 * old detail-keyed version voided a reader's dismissal and retired a fresh
	 * Retry outcome on a wording change. A new KIND still moves the key - that is
	 * the re-arm - and the refused/absence pair is asserted in the test above.
	 */
	const wedgedKey = (detail) =>
		chatStatusKey(
			chatStatusDisplay({
				connectivityIssue: null,
				server: { state: "wedged", detail, pairing: null },
				internetOffline: false,
			}),
		);
	assert.equal(wedgedKey("one"), wedgedKey("two"));
	assert.equal(wedgedKey("one"), wedgedKey(null));
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
	// that did nothing visible). The outcome is KIND-AWARE (UX round 1's U2): a
	// refusal's answer speaks the refusal's vocabulary, and the reachability
	// sentence stays for the rows it describes - chosen on the same fact-key the
	// dismissal rides.
	assert.match(source, /Retrying…/);
	assert.match(source, /Still unreachable\./);
	assert.match(
		source,
		/The server is running, but this app's credential is still refused\./,
	);
	assert.match(source, /key\?\.startsWith\("credential-refused"\)/);
	// The dismissal is a REAL collapse (a pill that re-expands), not a hide.
	assert.match(source, /data-lo-status-pill=""/);
	assert.match(source, /data-lo-status-strip=""/);
	assert.match(source, /aria-label=\{`Connection status/);
	/*
	 * The pill's name is the strip's own TWO lines, not the first of them: it carried
	 * `display.title` alone, so dismissing a strip whose second line was Retry's own
	 * outcome dropped the newest fact about the root cause (UX round 1's U12).
	 */
	assert.match(
		source,
		/aria-label=\{`Connection status: \$\{display\.title\}\$/,
	);
	assert.match(source, /outcome \? ` \$\{outcome\}` : ""/);
	/*
	 * And the outcome is RETIRED with the state it was reported against: a sentence a
	 * Retry wrote cannot ride into a state the reader reached later (U5's contradiction,
	 * reached by staleness).
	 */
	assert.match(source, /outcomeKeyRef/);
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
