/**
 * The `Pinned chats` section, executable: the partition, the capability gate, and
 * the pin press's failure path.
 *
 *     node --test scripts/chat-sidebar-pins.test.mjs
 *
 * The operator's ask was "hovering a conversation row reveals a pin icon; clicking
 * pins the conversation; pinned conversations appear in a Pinned chats section
 * above Active Chats; and the state must be the BACKEND's pinned state so pinning
 * in the TUI pins in the app and vice versa."
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, because the split is the whole reason for
 * its shape. The sidebar cannot be rendered in isolation - it reads the router,
 * the canonical-sessions store and the desktop capability hooks - and this
 * repository's desktop suite has no DOM harness, so:
 *
 *   - the PARTITION is exercised for real, by bundling `chat-sections.ts` and
 *     calling it (it is a pure module precisely so this is possible);
 *   - the CAPABILITY GATE is read off the shipped source, in the idiom
 *     `chat-sidebar-selection.test.mjs` established, because "no slot and no
 *     reveal at all" is a fact about the JSX that mounts the control;
 *   - the PRESS is driven against the real store, with only the transport faked,
 *     because the optimistic write, the reconcile and the revert are the store's
 *     own code.
 *
 * What is NOT here, and is deliberately elsewhere: that the section renders, that
 * the reveal happens under a real pointer, and that a pin made in the terminal
 * shows up here. Those are claims about pixels and about two processes sharing one
 * file, and they are answered by the frames and the round trip recorded in the PR
 * (a green assertion about a class string is not evidence that anything moved).
 *
 * NO COMMENT SCANNER HERE, unlike its neighbour, and the reason is that this file
 * never reads a class literal out of a slice that a comment could sit inside: the
 * anchors below are code-only strings (`data-session-pin`, `{pinsEnabled && (`),
 * and a future comment that lands between an anchor and what it reads makes the
 * assertion FAIL loudly rather than pass on a note.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

/*
 * `packages: "external"` keeps bare specifiers bare, so the bundle is written to
 * a real file rather than handed to `import()` as a `data:` URL: nothing resolves
 * a bare specifier from a data URL. From `node_modules/.cache/` it resolves what
 * this process resolves - the same `chat-sections.ts` the renderer ships.
 */
const bundleInto = async (name, contents, extra = {}) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		write: false,
		...extra,
	});
	mkdirSync(join(ROOT, "node_modules/.cache/chat-sidebar-pins"), {
		recursive: true,
	});
	const file = join(
		ROOT,
		"node_modules/.cache/chat-sidebar-pins",
		`${name}.mjs`,
	);
	writeFileSync(file, bundle.outputFiles[0].text);
	return {
		module: await import(pathToFileURL(file).href),
		text: bundle.outputFiles[0].text,
	};
};

const { module: sections } = await bundleInto(
	"sections",
	'export { pinnedRows, unpinnedRows } from "./src/renderer/src/features/chat/chat-sections";',
);
const { pinnedRows, unpinnedRows } = sections;

/** A catalogue row, in the field names the sidebar reads. */
const row = (session_id, over = {}) => ({
	session_id,
	title: `Chat ${session_id}`,
	binding: { agent: null, team: null },
	...over,
});

const ids = (rows) => rows.map((item) => item.session_id);

test("split mode partitions the list: pinned rows move, nothing is copied", () => {
	const rows = [
		row("aaaaaaaaaaaa", { active: true, pinned: true }),
		row("bbbbbbbbbbbb", { active: true }),
		row("cccccccccccc"),
	];
	const pinned = pinnedRows(rows, true);
	const rest = unpinnedRows(rows, true);
	assert.deepEqual(ids(pinned), ["aaaaaaaaaaaa"]);
	assert.deepEqual(ids(rest), ["bbbbbbbbbbbb", "cccccccccccc"]);
	/*
	 * The claim is a PARTITION: every row is in exactly one half. A lift-and-copy
	 * would pass both assertions above and paint one conversation twice in one
	 * scroll region, which is why the set equality is asserted rather than left to
	 * the two lists agreeing today.
	 */
	assert.equal(pinned.length + rest.length, rows.length);
	assert.deepEqual(new Set([...ids(pinned), ...ids(rest)]), new Set(ids(rows)));
});

