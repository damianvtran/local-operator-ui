/**
 * The agent picture's presence decision and its size setting, executed in Node.
 *
 * WHAT IS REAL HERE: the two pure modules - `avatar-presence.ts` (what a slot
 * draws, and whether it is a door) and `agent-avatar-size.ts` (the setting, its
 * judge and its pixel tables) - plus the preferences store's persisted round
 * trip and `entrySlotSignature`, the DOM window's height key. What is NOT here:
 * pixels. The frames (`Chat/Agent picture presence`, `Chat/Sidebar pictured
 * rows`) are the PR's rendered evidence; this file pins the table and the
 * numbers those frames are drawn from.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const result = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/agent-avatar/avatar-presence";',
			'export * from "./src/renderer/src/features/chat/agent-avatar-size";',
			'export { sessionAgentTarget, sessionAvatarTarget } from "./src/renderer/src/shared/agent-avatar/agent-avatar-meta";',
			'export { entrySlotSignature } from "./src/renderer/src/features/chat/canonical/transcript-dom-window";',
			'export { useUiPreferencesStore, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});

/*
 * The store persists through `localStorage`; give it an in-memory one before it
 * is imported (the same stand-in `turn-segments.test.mjs` uses).
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (k) => (memory.has(k) ? memory.get(k) : null),
	setItem: (k, v) => void memory.set(k, String(v)),
	removeItem: (k) => void memory.delete(k),
	clear: () => memory.clear(),
	key: (i) => [...memory.keys()][i] ?? null,
	get length() {
		return memory.size;
	},
};
globalThis.window = globalThis.window ?? globalThis;

const m = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const {
	decideAvatarMark,
	parseAgentAvatarSize,
	DEFAULT_AGENT_AVATAR_SIZE,
	AGENT_AVATAR_SIZE_OPTIONS,
	TURN_AVATAR_BOX,
	HEADER_AVATAR_BOX,
	TURN_AVATAR_GAP,
	turnMarkHeight,
	entrySlotSignature,
	sessionAgentTarget,
	sessionAvatarTarget,
	useUiPreferencesStore,
	persistedUiPreferences,
} = m;

const base = {
	agentId: "agent-1",
	agentName: "coder",
	src: null,
	settled: true,
	owned: true,
};
const DOOR = { agentId: "agent-1", agentName: "coder" };

/* ------------------------------------------------------------------ *
 * THE PRESENCE TABLE
 * ------------------------------------------------------------------ */

test("a picture that resolved is drawn, with a door only for an owned agent", () => {
	assert.deepEqual(decideAvatarMark({ ...base, src: "blob:x" }), {
		kind: "picture",
		src: "blob:x",
		door: DOOR,
	});
	assert.deepEqual(decideAvatarMark({ ...base, src: "blob:x", owned: false }), {
		kind: "picture",
		src: "blob:x",
		door: null,
	});
});

test("no picture draws the placeholder door for an owned, bound agent", () => {
	assert.deepEqual(decideAvatarMark(base), {
		kind: "placeholder",
		door: DOOR,
		busy: false,
	});
});

test("no picture draws NOTHING where the viewer cannot act on it", () => {
	assert.equal(decideAvatarMark({ ...base, owned: false }), null, "not owned");
	assert.equal(decideAvatarMark({ ...base, agentId: null }), null, "unbound");
	assert.equal(
		decideAvatarMark({ ...base, agentId: null, agentName: null }),
		null,
		"human or draft",
	);
});

test("a failed digest draws exactly what an absent one draws, claimed or not", () => {
	const absent = decideAvatarMark({ ...base, claimed: false });
	const failed = decideAvatarMark({ ...base, claimed: true });
	assert.deepEqual(failed, absent);
	assert.equal(failed.kind, "placeholder");
	/* ...and never a picture mark, so never a pencil door onto an empty plate. */
	assert.notEqual(failed.kind, "picture");
	assert.equal(
		decideAvatarMark({ ...base, claimed: true, owned: false }),
		null,
		"a failed digest on a not-owned agent is the unowned no-picture case: nothing",
	);
});

test("a failed list read draws nothing, never the placeholder (m-3)", () => {
	/* Unreadable is not "no picture": an upload invitation over a picture that may exist. */
	assert.equal(decideAvatarMark({ ...base, unreadable: true }), null);
	/* A picture that resolved anyway still draws; the flag is about the absence of one. */
	assert.equal(
		decideAvatarMark({ ...base, src: "blob:x", unreadable: true })?.kind,
		"picture",
	);
	/* A write in flight keeps its box even then (the busy slot is this window's own fact). */
	assert.equal(
		decideAvatarMark({ ...base, unreadable: true, uploading: true })?.kind,
		"placeholder",
	);
});

