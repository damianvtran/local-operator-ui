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

test("a pinned row stays in its agent's group, because groups are the other axis", () => {
	/*
	 * Sections and agent groups are two axes, and this panel already draws one
	 * conversation in two places on two axes. So the claim is not "a pinned row is
	 * in the Pinned section" (the tests above hold that) but "the group view was
	 * never partitioned", and it is asserted as the DECISION rather than as a
	 * count: the entity helper reads `matching`, while only the two section lists
	 * read the partitioned halves.
	 */
	const owned = row("aaaaaaaaaaaa", {
		pinned: true,
		binding: { agent: "coder", team: null },
	});
	const catalogue = [owned, row("bbbbbbbbbbbb")];
	const pinned = pinnedRows(catalogue, true);
	const rest = unpinnedRows(catalogue, true);
	// The child is in the pinned half and out of the section half, and the group's
	// own view is `matching` - which the partition never writes to, so its badge
	// (`children().length`) cannot move either.
	assert.deepEqual(ids(pinned), ["aaaaaaaaaaaa"]);
	assert.deepEqual(ids(rest), ["bbbbbbbbbbbb"]);
	assert.equal(catalogue.length, 2, "the partition copies nothing");
	const children = catalogue.filter(
		(item) => !item.binding.team && item.binding.agent === "coder",
	);
	assert.deepEqual(
		ids(children),
		["aaaaaaaaaaaa"],
		"the group view is `matching`, so a pinned child is still drawn under its agent",
	);

	const source = read(SIDEBAR);
	const childrenAt = source.indexOf("const children = (");
	assert.ok(childrenAt > 0, "the entity helper is where this file says it is");
	const childrenBody = source.slice(
		childrenAt,
		source.indexOf("\n\tconst pinned = ", childrenAt),
	);
	assert.ok(
		childrenBody.includes("matching.filter"),
		"the entity helper filters the UNPARTITIONED list",
	);
	assert.ok(
		!childrenBody.includes("rest.filter"),
		"...and not the section half, which would lift a pinned chat out of its group",
	);
	assert.match(
		source,
		/const pinned = pinnedRows\(matching, pinsEnabled\);/,
		"the Pinned section draws `matching ∩ pinned`",
	);
	assert.match(
		source,
		/const rest = unpinnedRows\(matching, pinsEnabled\);/,
		"and every section below it draws the complement",
	);
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
	/*
	 * `data-session-pin` FOLLOWED BY A NEWLINE, which is the JSX attribute and not
	 * every mention of its name: the panel also SELECTS the attribute - the
	 * move-anchoring effect puts focus back on the row's own control after a pin moves
	 * it - and a bare-string search found that selector first, which is how this file
	 * came to read the conversation button's classes as the slot's.
	 */
	assert.equal(
		source.split("data-session-pin\n").length - 1,
		1,
		"the sidebar declares one session pin control",
	);
	/*
	 * THE GATE IS A BRANCH AROUND THE WHOLE ROW, not a guard around the control.
	 * With no `session_pins` the row is returned as the bare button it was before
	 * this feature existed - no wrapper element, no reserved slot, no hover group -
	 * which is what makes its DOM comparable with the pre-change frames. So the
	 * assertions are positional: what the fail-closed branch returns, and that the
	 * wrapper and the slot both come after it.
	 */
	const withdrawnAt = source.indexOf("if (!pinsEnabled) {");
	assert.ok(
		withdrawnAt > 0,
		"the session row has a fail-closed branch on `pinsEnabled`",
	);
	const fragmentAt = source.indexOf("return <Fragment", withdrawnAt);
	assert.ok(
		fragmentAt > withdrawnAt,
		"the withdrawn branch returns a keyed Fragment",
	);
	// The `;` that closes the return, and not the next `}`: the Fragment line carries
	// two of them (`{row.session_id}`, `{rowButton}`) and the first would cut the
	// slice off before the thing it is here to check.
	const branchEnd = source.indexOf(";", fragmentAt);
	assert.ok(
		source.slice(withdrawnAt, branchEnd).includes("{rowButton}"),
		"the withdrawn branch returns the conversation button itself",
	);
	assert.ok(
		!source.slice(withdrawnAt, branchEnd).includes("data-session-pin"),
		"the withdrawn branch mounts no pin at all",
	);
	const slotAt = source.indexOf("data-session-pin\n");
	assert.ok(
		slotAt > branchEnd,
		"the pin is mounted only in the branch the capability gate opens",
	);
	// The JSX attribute, not the name: the move-anchoring effect SELECTS
	// `[data-session-row="…"]` too, and that mention sits above the gate.
	const wrapperAt = source.indexOf("data-session-row={row.session_id}");
	assert.ok(
		wrapperAt > branchEnd && wrapperAt < slotAt,
		"the hover wrapper belongs to the enabled branch, and the slot is inside it",
	);
	/*
	 * The wrapper carries the row's current-row ground as well as the hover group -
	 * the pin slot is a SIBLING of the conversation button, so a ground painted only
	 * inside the button stops at the slot's edge and leaves the pin outside the row
	 * it says is current (review round 1, M1). The same string on the wrapper is what
	 * makes that assertion reachable from here, and `chat-sidebar-selection.test.mjs`
	 * resolves the expression itself.
	 */
	// `{rowButton}` AFTER the wrapper: the withdrawn branch above renders the same
	// expression, so a search from the top of the file finds that one and slices nothing.
	const wrapperClasses = source.slice(
		wrapperAt,
		source.indexOf("{rowButton}", wrapperAt),
	);
	assert.match(
		wrapperClasses,
		/current && rowCurrent/,
		"the row's box wears the current-row ground, so it spans the pin slot",
	);
	/*
	 * AND THE CONTROL IS WITHHELD WHERE IT COULD NOT ACT, which is a different fact
	 * from the capability: `pinned` is always present on a catalogue row from a
	 * pins-capable backend, but a row synthesized from a search hit whose backend does
	 * not describe the pin state has no `pinned` at all - and that row is rebuilt from
	 * the wire hit on every render, so a press there would be a no-op the user reads as
	 * a failure. The gate is asserted on the shipped expression, in this file's idiom.
	 */
	assert.match(
		source.slice(slotAt - 300, slotAt),
		/\{row\.pinned !== undefined && \(/,
		"the pin control is mounted only on a row whose pin state is known",
	);
	/*
	 * ...and the section that draws the pinned rows is behind the same value: a
	 * backend without the pin store must not render a heading over rows it cannot
	 * be asked about.
	 */
	assert.match(source, /\{pinned\.length > 0 && \(\s*<section>/);
});

test("the reveal is DISARMED under a parked pointer, and hidden and inert when it is", () => {
	const source = read(SIDEBAR);
	// The JSX attribute, not the name: the panel also SELECTS `[data-session-pin]` in the
	// move-anchoring effect, and that mention sits far above the slot itself.
	const at = source.indexOf("data-session-pin\n");
	const block = source.slice(at, at + 2000);
	/*
	 * QA round 1, U3: a pin press moves a row out of the list, the rows below slide up,
	 * and the pointer - which has not moved - is left over a different conversation whose
	 * pin was revealed under it. The reveal is therefore conditional on the pointer having
	 * MOVED since the press, and the disarmed branch is inert as well as hidden: hidden
	 * alone would leave a control that acts on a conversation nobody chose.
	 */
	assert.match(
		block,
		/revealArmed\s*\?/,
		"the slot's reveal must be conditional on the arming flag",
	);
	assert.ok(
		block.includes("pointer-events-none"),
		"the disarmed slot must be inert as well as hidden",
	);
	assert.ok(
		/onPointerMove/.test(source),
		"re-arming must be the pointer moving, not a timer",
	);
});

test("the reveal is opacity on a reserved box, so it cannot reflow the row", () => {
	const source = read(SIDEBAR);
	// The JSX attribute (newline-terminated), never the effect's selector - see the
	// note on the count above.
	const anchor = source.indexOf("data-session-pin\n");
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
