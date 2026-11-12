import assert from "node:assert/strict";
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
	deletesInLabel,
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

test("minutes left round up and never fall below one; a held chat has none", () => {
	assert.equal(minutesLeft(info({ deletes_at: NOW + 4 * 60 + 1 }), NOW), 5);
	assert.equal(minutesLeft(info({ deletes_at: NOW + 240 }), NOW), 4);
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
