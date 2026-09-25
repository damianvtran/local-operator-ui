import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Session ARCHIVE and DELETE, from the renderer's op to what the store holds.
 *
 * Why this file exists. Both operations are about what a conversation is still
 * worth: archiving must be RECOVERABLE (a press that is refused leaves the row
 * where it was, and a row the user just archived must not reappear under the
 * pointer from an answer that was already in flight), and deleting is
 * IRREVERSIBLE (nothing brings it back, so nothing may be dropped locally that
 * the backend has not confirmed). Four properties hold them up, and each one
 * fails silently on its own:
 *
 *   1. THE WIRE SHAPE. `sessions.archive` is one POST carrying the DESIRED state
 *      (never a toggle), `sessions.delete` is a DELETE carrying the user's own
 *      confirmation, and both reads carry `include_archived` only when the
 *      caller asked - so the request this app sends for the ordinary case stays
 *      byte-identical to the one it sent before the flag existed.
 *   2. THE CURRENCY. A write is stamped with the answer counter, so a catalogue
 *      page whose request STARTED before the press cannot supersede it, while a
 *      page requested after it settles it. Without the stamp the two orders are
 *      indistinguishable and the row regresses under the pointer.
 *   3. THE PRESS CHANGES THE INTENT, NOT THE LIST. A press writes an UNANSWERED fact
 *      and touches no row (design round 8, D27): both row-facing readers take the answered
 *      view, so the list cannot lose a conversation - and the list's extent cannot dip -
 *      until the daemon answers. A refused press therefore reverts by dropping the fact
 *      (the row reads what it read before the press), and reports one sentence, once,
 *      with the backend's own words.
 *   4. THE CONFIRMATION. A delete that is refused (409, the live-session guard)
 *      leaves the store byte-identical, row and fact and candidate alike, so the
 *      dialog can stay open and say what happened.
 *
 * What is faked: the network (`desktopResult`) and `electron`. Everything
 * asserted is the shipped module.
 *
 * What this file is NOT: evidence that the control appears, that the row is
 * marked, or that the reveal does not reflow it. Those are claims about pixels,
 * and they are answered by the frames under `docs/evidence/session-archive/`
 * driven through the real sidebar.
 */

/* ------------------------------------------------------------- contract */

