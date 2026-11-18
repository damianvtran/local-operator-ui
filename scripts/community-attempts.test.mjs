import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * ONE KEY PER ATTEMPT (PR #1973 review round 1, M1).
 *
 * The defect: every Send/Retry minted a fresh Idempotency-Key, so an attempt
 * whose answer was lost (a 30 s deadline, a daemon 502 `community_unreachable`,
 * a status read that failed mid-follow-up, a conversation switch while
 * `checking`) was re-sent as a NEW post. The hub replays a REUSED key's first
 * outcome and treats a new key as a new post, so the same draft could publish
 * twice and count twice against the sender's limits.
 *
 * Each case below drives the SHIPPED `CommunityAttempts` (bundled through
 * esbuild, the house pattern) against a scripted hub and asserts the exact
 * sequence of keys it sends - the fact that decides whether a post can be
 * duplicated, and one no screenshot can show. The clock's `wait` resolves at
 * once, so a follow-up's 2 s cadence costs nothing here.
 */
const bundle = await build({
	stdin: {
		contents: [
			`export * from "./src/renderer/src/features/community/community-attempts";`,
			`export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";`,
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	write: false,
	logLevel: "silent",
	tsconfig: "tsconfig.app.json",
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const KEY = (n) => `ck_${String(n).padStart(24, "0")}`;
const REF = "MOD-AB12-CD34";

/** The failures a call can end in, as the transport throws them. */
const deadline = () => new m.DesktopControlError(null, "deadline");
const unreachable502 = () =>
	new m.DesktopControlError(
		502,
		"x",
		undefined,
		"community_unreachable",
		undefined,
		{ code: "community_unreachable" },
	);
const answered = (status, detail) =>
	new m.DesktopControlError(
		status,
		"x",
		undefined,
		detail.code,
		undefined,
		detail,
	);
const notFound = () => answered(404, { code: "community_not_found" });

const outcome = (key, state, extra = {}) => ({
	idempotency_key: key,
	state,
	...(state === "published" ? { message_id: "msg_1" } : {}),
	...(state === "refused"
		? {
				refusal: {
					status: "refused",
					category: "spam_or_promotion",
					reference: REF,
				},
			}
		: {}),
	...extra,
});

/**
 * A scripted hub. Each op takes a queue of answers (a value, an Error to throw,
 * or a function of the key); every call is logged with its key so a case can
 * assert exactly what was sent.
 */
function hub(script = {}) {
	const calls = [];
	const queues = {
		submit: [...(script.submit ?? [])],
		status: [...(script.status ?? [])],
		cancel: [...(script.cancel ?? [])],
	};
	const answer = async (op, key) => {
		calls.push(`${op}:${key}`);
		const next = queues[op].shift();
		if (next === undefined) throw new Error(`unscripted ${op}(${key})`);
		const value = typeof next === "function" ? next(key) : next;
		if (value instanceof Error) throw value;
		return value;
	};
	return { calls, answer };
}

/** One composer bound to one target, recording phases and callbacks. */
function composer(h, target = "c\u0000general\u0000") {
	const seen = {
		phases: [],
		published: [],
		history: 0,
		guidelines: 0,
	};
	const ctx = {
		target,
		submit: (key) => h.answer("submit", key),
		status: (key) => h.answer("status", key),
		cancel: (key) => h.answer("cancel", key),
		setPhase: (phase) => seen.phases.push(phase),
		onPublished: (id) => seen.published.push(id),
		onHistoryChanged: () => {
			seen.history += 1;
		},
		onGuidelinesChanged: () => {
			seen.guidelines += 1;
		},
	};
	return { ctx, seen, last: () => seen.phases.at(-1) };
}

function controller() {
	let n = 0;
	return new m.CommunityAttempts({
		clock: { wait: async () => {}, now: () => 1_000_000 },
		mintKey: () => KEY(++n),
	});
}

const draft = { text: "hello community", images: [] };

/** Let every queued follow-up step run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("M1 timeout: Retry asks about the SAME key; a late publish clears the draft and nothing is re-sent", async () => {
	const h = hub({
		submit: [deadline()],
		status: [(key) => outcome(key, "published")],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	assert.equal(c.last().kind, "offline");
	assert.equal(a.pendingFor(c.ctx.target)?.key, KEY(1), "kept, not dropped");
	await a.send(c.ctx, draft); // Retry
	assert.deepEqual(h.calls, [`submit:${KEY(1)}`, `status:${KEY(1)}`]);
	assert.deepEqual(c.seen.published, ["msg_1"]);
	assert.equal(c.last().kind, "idle");
	assert.equal(a.pendingFor(c.ctx.target), undefined);
});

test("M1 daemon 502: the hub never stored the key, so the retry re-submits under the SAME key", async () => {
	const h = hub({
		submit: [unreachable502(), (key) => outcome(key, "published")],
		status: [notFound()],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	assert.equal(c.last().kind, "offline");
	await a.send(c.ctx, draft);
	assert.deepEqual(h.calls, [
		`submit:${KEY(1)}`,
		`status:${KEY(1)}`,
		`submit:${KEY(1)}`,
	]);
	assert.deepEqual(c.seen.published, ["msg_1"]);
});

test("M1 still checking: Retry follows the first attempt instead of racing it", async () => {
	const h = hub({
		submit: [deadline()],
		status: [
			(key) => outcome(key, "checking"),
			(key) => outcome(key, "checking"),
			(key) => outcome(key, "published"),
		],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	await a.send(c.ctx, draft);
	await settle();
	await settle();
	assert.deepEqual(h.calls, [
		`submit:${KEY(1)}`,
		`status:${KEY(1)}`,
		`status:${KEY(1)}`,
		`status:${KEY(1)}`,
	]);
	assert.deepEqual(c.seen.published, ["msg_1"]);
});

test("M1 failed status read mid-follow-up: the attempt stays pending and Retry reads the same key", async () => {
	const h = hub({
		submit: [(key) => outcome(key, "checking")],
		status: [deadline(), (key) => outcome(key, "published")],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	await settle();
	assert.equal(c.last().kind, "offline");
	assert.equal(a.pendingFor(c.ctx.target)?.key, KEY(1));
	await a.send(c.ctx, draft);
	assert.deepEqual(h.calls, [
		`submit:${KEY(1)}`,
		`status:${KEY(1)}`,
		`status:${KEY(1)}`,
	]);
	assert.deepEqual(c.seen.published, ["msg_1"]);
});

test("M1 channel switch while checking: returning resumes by status read; Send never mints a second key", async () => {
	const h = hub({
		submit: [(key) => outcome(key, "checking")],
		status: [
			// The follow-up that was running when the reader left is abandoned
			// before its read (the key is no longer shown), so the next read is
			// the resume's.
			(key) => outcome(key, "checking"),
			(key) => outcome(key, "checking"),
			(key) => outcome(key, "published"),
		],
	});
	const a = controller();
	const general = composer(h, "c\u0000general\u0000");
	const help = composer(h, "c\u0000help\u0000");
	await a.send(general.ctx, draft);
	await a.enter(help.ctx); // leave while checking
	assert.equal(help.last().kind, "idle");
	await settle();
	assert.equal(a.pendingFor(general.ctx.target)?.key, KEY(1));
	await a.enter(general.ctx); // come back
	assert.equal(general.last().kind, "checking", "the attempt is shown again");
	await a.send(general.ctx, draft); // Send of the same draft while it checks
	await settle();
	await settle();
	const submits = h.calls.filter((call) => call.startsWith("submit:"));
	assert.deepEqual(submits, [`submit:${KEY(1)}`], "one post, one key");
	assert.ok(h.calls.every((call) => call.endsWith(KEY(1))));
	assert.deepEqual(general.seen.published, ["msg_1"]);
});

test("M1 status unreadable on Retry: nothing is sent and the attempt stays pending", async () => {
	const h = hub({ submit: [deadline()], status: [deadline()] });
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	await a.send(c.ctx, draft);
	assert.deepEqual(h.calls, [`submit:${KEY(1)}`, `status:${KEY(1)}`]);
	assert.equal(c.last().kind, "offline");
	assert.equal(a.pendingFor(c.ctx.target)?.key, KEY(1));
});

test("M1 Dismiss hides the notice but never forgets an attempt that may still publish", async () => {
	const h = hub({
		submit: [deadline()],
		status: [(key) => outcome(key, "published")],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	a.dismiss(c.ctx);
	assert.equal(a.pendingFor(c.ctx.target)?.key, KEY(1));
	await a.send(c.ctx, draft);
	assert.deepEqual(h.calls, [`submit:${KEY(1)}`, `status:${KEY(1)}`]);
});

test("M1 a hub ANSWER settles the attempt: the next Send is a new attempt under a new key", async () => {
	const h = hub({
		submit: [
			answered(422, {
				code: "refused",
				category: "spam_or_promotion",
				reference: REF,
			}),
			(key) => outcome(key, "published"),
		],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	assert.equal(c.last().kind, "refused");
	assert.equal(a.pendingFor(c.ctx.target), undefined);
	await a.send(c.ctx, { text: "edited", images: [] });
	assert.deepEqual(h.calls, [`submit:${KEY(1)}`, `submit:${KEY(2)}`]);
});

test("M1 lost answer, stored refusal, unchanged draft: the stored outcome is shown, not re-sent", async () => {
	const h = hub({
		submit: [deadline()],
		status: [(key) => outcome(key, "refused")],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	await a.send(c.ctx, draft);
	assert.deepEqual(h.calls, [`submit:${KEY(1)}`, `status:${KEY(1)}`]);
	assert.equal(c.last().kind, "refused");
	assert.equal(c.last().reference, REF);
	assert.equal(a.pendingFor(c.ctx.target), undefined);
});

test("M1 lost answer, then an EDITED draft: a settled old attempt lets the edit go under a new key; a live one blocks it", async () => {
	// Settled (expired) old attempt: the edit is a new post.
	{
		const h = hub({
			submit: [deadline(), (key) => outcome(key, "published")],
			status: [(key) => outcome(key, "expired")],
		});
		const a = controller();
		const c = composer(h);
		await a.send(c.ctx, draft);
		await a.send(c.ctx, { text: "hello community!", images: [] });
		assert.deepEqual(h.calls, [
			`submit:${KEY(1)}`,
			`status:${KEY(1)}`,
			`submit:${KEY(2)}`,
		]);
	}
	// Live old attempt: follow it; the edited text waits in the box.
	{
		const h = hub({
			submit: [deadline()],
			status: [
				(key) => outcome(key, "checking"),
				(key) => outcome(key, "published"),
			],
		});
		const a = controller();
		const c = composer(h);
		await a.send(c.ctx, draft);
		await a.send(c.ctx, { text: "hello community!", images: [] });
		await settle();
		assert.ok(
			h.calls.every(
				(call) => !call.startsWith("submit:") || call.endsWith(KEY(1)),
			),
			JSON.stringify(h.calls),
		);
	}
});

test("M2 a 409 guidelines_changed settles the attempt and tells the home to go read-only", async () => {
	const h = hub({
		submit: [
			answered(409, { code: "guidelines_changed", guidelines_version: "v3" }),
		],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	assert.equal(c.last().kind, "guidelines_changed");
	assert.equal(c.seen.guidelines, 1);
	assert.equal(a.pendingFor(c.ctx.target), undefined);
});

/**
 * A submit held open until the case releases it - the shape of the real call,
 * which waits out the whole moderation verdict (the daemon's 30 s budget), so a
 * reader can leave the conversation before it answers (review round 2, R2-M1).
 */
function gated() {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	return { answer: () => gate, release: (value) => release(value) };
}

test("R2-M1 published while the reader is in another channel: the draft clears on return and nothing is re-sent", async () => {
	const g = gated();
	const h = hub({ submit: [() => g.answer()] });
	const a = controller();
	const general = composer(h, "c\u0000general\u0000");
	const help = composer(h, "c\u0000help\u0000");
	const sent = a.send(general.ctx, draft);
	await a.enter(help.ctx); // leave before the verdict
	g.release(outcome(KEY(1), "published"));
	await sent;
	assert.equal(help.last().kind, "idle", "the answer is not shown elsewhere");
	assert.deepEqual(help.seen.published, []);
	assert.equal(
		a.pendingFor(general.ctx.target)?.key,
		KEY(1),
		"kept until the reader is back",
	);
	await a.enter(general.ctx); // come back
	assert.deepEqual(general.seen.published, ["msg_1"], "that draft is cleared");
	assert.ok(general.seen.history >= 1, "and its history re-read");
	assert.equal(general.last().kind, "idle");
	assert.equal(a.pendingFor(general.ctx.target), undefined);
	const submits = h.calls.filter((call) => call.startsWith("submit:"));
	assert.deepEqual(submits, [`submit:${KEY(1)}`], "one post, one key");
});

test("R2-M1 a refusal that lands while away is shown on return, and is not re-sent", async () => {
	for (const answer of [
		outcome(KEY(1), "refused"),
		answered(422, {
			code: "refused",
			category: "spam_or_promotion",
			reference: REF,
		}),
	]) {
		const g = gated();
		const h = hub({ submit: [() => g.answer()] });
		const a = controller();
		const general = composer(h, "c\u0000general\u0000");
		const help = composer(h, "c\u0000help\u0000");
		const sent = a.send(general.ctx, draft);
		await a.enter(help.ctx);
		if (answer instanceof Error) {
			// The gate rejects: re-wire it so the held submit throws the answer.
			g.release(Promise.reject(answer));
		} else {
			g.release(answer);
		}
		await sent;
		assert.equal(help.last().kind, "idle");
		await a.enter(general.ctx);
		assert.equal(general.last().kind, "refused");
		assert.equal(general.last().reference, REF);
		assert.deepEqual(general.seen.published, []);
		assert.equal(a.pendingFor(general.ctx.target), undefined, "settled");
		assert.deepEqual(
			h.calls,
			[`submit:${KEY(1)}`],
			"no status read, no re-send",
		);
	}
});

test("R2-M1 a cancel answering while away settles that channel on return", async () => {
	const g = gated();
	const h = hub({
		submit: [(key) => outcome(key, "checking")],
		cancel: [() => g.answer()],
	});
	const a = controller();
	const general = composer(h, "c\u0000general\u0000");
	const help = composer(h, "c\u0000help\u0000");
	await a.send(general.ctx, draft);
	const cancelled = a.cancel(general.ctx);
	await a.enter(help.ctx);
	g.release(outcome(KEY(1), "published")); // too late to cancel: it posted
	await cancelled;
	assert.equal(a.pendingFor(general.ctx.target)?.key, KEY(1));
	await a.enter(general.ctx);
	assert.deepEqual(general.seen.published, ["msg_1"]);
	const submits = h.calls.filter((call) => call.startsWith("submit:"));
	assert.deepEqual(submits, [`submit:${KEY(1)}`]);
});

test("m6 a hub answer to the follow-up STATUS READ keeps the attempt pending; the next Send reads the same key", async () => {
	const h = hub({
		submit: [(key) => outcome(key, "checking")],
		status: [
			answered(401, { code: "community_signin_required" }),
			(key) => outcome(key, "published"),
		],
	});
	const a = controller();
	const c = composer(h);
	await a.send(c.ctx, draft);
	await settle();
	assert.equal(c.last().kind, "error");
	assert.equal(a.pendingFor(c.ctx.target)?.key, KEY(1), "not forgotten");
	await a.send(c.ctx, draft);
	assert.deepEqual(h.calls, [
		`submit:${KEY(1)}`,
		`status:${KEY(1)}`,
		`status:${KEY(1)}`,
	]);
	assert.deepEqual(c.seen.published, ["msg_1"]);
});
