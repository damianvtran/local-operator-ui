import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Temporary chats (`features.temporary_chats`), as decisions and as wire.
 *
 * The sidebar, the header and the transcript cannot be rendered in this suite
 * (they read the router, the sessions store and the capability hooks), so the
 * rules they are built from live in `chat-temporary.ts` and
 * `missing-session-notice.ts` and are RUN here, and the frozen wire (contract
 * §2.3) is asserted against the shipped `desktop-contract.ts`. Faked: nothing
 * beyond the rows themselves - the core that answers them is a separate PR.
 *
 * The properties, each of which fails silently on its own:
 *
 *   1. FAIL-CLOSED. Without the capability the partition returns the SAME array
 *      and reads no row, the menu offers nothing, and the wire carries neither
 *      `include_temporary` nor `temporary`.
 *   2. A temporary chat is in NO normal list, and only a well-formed `temporary`
 *      object counts: a malformed one keeps the chat visible.
 *   3. The countdown is the last five minutes only, and never while held.
 *   4. The tombstone is its own notice only for `session_temporary_deleted`.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-temporary";' +
			' export * from "./src/renderer/src/features/chat/missing-session-notice";' +
			' export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	SESSION_TEMPORARY_DELETED_CODE,
	TEMPORARY_HOLD_CODES,
	attachableSessions,
	deletesInLabel,
	draftCreatesTemporary,
	switcherSessions,
	temporaryDraftPlaceholderKey,
	desktopEndpoint,
	desktopRequestSchema,
	groupOpenByDefault,
	holdLabelKey,
	isTemporaryDeleted,
	minutesLeft,
	missingSessionNotice,
	partition,
	refusalRemedy,
	showCountdown,
	temporaryInfo,
	temporaryMenuAction,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const NOW = 1_800_000_000;
const info = (overrides = {}) => ({
	marked_at: NOW - 600,
	idle_minutes: 30,
	deletes_at: NOW + 20 * 60,
	hold: null,
	...overrides,
});
const row = (id, temporary = null) => ({ session_id: id, temporary });

/* ---------------------------------------------------------- partition */

test("without the capability the partition is the list it always was, by identity", () => {
	const rows = [row("a"), row("b", info())];
	const { normal, temporary } = partition(rows, false);
	assert.equal(normal, rows, "the same array, not a copy");
	assert.deepEqual(temporary, []);
});

test("with the capability a temporary chat is in no normal list, only its group", () => {
	const rows = [row("a"), row("b", info()), row("c"), row("d", info())];
	const { normal, temporary } = partition(rows, true);
	assert.deepEqual(
		normal.map((r) => r.session_id),
		["a", "c"],
	);
	assert.deepEqual(
		temporary.map((r) => r.session_id),
		["b", "d"],
	);
});

test("a list with no temporary chat keeps its identity, so nothing re-renders", () => {
	const rows = [row("a"), row("b")];
	assert.equal(partition(rows, true).normal, rows);
});

test("only a well-formed temporary object counts; anything else stays visible", () => {
	for (const bad of [
		undefined,
		null,
		true,
		"yes",
		{},
		{ marked_at: "1" },
		{ marked_at: Number.NaN },
	]) {
		assert.equal(
			temporaryInfo({ temporary: bad }, true),
			null,
			`${JSON.stringify(bad)} reads as not temporary`,
		);
		assert.equal(partition([row("a", bad)], true).temporary.length, 0);
	}
	assert.equal(temporaryInfo({ temporary: info() }, false), null);
});

/* ------------------------------------------------------------- group */

test("the group opens by itself only while it holds the chat on screen", () => {
	const rows = [row("b", info())];
	assert.equal(groupOpenByDefault("b", rows), true);
	assert.equal(groupOpenByDefault("a", rows), false);
	assert.equal(groupOpenByDefault(null, rows), false);
	assert.equal(groupOpenByDefault(undefined, []), false);
});

/* --------------------------------------------------------- countdown */

test("the countdown shows in the last five minutes only", () => {
	assert.equal(showCountdown(NOW + 20 * 60, NOW), false);
	assert.equal(showCountdown(NOW + 5 * 60 + 1, NOW), false);
	assert.equal(showCountdown(NOW + 5 * 60, NOW), true);
	assert.equal(showCountdown(NOW + 30, NOW), true);
	assert.equal(
		showCountdown(null, NOW),
		false,
		"a held chat has no deletes_at",
	);
	assert.equal(showCountdown(undefined, NOW), false);
});