test("flat mode draws the same partition, not a second copy", () => {
	const rows = [row("aaaaaaaaaaaa", { pinned: true }), row("bbbbbbbbbbbb")];
	assert.deepEqual(ids(unpinnedRows(rows, true)), ["bbbbbbbbbbbb"]);
});

test("zero pins means no section at all", () => {
	// Not "an empty section with a heading" and not "an empty slot": the section is
	// mounted on `pinned.length > 0`, and this is the input that decides it.
	assert.deepEqual(
		pinnedRows([row("aaaaaaaaaaaa"), row("bbbbbbbbbbbb")], true),
		[],
	);
});

test("a filter that excludes a pinned row leaves it out of both halves", () => {
	/*
	 * The component applies the search BEFORE the partition, so the pinned half is
	 * `matching ∩ pinned`. A pinned row the filter excluded must not be kept
	 * "because it is pinned" - it is simply absent from the list it was filtered
	 * out of.
	 */
	const filtered = [row("bbbbbbbbbbbb")];
	assert.deepEqual(pinnedRows(filtered, true), []);
	assert.deepEqual(ids(unpinnedRows(filtered, true)), ["bbbbbbbbbbbb"]);
});

test("the order is the catalogue's own, untouched", () => {
	/*
	 * The wire carries no rank or timestamp beside `pinned`, and the partition must
	 * not invent one: the TUI's `★ Pinned` section is drawn in the catalogue's
	 * order too, so a re-sort here would present one list in two orders across two
	 * surfaces. Deliberately un-sorted input - newest pin first would put `dddd`
	 * ahead of `aaaaaaaaaaaa`.
	 */
	const rows = [
		row("aaaaaaaaaaaa", { pinned: true }),
		row("bbbbbbbbbbbb"),
		row("cccccccccccc", { pinned: true }),
		row("dddddddddddd", { pinned: true }),
	];
	assert.deepEqual(ids(pinnedRows(rows, true)), [
		"aaaaaaaaaaaa",
		"cccccccccccc",
		"dddddddddddd",
	]);
	assert.deepEqual(ids(unpinnedRows(rows, true)), ["bbbbbbbbbbbb"]);
});

