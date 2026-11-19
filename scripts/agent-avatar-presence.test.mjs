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
	agentSuggestsPicture,
	CHIEF_OF_STAFF_SEAT,
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

/*
 * NO PICTURE, NO MARK (operator, 2026-11-04). Every pictureless state answers
 * null - owned or not - unless the surface passes `suggestPicture` (the chat
 * header, for a proactive agent or the chief of staff).
 */
const SUGGEST = { ...base, suggestPicture: true };

test("no picture draws NOTHING for a regular agent, owned or not, in every settled state", () => {
	for (const [label, facts] of [
		["absent", base],
		["absent, unclaimed", { ...base, claimed: false }],
		["failed (claimed, no bytes)", { ...base, claimed: true }],
		["unreadable list", { ...base, unreadable: true }],
		["cold, unclaimed", { ...base, settled: false }],
		["cold, unclaimed, explicit", { ...base, settled: false, claimed: false }],
		["cold, unreadable", { ...base, settled: false, unreadable: true }],
		["uploading a first picture", { ...base, uploading: true }],
		["uploading while cold", { ...base, settled: false, uploading: true }],
		["no name", { ...base, agentName: null }],
	]) {
		assert.equal(decideAvatarMark(facts), null, `owned: ${label}`);
		assert.equal(
			decideAvatarMark({ ...facts, owned: false }),
			null,
			`not owned: ${label}`,
		);
	}
	assert.equal(decideAvatarMark({ ...base, agentId: null }), null, "unbound");
	assert.equal(
		decideAvatarMark({ ...base, agentId: null, agentName: null }),
		null,
		"human or draft",
	);
});

test("a failed digest draws exactly what an absent one draws, claimed or not", () => {
	assert.deepEqual(
		decideAvatarMark({ ...base, claimed: true }),
		decideAvatarMark({ ...base, claimed: false }),
	);
	assert.deepEqual(
		decideAvatarMark({ ...SUGGEST, claimed: true }),
		decideAvatarMark({ ...SUGGEST, claimed: false }),
		"and on a suggesting header too",
	);
});

test("a cold read holds a plate only for a CLAIMED digest of an owned agent", () => {
	assert.deepEqual(
		decideAvatarMark({ ...base, settled: false, claimed: true }),
		{
			kind: "plate",
		},
	);
	/* No digest claimed: no face coming, so no transient box to flash. */
	assert.equal(
		decideAvatarMark({ ...base, settled: false, claimed: false }),
		null,
	);
	/* A not-owned agent has nothing to hold a box for. */
	assert.equal(
		decideAvatarMark({ ...base, settled: false, claimed: true, owned: false }),
		null,
	);
	/* A resolved picture wins over an unsettled flag (the bytes are the answer). */
	assert.equal(
		decideAvatarMark({ ...base, settled: false, src: "blob:x" }).kind,
		"picture",
	);
});

test("a failed list read draws nothing, never a placeholder (m-3)", () => {
	assert.equal(decideAvatarMark({ ...SUGGEST, unreadable: true }), null);
	assert.equal(
		decideAvatarMark({ ...base, src: "blob:x", unreadable: true })?.kind,
		"picture",
	);
});

test("a picture being replaced keeps drawing, door closed; a door needs a picture", () => {
	assert.deepEqual(
		decideAvatarMark({ ...base, src: "blob:x", uploading: true }),
		{ kind: "picture", src: "blob:x", door: null },
	);
	/* The pencil door is only ever on a present picture for a regular agent. */
	for (const facts of [
		base,
		{ ...base, claimed: true },
		{ ...base, settled: false, claimed: true },
	]) {
		const mark = decideAvatarMark(facts);
		assert.ok(mark === null || !("door" in mark) || mark.door === null);
	}
});

test("suggestPicture: the header of a proactive agent or the chief of staff draws the placeholder door", () => {
	assert.deepEqual(decideAvatarMark(SUGGEST), {
		kind: "placeholder",
		door: DOOR,
		busy: false,
	});
	/* While the read is cold it holds a plate, so the door never flashes over a face. */
	assert.deepEqual(decideAvatarMark({ ...SUGGEST, settled: false }), {
		kind: "plate",
	});
	/* A first upload under it keeps the box busy and the door closed. */
	assert.deepEqual(decideAvatarMark({ ...SUGGEST, uploading: true }), {
		kind: "placeholder",
		door: null,
		busy: true,
	});
	/* A picture is still a picture. */
	assert.equal(decideAvatarMark({ ...SUGGEST, src: "blob:x" }).kind, "picture");
	/* Never where the viewer cannot act: not owned, unbound. */
	assert.equal(decideAvatarMark({ ...SUGGEST, owned: false }), null);
	assert.equal(decideAvatarMark({ ...SUGGEST, agentId: null }), null);
	/* A door needs a name. */
	assert.equal(decideAvatarMark({ ...SUGGEST, agentName: null }).door, null);
});