test("a read still in flight draws a quiet plate and no door, never the placeholder", () => {
	assert.deepEqual(decideAvatarMark({ ...base, settled: false }), {
		kind: "plate",
	});
	/* A not-owned agent has nothing to hold a box for. */
	assert.equal(
		decideAvatarMark({ ...base, settled: false, owned: false }),
		null,
	);
	/* A resolved picture wins over an unsettled flag (the bytes are the answer). */
	assert.equal(
		decideAvatarMark({ ...base, settled: false, src: "blob:x" }).kind,
		"picture",
	);
});

test("an upload in flight keeps the box, closes the door and shows the busy state", () => {
	assert.deepEqual(decideAvatarMark({ ...base, uploading: true }), {
		kind: "placeholder",
		door: null,
		busy: true,
	});
	/* Even while the agents map is unsettled: the write is the fact. */
	assert.deepEqual(
		decideAvatarMark({ ...base, settled: false, uploading: true }),
		{
			kind: "placeholder",
			door: null,
			busy: true,
		},
	);
	/* Replacing an existing picture: still the picture, door closed. */
	assert.deepEqual(
		decideAvatarMark({ ...base, src: "blob:x", uploading: true }),
		{ kind: "picture", src: "blob:x", door: null },
	);
	/* Not owned: no upload could be ours, and nothing is drawn. */
	assert.equal(
		decideAvatarMark({ ...base, owned: false, uploading: true }),
		null,
	);
});

test("a door needs a name: an owned agent with no name draws no door", () => {
	const mark = decideAvatarMark({ ...base, agentName: null });
	assert.equal(mark.kind, "placeholder");
	assert.equal(mark.door, null);
});

test("the row's ownership answer is the one the sidebar's pencil reads", () => {
	const row = {
		agent_id: "agent-1",
		avatar_sha256: null,
		binding: { agent: "coder" },
	};
	/* A no-picture row has an address for the placeholder door... */
	assert.deepEqual(sessionAgentTarget(row), {
		agentId: "agent-1",
		agentName: "coder",
		sha256: null,
		owned: true,
	});
	/* ...but the sidebar's own reader still says "nothing", so its row is unchanged. */
	assert.equal(sessionAvatarTarget(row), null);
	assert.equal(sessionAgentTarget({ ...row, locality: "remote" }).owned, false);
	assert.equal(sessionAgentTarget({ ...row, binding: null }).owned, false);
	assert.equal(sessionAgentTarget({ ...row, agent_id: null }), null);
});

/* ------------------------------------------------------------------ *
 * THE SIZE SETTING
 * ------------------------------------------------------------------ */

test("the default is small, and small is today's 20px on both surfaces", () => {
	assert.equal(DEFAULT_AGENT_AVATAR_SIZE, "small");
	assert.equal(TURN_AVATAR_BOX.small.px, 20);
	assert.equal(HEADER_AVATAR_BOX.small.px, 20);
	assert.equal(TURN_AVATAR_BOX.small.className, "size-5");
	assert.equal(HEADER_AVATAR_BOX.small.className, "size-5");
	assert.equal(
		useUiPreferencesStore.getInitialState().agentAvatarSize,
		"small",
	);
});

test("garbage, legacy and non-string values fall back to small", () => {
	for (const value of [
		undefined,
		null,
		"",
		"huge",
		"LARGE",
		"md",
		20,
		0,
		true,
		{},
		["large"],
	]) {
		assert.equal(parseAgentAvatarSize(value), "small", String(value));
	}
	for (const size of AGENT_AVATAR_SIZE_OPTIONS) {
		assert.equal(parseAgentAvatarSize(size), size);
	}
});