test("with the capability absent the partition does not run, so no row is lost", () => {
	/*
	 * The fail-closed half, and the one that is not cosmetic. A capability that
	 * withdrew between an optimistic press and the next list read would leave
	 * `pinned: true` on a row; if `unpinnedRows` partitioned it out while the pin
	 * slot was gone too, the row would be drawn NOWHERE and there would be no
	 * control left to explain why.
	 */
	const rows = [row("aaaaaaaaaaaa", { pinned: true }), row("bbbbbbbbbbbb")];
	assert.deepEqual(pinnedRows(rows, false), []);
	const rest = unpinnedRows(rows, false);
	assert.equal(rest, rows, "the withdrawn path must be a pass-through");
	assert.deepEqual(ids(rest), ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
});

test("the pin slot is mounted inside the capability gate, and nowhere else", () => {
	const source = read(SIDEBAR);
	/*
	 * Exactly one slot in the panel: a second one would be a second place the
	 * affordance could mount outside the gate, which is the failure this asserts
	 * against.
	 */
	assert.equal(
		source.split("data-session-pin").length - 1,
		1,
		"the sidebar declares one session pin control",
	);
	const gated =
		/\{pinsEnabled && \(\s*<button\s+type="button"\s+data-session-pin/.exec(
			source,
		);
	assert.ok(
		gated !== null,
		'the pin control is mounted only as `{pinsEnabled && (<button type="button" data-session-pin …`',
	);
	/*
	 * ...and the section that draws the pinned rows is behind the same value: a
	 * backend without the pin store must not render a heading over rows it cannot
	 * be asked about.
	 */
	assert.match(source, /\{pinned\.length > 0 && \(\s*<section>/);
});

test("the reveal is opacity on a reserved box, so it cannot reflow the row", () => {
	const source = read(SIDEBAR);
	const anchor = source.indexOf("data-session-pin");
	const open = source.indexOf("cn(", anchor);
	const classes = source.slice(open + "cn(".length, source.indexOf(")}", open));
	const values = [...classes.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(
		(match) => match[1] ?? match[2] ?? match[3],
	);
	const tokens = values.flatMap((value) => value.split(/\s+/));
	assert.ok(
		tokens.includes("size-6") && tokens.includes("shrink-0"),
		`the slot's box is declared on the control itself: ${classes}`,
	);
	/*
	 * The reveal moves OPACITY and nothing else. A `hidden`/`w-0` reveal, or
	 * anything that lifts, scales or translates on hover, would either take the
	 * slot out of the layout (so the row reflows under the pointer, which is worse
	 * than no affordance) or spend a motion the branding contract does not have.
	 */
	for (const forbidden of [
		"hidden",
		"w-0",
		"scale-100",
		"translate-x-0",
		"rotate-0",
	]) {
		assert.ok(
			!tokens.includes(forbidden),
			`the pin's reveal declares no \`${forbidden}\`: ${classes}`,
		);
	}
	assert.ok(
		!tokens.some((token) => /^(scale|translate|rotate)-/.test(token)),
		`the reveal scales, translates or rotates: ${classes}`,
	);
	assert.ok(
		tokens.includes("group-hover:opacity-100") &&
			tokens.includes("group-focus-within:opacity-100"),
		`the reveal is a group-hover/group-focus-within opacity step: ${classes}`,
	);
	assert.equal(
		tokens.filter((token) => token === "opacity-0").length,
		1,
		`the control has exactly one rest state to fade out of: ${classes}`,
	);
	assert.ok(
		!tokens.includes("opacity-100"),
		`the revealed value is not the rest value: ${classes}`,
	);
});

/*
 * The press, against the REAL store with only the transport faked.
 *
 * `localStorage` is the store's persistence (zustand's `persist`), and
 * `desktopResult` is the network - everything else here is the shipped module, so
 * the optimistic write, the reconcile against the answer and the revert are all
 * the code under test rather than a restatement of it.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
globalThis.__pinRequest = async () => {
	throw new Error("the test did not arm the transport");
};

const storeBundle = await build({
	stdin: {
		contents:
			'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			/*
			 * The error class comes out of THE SAME BUNDLE as the store, and that is
			 * not a shortcut. `userFacingMessage` reads `instanceof
			 * DesktopControlError`, so an error built from a second copy of
			 * `desktop-api.ts` - a separate bundle, a separate module instance - is
			 * not recognised, and the failure silently degrades to no sentence at
			 * all. Throwing from here is the only way this test can be about the
			 * store's copy rule rather than about that accident.
			 */
			' export { DesktopControlError } from "@shared/api/local-operator/desktop-api";',
		resolveDir: ROOT,
	},
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// NOT `packages: "external"`, unlike the two bundles above: this one is
	// imported from a `data:` URL, which resolves no bare specifier - `zustand`
	// has to be inside it. The two above are written to real files under
	// `node_modules/.cache/`, where the process's own resolution applies.
	write: false,
	plugins: [
		{
			name: "pin-transport",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "pin-transport" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "pin-transport" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${ROOT}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__pinRequest(request);`,
					loader: "js",
					resolveDir: ROOT,
				}));
				// The store's contract with the transcript hook is three no-op calls,
				// and this file is not testing the echo.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
					loader: "js",
					resolveDir: ROOT,
				}));
			},
		},
	],
});
const { useCanonicalSessionsStore: store, DesktopControlError } = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);

// The real error classes, because the store's copy rules read their actual
// behaviour (`instanceof`) rather than a message string.
const PINNED = "0f1e2d3c4b5a";
const TITLE = "Retention sweep notes";

const seed = (over = {}) => {
	store.setState({
		pinFailure: null,
		sessions: [
			{
				session_id: PINNED,
				title: TITLE,
				binding: { agent: null, team: null },
				updated_at: 1_760_000_000,
				...over,
			},
		],
	});
};

const held = () => store.getState().sessions[0].pinned;

test("a press writes the row first, then sends the desired state", async () => {
	seed({ pinned: false });
	let seen = null;
	let onTheWire = null;
	globalThis.__pinRequest = async (request) => {
		onTheWire = request;
		seen = held();
		return { session_id: PINNED, pinned: true };
	};
	const ok = await store.getState().setSessionPin(PINNED, true);
	assert.equal(ok, true);
	/*
	 * The optimistic write is asserted INSIDE the transport, which is the only
	 * place the "before the answer" state exists: after the await, the reconcile
	 * has already run and a test that reads the row then cannot tell the two apart.
	 */
	assert.equal(seen, true, "the row moved before the request was sent");
	assert.deepEqual(onTheWire, {
		op: "sessions.pin",
		sessionId: PINNED,
		pinned: true,
	});
	assert.equal(held(), true);
	assert.equal(store.getState().pinFailure, null);
});

test("the answer is what the row holds, even when it disagrees", async () => {
	seed({ pinned: false });
	globalThis.__pinRequest = async () => ({
		session_id: PINNED,
		pinned: false,
	});
	await store.getState().setSessionPin(PINNED, true);
	assert.equal(
		held(),
		false,
		"a backend that refused the move is the authority, not the optimistic write",
	);
});

test("a 404 reverts the row and says so", async () => {
	seed({ pinned: false });
	globalThis.__pinRequest = async () => {
		throw new DesktopControlError(404, "No such session.");
	};
	const ok = await store.getState().setSessionPin(PINNED, true);
	assert.equal(ok, false);
	assert.equal(held(), false, "the row is put back where it was");
	assert.deepEqual(store.getState().pinFailure, {
		sessionId: PINNED,
		pinned: true,
		title: TITLE,
		detail: "No such session.",
	});
});

test("a failed unpin leaves the row pinned, not silently unpinned", async () => {
	seed({ pinned: true });
	globalThis.__pinRequest = async () => {
		throw new DesktopControlError(503, "Unavailable.");
	};
	await store.getState().setSessionPin(PINNED, false);
	assert.equal(held(), true, "the glyph must not stay dark on a refused unpin");
	assert.equal(store.getState().pinFailure?.pinned, false);
});

test("a runtime exception carries no sentence of its own", async () => {
	seed({ pinned: false });
	globalThis.__pinRequest = async () => {
		throw new TypeError("fetch failed");
	};
	await store.getState().setSessionPin(PINNED, true);
	/*
	 * `userFacingMessage` refuses to render a non-authored message, and the empty
	 * detail is what makes the panel's own sentence the whole statement rather than
	 * a stack-trace fragment posted beside it.
	 */
	assert.equal(store.getState().pinFailure?.detail, "");
});

test("the next press retires the previous failure", async () => {
	seed({ pinned: false });
	globalThis.__pinRequest = async () => {
		throw new DesktopControlError(404, "No such session.");
	};
	await store.getState().setSessionPin(PINNED, true);
	assert.notEqual(store.getState().pinFailure, null);
	globalThis.__pinRequest = async () => ({ session_id: PINNED, pinned: true });
	await store.getState().setSessionPin(PINNED, true);
	assert.equal(store.getState().pinFailure, null);
});