test("a header whose class read is pending holds a plate, never the door (D1 / m2)", () => {
	/* Pictureless, settled, class unknown: the box is held so the title does not shift. */
	assert.deepEqual(decideAvatarMark({ ...base, suggestPending: true }), {
		kind: "plate",
	});
	/* Only where a door could follow: not owned, unbound or unreadable draw nothing. */
	assert.equal(
		decideAvatarMark({ ...base, suggestPending: true, owned: false }),
		null,
	);
	assert.equal(
		decideAvatarMark({ ...base, suggestPending: true, agentId: null }),
		null,
	);
	assert.equal(
		decideAvatarMark({ ...base, suggestPending: true, unreadable: true }),
		null,
	);
	/* A picture still wins; once the read answers "regular", nothing again. */
	assert.equal(
		decideAvatarMark({ ...base, suggestPending: true, src: "blob:x" }).kind,
		"picture",
	);
	assert.equal(decideAvatarMark({ ...base, suggestPending: false }), null);
	/* The header passes it from the profiles read's own pending state, gated as enabled. */
	const header = code(`${CH}/chat-header.tsx`);
	assert.match(header, /const profiles = useProfiles\(readsClass\)/);
	assert.match(
		header,
		/suggestPending: readsClass && profiles\.isPending && !suggestPicture/,
	);
});

test("the turn head claims the session row's digest, so a pictured agent holds its plate (Q-1)", () => {
	/* Unhinted and cold, nothing is claimed and nothing is drawn: the pop-in. */
	assert.equal(decideAvatarMark({ ...base, settled: false }), null);
	/* With the row's digest claimed the cold head holds the box. */
	assert.deepEqual(
		decideAvatarMark({ ...base, settled: false, claimed: true }),
		{ kind: "plate" },
	);
	const page = code(`${CH}/chat-page.tsx`);
	const call = page.slice(
		page.indexOf("const agentAvatar = useAgentSlotMark({"),
	);
	assert.match(
		call.slice(0, 400),
		/sha256Hint: \(rowSpeaks && boundRow\?\.avatar_sha256\) \|\| undefined/,
	);
	/* The row is only the speaker's when it names the same agent id. */
	assert.match(
		page,
		/const rowSpeaks =\s*speakerAgentId !== null && boundRow\?\.agent_id === speakerAgentId/,
	);
	/* Still never a suggestion on the transcript. */
	assert.doesNotMatch(call.slice(0, 400), /suggestP/);
});

test("agentSuggestsPicture: only the chief of staff and proactive-class agents", () => {
	const profiles = [
		{ name: "manager", action_class: "reactive" },
		{ name: "coder" },
		{ name: "buddy", action_class: "proactive" },
		{ name: "odd", action_class: "PROACTIVE" },
	];
	assert.equal(
		agentSuggestsPicture("manager", profiles),
		false,
		"reactive role",
	);
	assert.equal(
		agentSuggestsPicture("coder", profiles),
		false,
		"unclassified reads reactive",
	);
	assert.equal(
		agentSuggestsPicture("odd", profiles),
		false,
		"only the literal proactive",
	);
	assert.equal(agentSuggestsPicture("buddy", profiles), true, "proactive");
	assert.equal(
		agentSuggestsPicture("nobody", profiles),
		false,
		"not in the list",
	);
	assert.equal(
		agentSuggestsPicture("buddy", undefined),
		false,
		"list not read yet",
	);
	assert.equal(agentSuggestsPicture(null, profiles), false, "no agent");
	assert.equal(
		agentSuggestsPicture(CHIEF_OF_STAFF_SEAT, undefined),
		true,
		"chief of staff",
	);
	/* The seat name is the aida module's, spelled twice only because this one is import-free. */
	const aida = readFileSync(
		"src/renderer/src/features/aida/use-aida-target.ts",
		"utf8",
	);
	assert.ok(
		aida.includes(`export const AIDA_SEAT_NAME = "${CHIEF_OF_STAFF_SEAT}";`),
	);
});