test("minutes left round down and never fall below one; a held chat has none", () => {
	// QA round 1, Q-4: the core stamps deletes_at a fraction after the mark, so a
	// fresh 30-minute chat is 1800.9 s out and must read 30, not 31.
	assert.equal(minutesLeft(info({ deletes_at: NOW + 1800.9 }), NOW), 30);
	assert.equal(minutesLeft(info({ deletes_at: NOW + 5 * 60 }), NOW), 5);
	assert.equal(minutesLeft(info({ deletes_at: NOW + 4 * 60 + 59 }), NOW), 4);
	assert.equal(minutesLeft(info({ deletes_at: NOW + 240 }), NOW), 4);
	assert.equal(minutesLeft(info({ deletes_at: NOW + 59 }), NOW), 1);
	assert.equal(minutesLeft(info({ deletes_at: NOW - 10 }), NOW), 1);
	assert.equal(
		minutesLeft(info({ hold: "running", deletes_at: null }), NOW),
		null,
	);
});

test("the row line is the hold when held, the minutes otherwise", () => {
	assert.deepEqual(deletesInLabel(info(), NOW), {
		key: "deletes_in",
		minutes: 20,
	});
	assert.deepEqual(
		deletesInLabel(info({ hold: "open_ask", deletes_at: null }), NOW),
		{ key: "hold", code: "open_ask" },
	);
	assert.deepEqual(
		deletesInLabel(
			info({ hold: "a_code_from_the_future", deletes_at: null }),
			NOW,
		),
		{ key: "hold", code: "cannot_verify" },
		"an unknown hold is not guessed at",
	);
	assert.deepEqual(
		deletesInLabel(info({ deletes_at: null }), NOW),
		{ key: "hold", code: "cannot_verify" },
		"no deadline and no hold is the cannot-verify state, never a fake countdown",
	);
});

test("every hold code of the closed enum has a catalogue key", () => {
	assert.equal(TEMPORARY_HOLD_CODES.length, 11);
	for (const code of TEMPORARY_HOLD_CODES)
		assert.equal(
			holdLabelKey(code),
			`ui.chat.sidebar_view.temporary.hold.${code}`,
		);
	assert.equal(
		holdLabelKey("nope"),
		"ui.chat.sidebar_view.temporary.hold.cannot_verify",
	);
});

/* -------------------------------------------------- menu and refusals */

test("the header menu offers Keep on a temporary chat, Make temporary otherwise, nothing on a draft or without the capability", () => {
	assert.equal(temporaryMenuAction(true, false, info()), "keep");
	assert.equal(temporaryMenuAction(true, false, null), "make");
	assert.equal(temporaryMenuAction(true, true, null), null);
	assert.equal(temporaryMenuAction(false, false, info()), null);
});

test("only the temporary refusal turns into Keep and pin / Keep and link", () => {
	assert.equal(refusalRemedy("session_temporary", "pin"), "keep_and_pin");
	assert.equal(refusalRemedy("session_temporary", "link"), "keep_and_link");
	assert.equal(refusalRemedy("session_pinned", "pin"), null);
	assert.equal(refusalRemedy(undefined, "link"), null);
});

/* --------------------------------------------------------- tombstone */

test("the tombstone notice is its own only for session_temporary_deleted", () => {
	assert.equal(SESSION_TEMPORARY_DELETED_CODE, "session_temporary_deleted");
	assert.equal(isTemporaryDeleted("session_temporary_deleted"), true);
	assert.equal(isTemporaryDeleted("session_not_found"), false);
	assert.equal(isTemporaryDeleted(undefined), false);

	const tomb = missingSessionNotice(true);
	assert.equal(tomb.kind, "temporary");
	assert.equal(tomb.title, "ui.chat.canonical.temporary_deleted.title");
	assert.deepEqual(
		tomb.actions.map((a) => [a.key, a.temporary]),
		[
			["ui.chat.canonical.temporary_deleted.new", true],
			["ui.chat.canonical.temporary_deleted.back", false],
		],
	);
	for (const generic of [false, undefined]) {
		const notice = missingSessionNotice(generic);
		assert.equal(notice.kind, "generic");
		assert.equal(notice.title, "ui.chat.canonical.transcript.missing_session");
		assert.equal(notice.actions.length, 1);
	}
});

/* -------------------------------------------------------------- wire */

const SESSION = "2d5ad5da0025";
const parse = (request) => desktopRequestSchema.safeParse(request);