test("the pixel tables grow with the step, spell their own class, and respect the bar", () => {
	const px = (table) => AGENT_AVATAR_SIZE_OPTIONS.map((s) => table[s].px);
	for (const table of [TURN_AVATAR_BOX, HEADER_AVATAR_BOX]) {
		const [a, b, c] = px(table);
		assert.ok(a < b && b < c, "strictly increasing");
		for (const size of AGENT_AVATAR_SIZE_OPTIONS) {
			/* Tailwind's `size-N` is N * 4px: the class must say the pixels beside it. */
			const unit = Number(table[size].className.replace("size-", ""));
			assert.equal(
				unit * 4,
				table[size].px,
				`${size}: ${table[size].className}`,
			);
		}
	}
	/* The header's bar is 40px (`min-h-10`): its largest box must leave air. */
	assert.ok(Math.max(...px(HEADER_AVATAR_BOX)) <= 32);
	/* The row class names the same pixels as the box. */
	for (const size of AGENT_AVATAR_SIZE_OPTIONS) {
		const unit = Number(HEADER_AVATAR_BOX[size].rowClassName.replace("h-", ""));
		assert.equal(unit * 4, HEADER_AVATAR_BOX[size].px);
	}
});

test("the gap under the turn head grows with the box and its class spells the pixels (D5)", () => {
	const gaps = AGENT_AVATAR_SIZE_OPTIONS.map((size) => TURN_AVATAR_GAP[size]);
	assert.deepEqual(
		gaps.map((g) => g.px),
		[4, 6, 8],
	);
	for (const g of gaps) {
		/* `mb-1.5` is 1.5 * 4 = 6px: the class must say the pixels beside it. */
		assert.equal(Number(g.className.replace("mb-", "")) * 4, g.px, g.className);
	}
});

test("only the 20px steps carry the hit halo, and it lifts them to 24px (D3)", () => {
	for (const table of [TURN_AVATAR_BOX, HEADER_AVATAR_BOX]) {
		for (const size of AGENT_AVATAR_SIZE_OPTIONS) {
			const box = table[size];
			if (box.px >= 24) {
				assert.equal(box.hitClassName, "", `${size} already clears 24px`);
			} else {
				/* A pseudo-element inset by 2px on every side: 20 + 4 = 24. */
				assert.match(box.hitClassName, /before:-inset-0\.5/);
				assert.equal(box.px + 2 * 2, 24);
			}
		}
	}
});

test("the transcript's height estimate follows the setting", () => {
	assert.equal(TURN_AVATAR_GAP.small.px, 4, "mb-1: today's gap");
	/* Small is the 24px every estimate used before the setting existed. */
	assert.equal(turnMarkHeight("small"), 24);
	for (const size of ["medium", "large"]) {
		assert.equal(
			turnMarkHeight(size),
			TURN_AVATAR_BOX[size].px + TURN_AVATAR_GAP[size].px,
			`${size}: the estimate reads the same table the class does`,
		);
	}
	assert.ok(turnMarkHeight("small") < turnMarkHeight("medium"));
	assert.ok(turnMarkHeight("medium") < turnMarkHeight("large"));
	/* And the cache key moves when only the size changes, so a cached height is not reused. */
	const fact = {
		key: "k",
		ids: ["a"],
		representation: "inline",
		gap: "turn",
		userExpanded: false,
		media: false,
		unsafe: false,
		marksHead: true,
		markHeight: turnMarkHeight("small"),
		renderSignature: "a:1",
	};
	const small = entrySlotSignature([fact], false);
	assert.notEqual(
		entrySlotSignature(
			[{ ...fact, markHeight: turnMarkHeight("large") }],
			false,
		),
		small,
	);
	assert.equal(entrySlotSignature([fact], false), small);
	/* An entry with no mark does not depend on the size at all. */
	assert.equal(
		entrySlotSignature([{ ...fact, marksHead: false, markHeight: 24 }], false),
		entrySlotSignature([{ ...fact, marksHead: false, markHeight: 40 }], false),
	);
});

test("the choice survives a relaunch, and a bad stored token reads back as small", () => {
	memory.clear();
	const store = useUiPreferencesStore;
	store.getState().setAgentAvatarSize("large");
	assert.equal(
		persistedUiPreferences(store.getState()).agentAvatarSize,
		"large",
	);
	const key = [...memory.keys()].find((entry) => {
		try {
			return JSON.parse(memory.get(entry)).state?.agentAvatarSize !== undefined;
		} catch {
			return false;
		}
	});
	assert.ok(key, "the store wrote a key carrying the size");
	assert.equal(
		parseAgentAvatarSize(JSON.parse(memory.get(key)).state.agentAvatarSize),
		"large",
	);
	store.getState().setAgentAvatarSize("medium");
	assert.equal(
		parseAgentAvatarSize(JSON.parse(memory.get(key)).state.agentAvatarSize),
		"medium",
	);
	/* A blob a future build wrote with a renamed token. */
	const blob = JSON.parse(memory.get(key));
	blob.state.agentAvatarSize = "xl";
	assert.equal(parseAgentAvatarSize(blob.state.agentAvatarSize), "small");
	/* A legacy blob with no key at all reads as undefined, which is small. */
	blob.state.agentAvatarSize = undefined;
	assert.equal(parseAgentAvatarSize(blob.state.agentAvatarSize), "small");
	store.getState().setAgentAvatarSize("small");
});