test("only the chat header passes suggestPicture; the transcript, sidebar and Team Bridge never do", () => {
	const header = code(`${CH}/chat-header.tsx`);
	/* Any spelling of the header's pass (n2); the negative greps carry the weight. */
	assert.match(header, /suggestPicture/);
	const callers = [
		`${CH}/chat-page.tsx`,
		`${CH}/chat-session-avatar.tsx`,
		`${CH}/chat-sidebar.tsx`,
		`${CH}/chat-content.tsx`,
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		`${CH}/message-item/message-avatar.tsx`,
		"src/renderer/src/features/team-bridge/team-bridge-profile-card.tsx",
	];
	for (const file of callers)
		assert.doesNotMatch(
			code(file),
			/suggestPicture/,
			`${file} must not suggest`,
		);
	/* The transcript's own decision: a proactive agent's turn head still draws nothing. */
	assert.equal(decideAvatarMark({ ...base, suggestPicture: false }), null);
});

test("the row's ownership answer is the one the sidebar's pencil reads", () => {
	const row = {
		agent_id: "agent-1",
		avatar_sha256: null,
		binding: { agent: "coder" },
	};
	/* A no-picture row still has an address (the header's suggesting door)... */
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

test("the header sizes its title row from the table only when a mark is drawn, from the same call as the mark (n-2, M1)", () => {
	const header = code(`${CH}/chat-header.tsx`);
	/* One hook returns BOTH the mark and the row class, so they cannot disagree. */
	const hook = header.slice(
		header.indexOf("const useHeaderAvatar = ("),
		header.indexOf("const NO_MARK_ROW"),
	);
	assert.match(
		hook,
		/if \(!mark\) return \{ avatar: null, rowClassName: NO_MARK_ROW \}/,
	);
	assert.match(hook, /rowClassName: box\.rowClassName/);
	assert.match(header, /const NO_MARK_ROW = "h-5"/);
	/* M1: the hook is never called in ChatHeader's own body, only under a component. */
	const body = header.slice(
		header.indexOf("export const ChatHeader: FC<ChatHeaderProps>"),
	);
	assert.doesNotMatch(body, /useHeaderAvatar\(|useAgentSlotMark\(/);
	assert.match(body, /<HeaderAvatarScope agent=\{agentAvatar\}>/);
	/* ...and the scope renders the no-agent case without touching the hook. */
	const scope = header.slice(header.indexOf("const HeaderAvatarScope"));
	assert.match(
		scope,
		/agent \?\s*\(\s*<WithHeaderAvatar[\s\S]*:\s*\(\s*children\(\{ avatar: null, rowClassName: NO_MARK_ROW \}\)/,
	);
	/* The title row reads the scope's class, not a constant of its own. */
	assert.match(header, /cn\(rowClassName, "flex-wrap overflow-clip"\)/);
});

test("a pictureless session row is the status cell alone, never a reserved box", () => {
	const row = code(`${CH}/chat-session-avatar.tsx`);
	assert.doesNotMatch(
		row,
		/reservePicture|data-session-picture-slot|BareSessionStatus/,
	);
	assert.match(
		row,
		/if \(!agentId \|\| !sha256\) \{[\s\S]*?return <ChatSessionStatus row=\{row\} nowSeconds=\{nowSeconds\} \/>;/,
	);
	assert.match(
		row,
		/if \(settled && !url\)\s*return <ChatSessionStatus row=\{row\} nowSeconds=\{nowSeconds\} \/>;/,
	);
	const sidebar = code(`${CH}/chat-sidebar.tsx`);
	assert.doesNotMatch(sidebar, /reservePicture|anyRowPictured/);
});

test("the settings sample draws the sidebar's fixed 16px box beside the stepped ones (D8), on a hairline edge (D7)", () => {
	const sample = code(
		"src/renderer/src/features/settings/components/agent-avatar-size-setting.tsx",
	);
	const row = readFileSync(`${CH}/chat-session-avatar.tsx`, "utf8");
	const fixed = /SESSION_MARK_BOX = "(size-\d+)"/.exec(row)?.[1];
	assert.ok(fixed, "the row's mark box is a literal class");
	assert.ok(
		sample.includes(`SIDEBAR_AVATAR_BOX = { className: "${fixed}"`),
		`the sample's fixed box is the row's own ${fixed}`,
	);
	assert.match(sample, /data-agent-size-sample-fixed/);
	/* The fixed group takes no step: its box is not read from either size table. */
	const group = sample.slice(sample.indexOf("data-agent-size-sample-fixed"));
	assert.doesNotMatch(group.slice(0, 200), /TURN_AVATAR_BOX|HEADER_AVATAR_BOX/);
	/* Wordless and inert, so it adds no copy to translate or announce. */
	assert.match(sample, /aria-hidden="true"\s*\n\s*data-agent-size-sample=/);
	assert.doesNotMatch(sample, /t\(`\$\{BASE\}\.sample/);
	/* D7: the sample's box is a hairline, not the control edge. */
	assert.match(sample, /border border-hairline bg-surface/);
	assert.doesNotMatch(sample, /border-control bg-surface/);
});