test("sessions.temporary carries the DESIRED state to its own route", () => {
	for (const temporary of [true, false])
		assert.deepEqual(
			desktopEndpoint({
				op: "sessions.temporary",
				sessionId: SESSION,
				temporary,
			}),
			{
				path: `/v1/desktop/sessions/${SESSION}/temporary`,
				method: "POST",
				body: { temporary },
			},
		);
});

test("sessions.temporary admits only a real boolean and refuses an extra key", () => {
	assert.equal(
		parse({ op: "sessions.temporary", sessionId: SESSION, temporary: true })
			.success,
		true,
	);
	for (const bad of ["yes", 1, 0, null, undefined])
		assert.equal(
			parse({ op: "sessions.temporary", sessionId: SESSION, temporary: bad })
				.success,
			false,
			`temporary: ${JSON.stringify(bad)} is not a boolean`,
		);
	assert.equal(
		parse({
			op: "sessions.temporary",
			sessionId: SESSION,
			temporary: true,
			requestId: SESSION,
		}).success,
		false,
	);
});

test("the list sends include_temporary only when asked, last, and never as false", () => {
	const plain = desktopEndpoint({
		op: "sessions.list",
		include_archived: true,
	});
	assert.equal(
		plain.path,
		"/v1/desktop/sessions?limit=100&include_archived=true",
	);
	assert.equal(
		desktopEndpoint({
			op: "sessions.list",
			include_archived: true,
			include_temporary: false,
		}).path,
		plain.path,
		"false is the route default and is not sent",
	);
	assert.equal(
		desktopEndpoint({
			op: "sessions.list",
			include_archived: true,
			include_temporary: true,
		}).path,
		"/v1/desktop/sessions?limit=100&include_archived=true&include_temporary=true",
	);
	assert.equal(
		parse({ op: "sessions.list", include_temporary: true }).success,
		true,
	);
	assert.equal(
		parse({ op: "sessions.list", include_temporary: "true" }).success,
		false,
	);
});

test("a create carries temporary only when true, so an ordinary create is byte-identical", () => {
	const base = {
		op: "sessions.create",
		requestId: "11111111-1111-4111-8111-111111111111",
		cwd: "/tmp/w",
	};
	const plain = desktopEndpoint(base).body;
	assert.equal("temporary" in plain, false);
	assert.deepEqual(desktopEndpoint({ ...base, temporary: false }).body, plain);
	assert.deepEqual(desktopEndpoint({ ...base, temporary: true }).body, {
		...plain,
		temporary: true,
	});
	assert.equal(parse({ ...base, temporary: true }).success, true);
	assert.equal(parse({ ...base, temporary: "1" }).success, false);
});

/* ------------------------------------------------ round-1 remediation */

/** Comments removed, so a sentence that NAMES a symbol is not a use of it. */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const PROJECT_LINKS =
	"src/renderer/src/features/projects/components/project-links.tsx";
const PROJECT_DETAIL =
	"src/renderer/src/features/projects/components/project-detail.tsx";
const SETTINGS_PAGE =
	"src/renderer/src/features/settings/components/settings-page.tsx";
const CHAT_HEADER = "src/renderer/src/features/chat/components/chat-header.tsx";
const CHAT_CONTENT =
	"src/renderer/src/features/chat/components/chat-content.tsx";
const GROUP =
	"src/renderer/src/features/chat/components/sidebar-temporary-group.tsx";
const STREAM_HOOK = "src/renderer/src/shared/hooks/use-canonical-session.ts";

const RE_R1_1 =
	/attachableSessions\(sessions, temporaryChats\)\s*\.filter\(\(row\) => !linked\.has\(row\.session_id\)\)/;