const contractBundle = await build({
	stdin: {
		contents: 'export * from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { desktopEndpoint, desktopRequestSchema } = await import(
	`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "2d5ad5da0025";
const OTHER = "e059761608ae";

const archive = (archived = true, sessionId = SESSION) => ({
	op: "sessions.archive",
	sessionId,
	archived,
});
const remove = (sessionId = SESSION) => ({
	op: "sessions.delete",
	sessionId,
	confirmed: true,
});

/**
 * The refusal WITHOUT its currency stamp, which is asserted here rather than compared: `at` is
 * the lane's ordering key (agent review round 3, R3-1), and its literal value comes from the
 * store's own counter, which this suite advances for unrelated reasons.
 */
const refusalOf = (state) => {
	const { at, ...rest } = state.archiveFailure ?? {};
	assert.equal(
		typeof at,
		"number",
		"the refusal carries the stamp the lane orders it by",
	);
	return rest;
};

test("the archive op carries the DESIRED state to the archive route, and nothing else", () => {
	assert.deepEqual(desktopEndpoint(archive()), {
		path: `/v1/desktop/sessions/${SESSION}/archive`,
		method: "POST",
		body: { archived: true },
	});
	// The other direction is the same call with the other boolean, not a second
	// route: `archived: false` is the state a user wants, and a wire that had only
	// a toggle could not express it (a retried toggle flips the conversation back).
	assert.deepEqual(desktopEndpoint(archive(false)).body, { archived: false });
	assert.equal(
		desktopEndpoint(archive(false)).path,
		desktopEndpoint(archive()).path,
	);
});

test("the archive schema admits only a real boolean, and refuses an extra key", () => {
	const parse = (request) => desktopRequestSchema.safeParse(request);
	assert.equal(parse(archive()).success, true);
	assert.equal(parse(archive(false)).success, true);
	/*
	 * A coerced boolean is REFUSED rather than interpreted, which is the whole
	 * point of the field's own docstring in the contract: `{"archived": "yes"}` and
	 * `{"archived": 1}` are callers that have not decided what they mean, and the
	 * backend's closed model refuses them too.
	 */
	for (const bad of ["yes", 1, 0, null, undefined]) {
		assert.equal(
			parse({ op: "sessions.archive", sessionId: SESSION, archived: bad })
				.success,
			false,
			`archived: ${JSON.stringify(bad)} is not a boolean`,
		);
	}
	assert.equal(
		parse({ ...archive(), requestId: SESSION }).success,
		false,
		"an extra key is refused: the op is idempotent by construction and carries no receipt",
	);
	assert.equal(
		parse({ op: "sessions.archive", sessionId: SESSION }).success,
		false,
		"a body with no desired state is refused by name rather than defaulted",
	);
});

test("the delete op is a DELETE carrying the user's confirmation, and refuses an unconfirmed one", () => {
	assert.deepEqual(desktopEndpoint(remove()), {
		path: `/v1/desktop/sessions/${SESSION}`,
		method: "DELETE",
		body: { confirmed: true },
	});
	const parse = (request) => desktopRequestSchema.safeParse(request);
	assert.equal(parse(remove()).success, true);
	/*
	 * `confirmed` is a LITERAL `true`, and the three refusals below are the whole
	 * reason: a client that has not asked cannot express this request, a stray
	 * `false` cannot be read as "the user said no" and silently dropped, and a
	 * truthy value is not a person's answer.
	 */
	assert.equal(
		parse({ op: "sessions.delete", sessionId: SESSION }).success,
		false,
		"a delete with no confirmation is refused",
	);
	assert.equal(
		parse({ op: "sessions.delete", sessionId: SESSION, confirmed: false })
			.success,
		false,
		"`confirmed: false` is not a confirmation",
	);
	assert.equal(
		parse({ op: "sessions.delete", sessionId: SESSION, confirmed: 1 }).success,
		false,
		"a truthy `confirmed` is not a person's answer",
	);
	assert.equal(
		parse({ ...remove(), requestId: SESSION }).success,
		false,
		"the delete carries no receipt: a retried delete is answered 404, which is the outcome the user asked for",
	);
});

test("include_archived is sent only when it was asked for, on both reads", () => {
	// Absent means absent: the ordinary request is byte-identical to the one this
	// app sent before the flag existed, so a backend that has not learned it keeps
	// answering the same question.
	assert.equal(
		desktopEndpoint({ op: "sessions.list", limit: 500 }).path,
		"/v1/desktop/sessions?limit=500",
	);
	assert.equal(
		desktopEndpoint({ op: "sessions.list", limit: 500, include_archived: true })
			.path,
		"/v1/desktop/sessions?limit=500&include_archived=true",
	);
	const search = (include_archived) => {
		const endpoint = desktopEndpoint({
			op: "sessions.search",
			q: "quarterly",
			include_archived,
		});
		return {
			has: endpoint.path.includes("include_archived=true"),
			// The echoed query is what `useChatSearch` checks the answer against, and
			// the flag must not have disturbed it.
			query: new URLSearchParams(endpoint.path.split("?")[1]).get("q"),
		};
	};
	assert.deepEqual(search(undefined), { has: false, query: "quarterly" });
	assert.deepEqual(search(true), { has: true, query: "quarterly" });
	const parse = (request) => desktopRequestSchema.safeParse(request);
	assert.equal(
		parse({ op: "sessions.list", include_archived: "yes" }).success,
		false,
		"a coerced flag is refused on the list too",
	);
});

/* ----------------------------------------------------------------- store */

// The store's persistence needs a `localStorage`, and `desktopResult` is the
// network: the same fixtures `attention-seen.test.mjs` uses.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
let requests = [];
let answer;

const serve = (receipt) => {
	requests = [];
	answer = async (request) => {
		requests.push(request);
		return typeof receipt === "function" ? receipt(request) : receipt;
	};
};
/*
 * A REFUSAL IS RAISED INSIDE THE FIXTURE, not in this file, and that is not
 * tidiness: `DesktopControlError` is the class the store's own `instanceof`
 * checks against, and a copy thrown from the test's module graph is a DIFFERENT
 * class - the failure would read as "no status", which is exactly the assertion
 * these two tests exist to make.
 */
/*
 * A refusal, with the daemon's own TOKEN where a test is about a guard: the store
 * keys `guarded` on `detail.code` rather than on the status (agent review round 4,
 * R4-3), so a fixture that faked only the status would be testing a client that no
 * longer exists.
 */
const refuse = (status, message, code) => ({
	__failure: { status, message, code },
});
serve({});

const storeBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			' export * from "./src/renderer/src/features/chat/chat-archived";' +
			' export * from "./src/renderer/src/features/chat/delete-conversation";',
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "session-archive-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "session-archive-fixture" }),
				);
				/*
				 * `packages: "external"` is not available here, so the two modules the
				 * store imports for its echo seam and its desktop feed are replaced by
				 * their real sources where they are inert, and by stubs where they are
				 * not: the store must not try to open a socket in a test process.
				 */
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "session-archive-fixture" }),
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "session-archive-fixture" },
					(args) => ({
						contents: {
							transport: `import { DesktopControlError, UserFacingError, userFacingMessage } from ${JSON.stringify(
								`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
							)};
export { DesktopControlError, UserFacingError, userFacingMessage };
export const desktopResult = async request => {
	const receipt = await globalThis.__archiveAnswer(request);
	if (receipt && receipt.__failure) {
		throw new DesktopControlError(
			receipt.__failure.status,
			receipt.__failure.message,
			/*
			 * The TOKEN is the FOURTH argument (status, message, cause, code), which is
			 * the shape the transport itself uses - passing it third silently lands it on
			 * cause, and a fixture that did that would leave the store keying on an
			 * undefined code and reporting every guard as unclaimed. No backticks in this
			 * block: the fixture is a template literal, and one would end it here.
			 */
			undefined,
			receipt.__failure.code,
		);
	}
	return receipt;
};`,
							echo: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const retractLocalEcho = () => "retracted";
export const discardPendingEchoes = () => undefined;`,
						}[args.path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
globalThis.__archiveAnswer = (request) => answer(request);
const storeModule = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);
const { useCanonicalSessionsStore: store } = storeModule;
const { answeredArchiveRows, visibleRows } = storeModule;

const page = (sessions, extra = {}) => ({
	sessions: sessions.map(({ session_id, title, archived }) => ({
		id: session_id,
		name: title,
		mtime: 1,
		archived,
	})),
	truncated: false,
	...extra,
});

/**
 * Stage a catalogue, with the archived flags the caller names.
 *
 * The request log is NOT cleared afterwards, deliberately: the first assertion a
 * test makes is usually about the page read itself (what the fetch asked for),
 * and a fixture that tidied up after itself would hide the evidence that the
 * panel asks for the archived rows at all.
 */
const seed = async (rows) => {
	serve(page(rows));
	await store.getState().fetchSessions();
	const held = store.getState().sessions;
	assert.equal(
		held.length,
		rows.length,
		`the catalogue was not staged: ${JSON.stringify(held)}`,
	);
	return held;
};

test("the catalogue is asked for the archived rows, and then hides them itself", async () => {
	const held = await seed([
		{ session_id: SESSION, title: "Kept", archived: false },
		{ session_id: OTHER, title: "Filed away", archived: true },
	]);
	/*
	 * The page carries BOTH, and that is the design rather than an accident: the
	 * panel partitions the archived ones out of every default list itself, which is
	 * what lets one fetch also answer the two questions a hiding page cannot - the
	 * open conversation's own state, and an unarchive control on a row found by
	 * search. Asserted on the wire so the two halves cannot drift.
	 */
	assert.equal(
		requests[0].include_archived,
		true,
		"the catalogue read must ask for the archived rows",
	);
	assert.equal(held.length, 2, "both rows are held by the store");
	assert.deepEqual(
		visibleRows(held, true).map((row) => row.session_id),
		[SESSION],
		"and the default list draws only the live one",
	);
	// With the capability absent the partition does not run AT ALL, and the same
	// array comes back: a fact this client holds (an optimistic archive) must not
	// hide a row on a backend that offers no control to restore it with.
	assert.equal(visibleRows(held, false), held);
});

test("an accepted press settles the fact and raises its offer in ONE update, and touches no row", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve({ session_id: SESSION, archived: true });
	/*
	 * ONE UPDATE, READ AT THE SUBSCRIBER (design round 8, D27's second clause). The departure
	 * an accepted press intends and the Undo offer that answers it have to land in the SAME
	 * store commit: raised a microtask later - which is where the callers raised it - the
	 * commit between them is the one whose list extent dips below the reader's position
	 * (`224.5` of content against a `248` box), and the browser's clamp then takes the
	 * position with nothing to give it back. Asserted at the subscriber rather than at the
	 * values, because two `set`s would satisfy a values-only check and still be two commits.
	 *
	 * AND NO ROW IS TOUCHED, which is the first clause: the press may change what the
	 * conversation is about to be, never what the list holds.
	 */
	const seen = [];
	const stop = store.subscribe((state) => {
		seen.push({
			answered: state.archiveFacts[SESSION]?.answered === true,
			offer: state.archiveUndo?.sessionId === SESSION,
			row: state.sessions[0]?.archived,
		});
	});
	await store.getState().setSessionArchived(SESSION, true, "Kept");
	stop();
	assert.deepEqual(requests.at(-1), {
		op: "sessions.archive",
		sessionId: SESSION,
		archived: true,
	});
	const settled = seen.filter((entry) => entry.answered);
	assert.ok(
		settled.length >= 1,
		`the fact was never settled: ${JSON.stringify(seen)}`,
	);
	assert.deepEqual(
		settled,
		settled.map(() => ({ answered: true, offer: true, row: false })),
		`a settlement without its offer is a second commit: ${JSON.stringify(seen)}`,
	);
	assert.ok(
		seen.every((entry) => entry.row === false),
		`the press must not touch a row: ${JSON.stringify(seen)}`,
	);
	const state = store.getState();
	assert.equal(
		state.archiveFacts[SESSION].archived,
		true,
		"and the client's own fact is what makes the press invertible",
	);
	assert.equal(
		state.archiveUndo.sessionId,
		SESSION,
		"the offer is the store's own write now, not a caller's",
	);
	assert.equal(state.archiveFailure, null);
});

test("a refused press drops the intent it wrote, and says so once", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve(refuse(409, "This conversation is in use by a running turn."));
	await store.getState().setSessionArchived(SESSION, true, "Kept");
	const state = store.getState();
	/*
	 * THERE IS NO ROW TO PUT BACK: the press wrote a fact and touched nothing else (D27), so
	 * the revert IS dropping the fact - and the row reads what it read before the press,
	 * which is the same observable claim the version that patched the row made.
	 */
	assert.equal(
		state.sessions[0].archived,
		false,
		"the row still carries the wire's value, untouched by the press",
	);
	assert.equal(
		state.archiveFacts[SESSION],
		undefined,
		"and the fact goes with it: nothing this client wrote settles a refused write",
	);
	assert.deepEqual(refusalOf(state), {
		sessionId: SESSION,
		archived: true,
		title: "Kept",
		detail: "This conversation is in use by a running turn.",
	});
	/*
	 * The desired state, not the state on screen: a Retry re-sends what the user
	 * asked for rather than whatever the catalogue now says, which after a merge
	 * could be the value the failed press failed to change.
	 */
	assert.equal(state.archiveFailure.archived, true);
});

test("a refusal never reinstates an unanswered intent, and asks the daemon instead", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	/*
	 * R5-2's REPRO, at this suite's own fixture (agent review round 5). Press 1 (archive) is displaced
	 * by press 2 (unarchive) while both are in flight; press 1's acceptance arrives FIRST and bails as
	 * superseded (the currency rule), and press 2 is then refused. The version this pins put press 1's
	 * fact back VERBATIM - an UNANSWERED intent, which both row-facing readers skip - so the client
	 * kept no readable knowledge of an archive the daemon had just ACCEPTED: measured
	 * `{"fact":{"archived":true,"at":2,"answered":false},"listed":["2d5ad5da0025"]}`.
	 *
	 * THE RULE NOW: a refusal puts back only a fact that had been ANSWERED; when the fact it replaced
	 * was an intent, the refused write is removed and the PAGE is read again. The client then learns
	 * the truth instead of holding a fact no reader can use or a value it has no reason to trust.
	 */
	const inFlightAnswers = [];
	serve((request) => {
		if (request.op !== "sessions.archive")
			return page([{ session_id: SESSION, title: "Kept", archived: true }]);
		return new Promise((resolve) => inFlightAnswers.push(resolve));
	});
	const pagesBefore = () =>
		requests.filter((request) => request.op !== "sessions.archive").length;
	const before = pagesBefore();
	const first = store.getState().setSessionArchived(SESSION, true, "Kept");
	const second = store.getState().setSessionArchived(SESSION, false, "Kept");
	assert.equal(
		inFlightAnswers.length,
		2,
		"both presses reached the wire, and neither has been answered",
	);
	const displaced = store.getState().archiveFacts[SESSION];
	assert.equal(
		displaced.answered,
		false,
		"the newer press owns the fact while both are in flight",
	);
	/* Press 1's acceptance lands first, with press 2's intent owning the fact. */
	inFlightAnswers[0]({ session_id: SESSION, archived: true });
	await first;
	assert.deepEqual(
		store.getState().archiveFacts[SESSION],
		displaced,
		"a superseded acceptance settles nothing",
	);
	/* And then press 2 is refused. */
	inFlightAnswers[1](
		refuse(409, "This conversation is in use by a running turn."),
	);
	await second;
	const state = store.getState();
	assert.equal(
		state.archiveFacts[SESSION],
		undefined,
		"the refusal puts back no unanswered intent",
	);
	assert.equal(
		pagesBefore(),
		before + 1,
		"and it asks the catalogue again rather than keeping what it cannot read",
	);
	/* The answer to that read is what keeps the reader's list honest. */
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(
		visibleRows(
			answeredArchiveRows(
				store.getState().sessions,
				store.getState().archiveFacts,
			),
			true,
		).map((row) => row.session_id),
		[],
		"so a conversation the daemon holds archived is not drawn in a list that excludes archived rows",
	);
});

test("a refused press puts back the fact it replaced, so an archived conversation stays archived", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve({ session_id: SESSION, archived: true });
	await store.getState().setSessionArchived(SESSION, true, "Kept");
	const settled = store.getState().archiveFacts[SESSION];
	assert.equal(settled.archived, true, "the archive stands");
	/*
	 * THE REGRESSION THIS CELL EXISTS FOR, found by the walk's refused-undo step rather than by
	 * this suite (2026-09-22, the D27 pass): the fact is now what both row-facing readers read, so
	 * a refused press that merely DELETED its own write dropped the client's knowledge along with
	 * the intent - and the row, whose `archived` field is still the wire's value from the page
	 * BEFORE the accepted archive, came back into a list that excludes archived rows (measured:
	 * `rowLabel` "Archive ..." and `rowStillListed: true` where the walk wants the row gone).
	 */
	serve(refuse(409, "This conversation is in use by a running turn."));
	await store.getState().setSessionArchived(SESSION, false, "Kept");
	const state = store.getState();
	assert.deepEqual(
		state.archiveFacts[SESSION],
		settled,
		"the refused undo puts back the fact it replaced, stamp and all",
	);
	assert.deepEqual(
		visibleRows(
			answeredArchiveRows(state.sessions, state.archiveFacts),
			true,
		).map((row) => row.session_id),
		[],
		"and the row stays out of every list that excludes archived rows",
	);
});

test("a refusal is reported even when a newer page has settled the write's fact", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	/*
	 * The write is slow and the page is not, and the page's request STARTS AFTER the
	 * press - so its answer settles the press's fact before the rejection arrives, with
	 * the row already back to the value the page carries. THE REVERT IS THEREFORE ALREADY
	 * DONE, and the refusal must still be reported, because the write really was refused
	 * and the press really did nothing (agent review round 1, R-1's family; QA round 1,
	 * U3's store-side candidate). The panel's list read is a 5s poll and every catalogue
	 * frame, so this ordering is ordinary rather than exotic.
	 */
	serve(async (request) => {
		if (request.op === "sessions.archive") {
			await new Promise((resolve) => setTimeout(resolve, 200));
			return refuse(409, "This conversation is in use by a running turn.");
		}
		return page([{ session_id: SESSION, title: "Kept", archived: false }]);
	});
	const press = store.getState().setSessionArchived(SESSION, true, "Kept");
	// After the press, so the page outranks the write's own stamp...
	await new Promise((resolve) => setTimeout(resolve, 20));
	await store.getState().fetchSessions();
	const accepted = await press;
	assert.equal(accepted, false, "the write was refused");
	assert.deepEqual(
		refusalOf(store.getState()),
		{
			sessionId: SESSION,
			archived: true,
			title: "Kept",
			detail: "This conversation is in use by a running turn.",
		},
		"the refusal is a fact about the press, and it outlives the fact about the row",
	);
});

test("a page in flight across a press cannot resurrect the row it archived", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	let release;
	serve(
		() =>
			new Promise((resolve) => {
				// The page's OWN request starts now, before the press below.
				release = () =>
					resolve(
						page([{ session_id: SESSION, title: "Kept", archived: false }]),
					);
			}),
	);
	const reading = store.getState().fetchSessions();
	serve({ session_id: SESSION, archived: true });
	await store.getState().setSessionArchived(SESSION, true, "Kept");
	release();
	await reading;
	/*
	 * The answer was ASKED ABOUT before the press and arrives after it, carrying
	 * the pre-press value. It cannot SETTLE the write: the write is stamped with the
	 * answer counter and outranks every answer older than its own request.
	 *
	 * AND THE ROW IS TOUCHED BY NEITHER (design round 8, D27): the page's value stands on the
	 * row - the row carries the ANSWERED state, the fact the intended one - so the claim
	 * "the row does not come back" is now carried by the answered view every list reads
	 * through, not by the row's own value. Without that view the row reappears under the
	 * pointer one round trip after the user archived it.
	 */
	assert.equal(
		store.getState().archiveFacts[SESSION].archived,
		true,
		"a page that predates the press must not settle it",
	);
	assert.equal(
		store.getState().sessions[0].archived,
		false,
		"the page's own value stands on the row, deliberately",
	);
	assert.deepEqual(
		visibleRows(
			answeredArchiveRows(
				store.getState().sessions,
				store.getState().archiveFacts,
			),
			true,
		).map((row) => row.session_id),
		[],
		"and the answered view keeps it out of every list",
	);
});

test("a page requested after the write settles it, and the fact goes", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve({ session_id: SESSION, archived: true });
	await store.getState().setSessionArchived(SESSION, true, "Kept");
	// The other surface unarchived it: a fresh page (requested now) says so, and
	// the client's memory must yield to it rather than outrank it forever - which
	// is what makes the state the BACKEND's.
	serve(page([{ session_id: SESSION, title: "Kept", archived: false }]));
	await store.getState().fetchSessions();
	const state = store.getState();
	/*
	 * The row reads the page either way now (D27: the press patches no row), so the assertion
	 * that carries this cell is the FACT's: the answer outranks the client's memory and the
	 * memory goes with it.
	 */
	assert.equal(state.sessions[0].archived, false, "the row reads the page");
	assert.equal(
		state.archiveFacts[SESSION],
		undefined,
		"and a fact an answer has settled is dropped",
	);
});

test("a search answer settles only the ids it speaks about", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve({ session_id: SESSION, archived: true });
	await store.getState().setSessionArchived(SESSION, true, "Kept");
	const seq = store.getState().beginAnswer();
	store.getState().applySearchAnswer(seq, [{ id: OTHER }]);
	assert.equal(
		store.getState().archiveFacts[SESSION]?.archived,
		true,
		"a query-scoped answer that never mentions the row is not evidence about it",
	);
	const later = store.getState().beginAnswer();
	store.getState().applySearchAnswer(later, [{ id: SESSION }]);
	assert.equal(
		store.getState().archiveFacts[SESSION],
		undefined,
		"an answer that DOES mention it, requested after the write, settles it",
	);
});

test("a delete is sent confirmed, and drops the row only once the backend answers", async () => {
	await seed([
		{ session_id: SESSION, title: "Kept", archived: false },
		{ session_id: OTHER, title: "Also kept", archived: false },
	]);
	serve({ session_id: SESSION, deleted: true });
	const outcome = await store.getState().deleteSession(SESSION);
	assert.deepEqual(outcome, { ok: true });
	assert.deepEqual(requests.at(-1), {
		op: "sessions.delete",
		sessionId: SESSION,
		confirmed: true,
	});
	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		[OTHER],
		"the addressed conversation is gone and its neighbour is not",
	);
});

test("a refused delete leaves the store byte-identical and keeps the sentence", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve(
		refuse(
			409,
			"This conversation is running. Stop it before deleting.",
			"session_delete_refused",
		),
	);
	const outcome = await store.getState().deleteSession(SESSION);
	assert.deepEqual(outcome, {
		ok: false,
		guarded: true,
		detail: "This conversation is running. Stop it before deleting.",
	});
	/*
	 * AND THE WAKE GUARD LANDS THE SAME FIELD, because the client cannot tell the
	 * four guards apart: `409` is one arm of the route's ladder for a live session,
	 * an armed wake, unread mail and a guard whose store could not be read, and the
	 * backend's own docstring says the code does not vary by which fired while the
	 * SENTENCE names the remedy (QA round 3, Q11). A client that reported a cause
	 * here would be guessing - which is how an armed-wake refusal came to be drawn
	 * with advice about stopping a session - so what is asserted is that the route's
	 * sentence is kept verbatim whichever guard authored it.
	 */
	serve(
		refuse(
			409,
			"That conversation has a wake armed for it. Reopen it and ask it to cancel the wake, or delete its wakes/<session-id>.json entry, before deleting it.",
			"session_delete_refused",
		),
	);
	const wake = await store.getState().deleteSession(SESSION);
	assert.deepEqual(wake, {
		ok: false,
		guarded: true,
		detail:
			"That conversation has a wake armed for it. Reopen it and ask it to cancel the wake, or delete its wakes/<session-id>.json entry, before deleting it.",
	});
	/*
	 * NOT optimistic, which is the difference between this op and archiving: a
	 * delete this client invented cannot be undone by a later read, so the row
	 * stays until the backend says it is gone.
	 */
	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		[SESSION],
	);
});

test("an id the backend does not have is the outcome the user asked for", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	serve(refuse(404, "Unknown session."));
	assert.deepEqual(await store.getState().deleteSession(SESSION), { ok: true });
	assert.deepEqual(store.getState().sessions, []);
});

test("a 409 that is not the delete guard's token does not claim one (R4-3)", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	/*
	 * The 409 arm is shared with unrelated refusals - an attachment, the profile
	 * registry, a superseded completion token, and the route's generic
	 * `HTTPException(409, ...)` - so the client must not read "a guard refused" out of
	 * the status alone. The sentence is still kept verbatim, which is what the reader
	 * sees; only the remedy is withheld, because the remedy is about a delete guard.
	 */
	serve(refuse(409, "Something else is holding this conversation."));
	const outcome = await store.getState().deleteSession(SESSION);
	assert.deepEqual(outcome, {
		ok: false,
		guarded: false,
		detail: "Something else is holding this conversation.",
	});
});

test("the delete candidate is the dialog's whole state", async () => {
	await seed([{ session_id: SESSION, title: "Kept", archived: false }]);
	assert.equal(store.getState().deleteCandidate, null);
	store.getState().requestSessionDelete(SESSION);
	assert.equal(store.getState().deleteCandidate, SESSION);
	store.getState().requestSessionDelete(null);
	assert.equal(store.getState().deleteCandidate, null);
});

/*
 * THE DELETED-ROW CURRENCY, which is the shape agent review round 1 (M1)
 * reproduced: `forgetSession` filtered the array and recorded nothing, so a page
 * whose request had already started landed afterwards through
 * `replaceSessionRows` and put the conversation straight back - drawn, clickable
 * and re-deletable, for a delete that had been confirmed. The archive press has
 * been protected against exactly this since it was written; these are the same
 * two arms for the delete, plus the surface the delete itself never answered: a
 * search answer cached for 30 s.
 */
test("a page in flight across a delete cannot resurrect the conversation", async () => {
	await seed([{ session_id: SESSION, title: "Doomed", archived: false }]);
	let release;
	serve(
		() =>
			new Promise((resolve) => {
				// The page's OWN request starts now, before the delete below.
				release = () =>
					resolve(
						page([{ session_id: SESSION, title: "Doomed", archived: false }]),
					);
			}),
	);
	const reading = store.getState().fetchSessions();
	serve({ session_id: SESSION, deleted: true });
	assert.deepEqual(await store.getState().deleteSession(SESSION), { ok: true });
	release();
	await reading;
	assert.deepEqual(
		store.getState().sessions,
		[],
		"an answer asked about before the delete must not put the row back",
	);
	/*
	 * The tombstone is what did it, and it carries the name the pane's header
	 * needs once the row is gone (UX round 1, U1 - the pane says the conversation
	 * is deleted and must still say WHICH one).
	 */
	assert.equal(store.getState().forgotten[SESSION].title, "Doomed");
});

test("a page that does NOT carry the id is not a resurrection, and settles nothing (agent review round 2, R2-1)", async () => {
	await seed([
		{ session_id: SESSION, title: "Doomed", archived: false },
		{ session_id: OTHER, title: "Kept", archived: false },
	]);
	/*
	 * THE REVIEWER'S REPRO, in its order, because the order is the defect: a search
	 * question is asked BEFORE the delete and its answer is held; the delete lands;
	 * then a catalogue page that outranks the tombstone answers without the row. The
	 * old rule settled the tombstone there - "the page is the read whose membership
	 * claim is complete" - and the held answer, arriving afterwards, put the
	 * permanently deleted conversation back through the join. Deterministic, no race
	 * needed: `session-search.ts` caches per query for 30 s, and the store has four
	 * page triggers.
	 */
	const held = store.getState().beginAnswer();
	serve({ session_id: SESSION, deleted: true });
	await store.getState().deleteSession(SESSION);
	serve(page([{ session_id: OTHER, title: "Kept", archived: false }]));
	await store.getState().fetchSessions();
	assert.notEqual(
		store.getState().forgotten[SESSION],
		undefined,
		"a page that does not carry the id says exactly what the tombstone says, so it settles nothing",
	);
	// And the answer that was in flight across the write still cannot draw it.
	store.getState().applySearchAnswer(held, [{ id: SESSION, name: "Doomed" }]);
	assert.notEqual(store.getState().forgotten[SESSION], undefined);
	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		[OTHER],
	);
});

test("a page that CARRIES the id back IS the resurrection that settles the tombstone", async () => {
	await seed([
		{ session_id: SESSION, title: "Doomed", archived: false },
		{ session_id: OTHER, title: "Kept", archived: false },
	]);
	serve({ session_id: SESSION, deleted: true });
	await store.getState().deleteSession(SESSION);
	/*
	 * The one read that really does speak about the id: something recreated the
	 * conversation, so this window's record of its absence is now false. Without this
	 * arm the tombstone would outlive the conversation's return and hide a row that
	 * exists - the same class of lie, in the other direction.
	 */
	serve(
		page([
			{ session_id: SESSION, title: "Doomed again", archived: false },
			{ session_id: OTHER, title: "Kept", archived: false },
		]),
	);
	await store.getState().fetchSessions();
	assert.equal(store.getState().forgotten[SESSION], undefined);
	assert.deepEqual(
		store
			.getState()
			.sessions.map((row) => row.session_id)
			.sort(),
		[SESSION, OTHER].sort(),
	);
});

test("a stream that answers not-found lands the pane on the notice instead of rolling back (QA round 1, Q1)", async () => {
	const DEAD = "a1b2c3d4e5f6";
	await seed([{ session_id: OTHER, title: "Kept", archived: false }]);
	/*
	 * A DEEP LINK TO A DELETED CONVERSATION, cold - the reload leg QA measured. The
	 * click no longer spends a `sessions.get` guard read (it was a second facade
	 * acquire racing the stream for the same locks); the conversation's own stream
	 * is what speaks, and its 404 reaches the store through `confirmSessionMissing`
	 * (`chat-page`). The conversation is GONE rather than unreadable, so the view
	 * stays on the target and the id is a tombstone - which is what the pane reads
	 * to reach the notice, on a cold start and across a reload.
	 */
	serve(page([{ session_id: OTHER, title: "Kept", archived: false }]));
	const landed = await store.getState().openSession(DEAD);
	assert.equal(landed, true, "the switch stands: the view is on the target");
	store.getState().confirmSessionMissing(DEAD);
	assert.notEqual(
		store.getState().forgotten[DEAD],
		undefined,
		"a 404 from the stream is a tombstone, which is what the pane reads to reach the notice",
	);
	assert.equal(store.getState().activeSessionId, DEAD);
	assert.equal(store.getState().validatingSessionId, null);
	/*
	 * AND NOTHING ELSE TOMBSTONES. A transient stream failure is the pane's own
	 * `reconnecting`/`unavailable` state, never a claim that the conversation is
	 * gone: with no 404 reported the id is not forgotten and the view stays put.
	 */
	store.setState({ activeSessionId: OTHER, forgotten: {} });
	await store.getState().openSession(DEAD);
	assert.equal(store.getState().activeSessionId, DEAD);
	assert.equal(store.getState().forgotten[DEAD], undefined);
});

test("a search answer does not settle a tombstone", async () => {
	await seed([{ session_id: SESSION, title: "Doomed", archived: false }]);
	serve({ session_id: SESSION, deleted: true });
	await store.getState().deleteSession(SESSION);
	/*
	 * A cached answer (30 s `staleTime` in `session-search.ts`) can still name the
	 * conversation, so it must not be allowed to settle the tombstone the way a
	 * page does - otherwise the same cached answer would start drawing the row the
	 * join is filtering out. The join's own half of this is asserted in
	 * `chat-search.test.mjs`, where the module lives.
	 */
	const seq = store.getState().beginAnswer();
	store.getState().applySearchAnswer(seq, [{ id: SESSION }]);
	assert.notEqual(
		store.getState().forgotten[SESSION],
		undefined,
		"a query-scoped answer is not a membership claim",
	);
	assert.deepEqual(store.getState().sessions, []);
});

test("a delete survives a reload: the tombstone is persisted, and it self-heals on a carrying page (QA round 2, Q1's reload half)", async () => {
	await seed([
		{ session_id: SESSION, title: "Doomed", archived: false },
		{ session_id: OTHER, title: "Kept", archived: false },
	]);
	serve({ session_id: SESSION, deleted: true });
	await store.getState().deleteSession(SESSION);
	/*
	 * WHAT THE RELOAD READS. The store persists through `partialize` into
	 * localStorage under this name (the test file stubs localStorage), and the
	 * tombstone has to be in it - otherwise a reload has nothing to tell the pane the
	 * conversation is gone, which is exactly the state QA's second half measured: a
	 * daemon still answering 200 for the id it was told to delete, a transcript that
	 * hydrates, and a writable composer over a removed conversation.
	 */
	const persisted = JSON.parse(
		globalThis.localStorage.getItem("canonical-sessions-storage"),
	);
	const held = persisted.state.forgotten ?? {};
	assert.notEqual(
		held[SESSION],
		undefined,
		`the tombstone must be persisted for a reload to read: ${JSON.stringify(persisted.state.forgotten)}`,
	);
	/*
	 * AND ITS STAMP IS NOT CARRIED ACROSS. `at` orders a tombstone against reads in
	 * flight inside one process, and a reload has none; persisted as 0, every page the
	 * fresh process asks for outranks it, so the resurrection rule still revives a
	 * conversation the store really does carry again.
	 */
	assert.equal(held[SESSION].at, 0);
	/*
	 * Which is what makes it SELF-HEALING rather than a permanent hiding: the same
	 * store, restored, drops the tombstone on the first page that carries the id.
	 */
	store.setState({
		forgotten: { [SESSION]: { at: 0, title: "Doomed" } },
		sessions: [{ session_id: OTHER, title: "Kept", archived: false }],
	});
	serve(
		page([
			{ session_id: SESSION, title: "Doomed", archived: false },
			{ session_id: OTHER, title: "Kept", archived: false },
		]),
	);
	await store.getState().fetchSessions();
	assert.equal(
		store.getState().forgotten[SESSION],
		undefined,
		"a page that carries the id back settles the restored tombstone",
	);
	assert.deepEqual(
		store
			.getState()
			.sessions.map((row) => row.session_id)
			.sort(),
		[SESSION, OTHER].sort(),
	);
});