/* ------------------------------------------------------------------ *
 * REMEDIATION PINS (review round 1): the logic that lives in components and
 * in the write path, asked of the SOURCE because Node has no DOM here. Each
 * asserts the code, not a comment (comments are blanked first).
 * ------------------------------------------------------------------ */

const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length))
		.replace(/\/\/.*$/gm, "");
const AV = "src/renderer/src/shared/agent-avatar";
const CH = "src/renderer/src/features/chat/components";

test("uploading is a solid plate with a spinner, never the dashed ring (D2)", () => {
	const slot = code(`${AV}/agent-avatar-slot.tsx`);
	const busyArm = slot.slice(
		slot.indexOf("if (mark.busy)"),
		slot.indexOf("const face ="),
	);
	assert.ok(busyArm.length > 0, "the busy arm returns before the dashed face");
	assert.match(busyArm, /<AgentAvatar\b/);
	assert.match(busyArm, /LoaderCircle/);
	assert.doesNotMatch(busyArm, /border-dashed/);
	/* The dashed ring exists once, on the door's face. */
	assert.equal(slot.match(/border-dashed/g)?.length, 1);
});

test("a write holds `writing` until the readers have re-read (m-2)", () => {
	const src = code(`${AV}/agent-avatar.ts`);
	for (const fn of ["setAgentAvatar", "clearAgentAvatar"]) {
		const body = src.slice(src.indexOf(`export async function ${fn}`));
		const upto = body.slice(0, body.indexOf("\n}\n"));
		assert.match(
			upto,
			/refreshAndSettle\(\)\.then\(\(\) => setWriting\(agentId, false\)\)/,
			`${fn} releases after the refresh`,
		);
		/* Failure paths release at once: nothing is coming to wait for. */
		assert.ok(
			(upto.match(/setWriting\(agentId, false\)/g) ?? []).length >= 3,
			`${fn} releases on every failure path too`,
		);
	}
	/* The hold is bounded, so a hung refresh cannot close the door for good. */
	assert.match(src, /WRITE_SETTLE_MS = 5000/);
});

test("an unreadable agents list is reported by the state hook (m-3)", () => {
	const src = code(`${AV}/agent-avatar.ts`);
	assert.match(src, /isError && !data/);
	const slot = code(`${AV}/agent-avatar-slot.tsx`);
	assert.match(slot, /unreadable,\s*\n\s*owned: input\.owned/);
});

test("the session row's overlay mounts only for a picture that draws (m-1)", () => {
	const row = code(`${CH}/chat-session-avatar.tsx`);
	const edit = row.slice(row.indexOf("export function ChatSessionAvatarEdit"));
	assert.match(edit, /useAgentAvatarState\(/);
	assert.match(edit, /if \(settled && !url\) return null;/);
});

test("the header sizes its title row from the table only when a mark is drawn (n-2)", () => {
	const header = code(`${CH}/chat-header.tsx`);
	assert.match(
		header,
		/const avatarRowClass = headerMark\s*\?\s*HEADER_AVATAR_BOX\[avatarSize\]\.rowClassName\s*:\s*"h-5";/,
	);
});

test("a list with pictures reserves the box on every row; a list without draws main's cell (D1)", () => {
	const row = code(`${CH}/chat-session-avatar.tsx`);
	assert.match(row, /reservePicture = false/);
	/* The reserved box is the picture's own size and inert. */
	assert.match(row, /data-session-picture-slot/);
	const bare = row.slice(row.indexOf("function BareSessionStatus"));
	assert.match(bare, /if \(!reserve\) return <ChatSessionStatus/);
	const sidebar = code(`${CH}/chat-sidebar.tsx`);
	assert.match(sidebar, /reservePicture=\{anyRowPictured\}/);
	assert.match(sidebar, /row\.agent_id && row\.avatar_sha256/);
});