const RE_R1_2 = /state\.temporaryChats/;
const RE_R1_3 =
	/const canonicalSessions = useMemo\(\s*\(\) => attachableSessions\(canonicalRows, temporaryChats\)/;
const RE_R1_4 = /sessions=\{canonicalSessions\}/;
const RE_R1_5 = /onLink=\{\(sessionId\) => \{([\s\S]*?)\n\t{5}\}\}/;
const RE_R1_6 =
	/refusalRemedy\(\s*error instanceof DesktopControlError \? error\.code : undefined,\s*"link",?\s*\)/;
const RE_R1_7 = /remedy === "keep_and_link"/;
const RE_R1_8 = /t\("ui\.chat\.dialogs\.keep_and_link"\)/;
const RE_R1_9 = /setSessionTemporary\(sessionId, false\)/;
const RE_R1_10 = /refusalRemedy\(/g;
const RE_R1_11 = /^Temporary chat/;
const RE_R1_12 =
	/temporaryDraftPlaceholderKey\(\s*draftTemporary === true && !draftPeer,?\s*\)/;
const RE_R1_13 =
	/placeholderOverride=\{\s*temporaryPlaceholderKey\s*\?\s*t\(temporaryPlaceholderKey\)\s*:\s*undefined\s*\}/;
const RE_R1_14 = /data-temporary-toggle([\s\S]*?)<\/Button>/;
const RE_R1_15 = /aria-pressed=\{temporaryDraft\.on\}/;
const RE_R1_16 =
	/temporaryDraft\.on &&\s*"bg-row-selected text-accent ring-1 ring-accent ring-inset/;
const RE_R1_17 = /disabled=\{temporaryDraft\.peerDestination === true\}/;
const RE_R1_18 = /t\("ui\.chat\.header\.temporary_peer_unavailable"\)/;
const RE_R1_19 =
	/draftCreatesTemporary\(draft, store\.temporaryChats\) \? true : undefined/;
const RE_R1_20 =
	/missing: sameSession \? current\.missing : false,\s*temporaryDeleted: sameSession \? current\.temporaryDeleted : undefined,/;
const RE_R1_21 =
	/sessions: switcherSessions\(\s*sessions\.sessions,\s*sessions\.temporaryChats,\s*displayed,?\s*\)/;
const RE_R1_22 = /aria-current=[\s\S]*?<\/button>/;
const RE_R1_23 = /title=\{`\$\{title\}\\n\$\{meta\}`\}/;
const RE_R1_24 = /ps-\[1\.375rem\]/;
const RE_R1_25 =
	/<span className="flex min-w-0 flex-1 flex-col">\s*<span className="truncate">\{title\}<\/span>\s*<span[\s\S]*?data-temporary-meta/;
const RE_R1_26 = /shrink-0 whitespace-nowrap/;
const RE_R1_27 = /<DropdownMenuSeparator \/>/;
const RE_R1_28 =
	/\{archiveEnabled && deleteEnabled && <DropdownMenuSeparator \/>\}/;

// R1-1 (MAJOR): a temporary chat is never offered to a picker that attaches it.
test("attachable sessions leave temporary chats out, and are the list itself without the capability", () => {
	const rows = [row("a"), row("t", info()), row("b")];
	assert.deepEqual(
		attachableSessions(rows, true).map((r) => r.session_id),
		["a", "b"],
	);
	assert.equal(
		attachableSessions(rows, false),
		rows,
		"fail closed, by identity",
	);
});

test("the project Link-a-session picker is built from attachable sessions only", () => {
	const src = code(PROJECT_LINKS);
	assert.match(
		src,
		RE_R1_1,
		"the picker's options start from the attachable rows",
	);
	assert.match(src, RE_R1_2, "gated on the store's capability flag");
});

test("the chief-of-staff options are attachable sessions only", () => {
	const src = code(SETTINGS_PAGE);
	assert.match(src, RE_R1_3);
	assert.match(src, RE_R1_4);
});

test("Keep and link is offered on the picker's link refusal, not on start-session's", () => {
	const src = code(PROJECT_DETAIL);
	const onLink = src.match(RE_R1_5);
	assert.ok(onLink, "ProjectLinks receives onLink");
	assert.match(onLink[1], RE_R1_6);
	assert.match(onLink[1], RE_R1_7);
	assert.match(onLink[1], RE_R1_8);
	assert.match(onLink[1], RE_R1_9);
	assert.equal(
		src.match(RE_R1_10)?.length,
		1,
		"start-session links a session it just created (never temporary): no remedy there",
	);
});

// D1 (MAJOR): a temporary draft says so in words, and its toggle not by hue alone.
test("a temporary draft swaps the composer's invitation for its own keyed sentence", () => {
	assert.equal(
		temporaryDraftPlaceholderKey(true),
		"ui.chat.composer.placeholder.temporary",
	);
	assert.equal(temporaryDraftPlaceholderKey(false), null);
	assert.equal(temporaryDraftPlaceholderKey(undefined), null);
	const en = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.composer.json", "utf8"),
	);
	assert.match(en["ui.chat.composer.placeholder.temporary"], RE_R1_11);
	const src = code(CHAT_CONTENT);
	assert.match(src, RE_R1_12);
	assert.match(
		src,
		RE_R1_13,
		"the composer receives it in the invitation slot",
	);
});

test("the draft toggle's ON state is a pressed ground plus an edge, with aria-pressed", () => {
	const src = code(CHAT_HEADER);
	const toggle = src.match(RE_R1_14);
	assert.ok(toggle, "the draft toggle is rendered");
	assert.match(toggle[1], RE_R1_15);
	assert.match(
		toggle[1],
		RE_R1_16,
		"a shape cue (the edge) on the panel rail's pressed ground",
	);
});

// R1-2: never toward a peer.
test("a draft aimed at a peer never creates a temporary chat, and its toggle says why", () => {
	assert.equal(draftCreatesTemporary({ temporary: true }, true), true);
	assert.equal(
		draftCreatesTemporary({ temporary: true, peer: "mac" }, true),
		false,
	);
	assert.equal(draftCreatesTemporary({ temporary: true }, false), false);
	assert.equal(draftCreatesTemporary({}, true), false);
	assert.equal(draftCreatesTemporary(undefined, true), false);
	const header = code(CHAT_HEADER);
	assert.match(header, RE_R1_17);
	assert.match(header, RE_R1_18);
	const store = code(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
	);
	assert.match(store, RE_R1_19);
});

// R1-3: the tombstone flag does not outlive its conversation.
test("the temporary-deleted flag resets with `missing` on a conversation switch", () => {
	const src = code(STREAM_HOOK);
	assert.match(src, RE_R1_20);
});

// Q-2: the switcher's current temporary chat has its real title.
test("the switcher's rows keep the temporary chat on screen and skip the rest", () => {
	const rows = [
		{ session_id: "n1", title: "Normal", temporary: null },
		{ session_id: "t1", title: "Scratch regex", temporary: info() },
		{ session_id: "t2", title: "Other scratch", temporary: info() },
	];
	const sessions = switcherSessions(rows, true, "t1");
	assert.deepEqual(
		sessions.map((r) => r.session_id),
		["t1", "n1"],
	);
	assert.deepEqual(
		switcherSessions(rows, true, "n1").map((r) => r.session_id),
		["n1"],
	);
	assert.equal(switcherSessions(rows, false, "t1"), rows);
	assert.match(
		code(
			"src/renderer/src/features/session-switcher/use-session-switcher-keys.ts",
		),
		RE_R1_21,
	);
});

// D2/D3/Q-3: the title keeps its own line and the rows sit under the header label.
test("a group row is two lines, the title on top, inset to the header label", () => {
	const src = code(GROUP);
	const rowButton = src.match(RE_R1_22);
	assert.ok(rowButton);
	assert.match(rowButton[0], RE_R1_23);
	assert.match(rowButton[0], RE_R1_24);
	assert.match(rowButton[0], RE_R1_25);
	assert.doesNotMatch(
		rowButton[0],
		RE_R1_26,
		"the meta never takes the title's width",
	);
});

// D4 / C-18: one wording for the hold reasons across desktop, TUI and relay.
test("the hold sentences are the TUI's English, sentence-cased", () => {
	const en = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.sidebar_view.json", "utf8"),
	);
	const expected = {
		running: "Kept while it runs",
		on_screen: "Kept while on screen",
		open_ask: "Kept while a question is open",
		armed_wake: "Kept while a wake is set",
		armed_monitor: "Kept while a monitor is set",
		unread_mail: "Kept while a message is unread",
		operator_hold: "Kept by a hold",
		unseen_result: "Kept until you see the result",
		unsaved_files: "Kept while files are unsaved",
		linked: "Kept while pinned or linked",
		cannot_verify: "Kept: could not check",
	};
	for (const code of TEMPORARY_HOLD_CODES)
		assert.equal(
			en[`ui.chat.sidebar_view.temporary.hold.${code}`],
			expected[code],
			code,
		);
});

// D5: Keep / Make temporary sit with the state rows, not between Archive and Delete.
test("the header menu draws Keep / Make temporary above Archive, Delete keeps its own group", () => {
	const src = code(CHAT_HEADER);
	const keep = src.indexOf("data-temporary-keep");
	const make = src.indexOf("data-temporary-make");
	const archive = src.indexOf('t("ui.chat.header.archive_conversation")');
	const del = src.indexOf('t("ui.chat.header.delete")');
	assert.ok(keep > 0 && make > 0 && archive > 0 && del > 0);
	assert.ok(keep < archive && make < archive, "above Archive");
	const between = src.slice(make, archive);
	assert.match(between, RE_R1_27, "a separator between them");
	assert.match(src, RE_R1_28);
});
