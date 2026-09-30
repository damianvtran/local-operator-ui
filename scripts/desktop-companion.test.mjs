import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
	entryPoints: ["src/shared/desktop-companion.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	companionStateFromCatalogue: select,
	companionPreferences,
	clampCompanionPosition,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const catalogue = (...sessions) => ({ result: { sessions } });
const row = (id, code, extra = {}) => ({ id, status: { code }, ...extra });
const unread = { attention: { unseen: true } };

test("gates take precedence over active work and unopened completions", () => {
	const result = select(
		catalogue(
			row("done", "complete", unread),
			row("running", "busy", unread),
			row("gate", "approval"),
		),
	);
	assert.deepEqual(result, {
		mood: "attention",
		label: "Needs you",
		sessionId: "gate",
		notifications: [
			{
				sessionId: "gate",
				title: "Untitled task",
				kind: "approval",
				label: "Needs approval",
				key: '["gate","approval",null]',
			},
			{
				sessionId: "done",
				title: "Untitled task",
				kind: "complete",
				label: "Finished",
				key: '["done","complete",null]',
			},
		],
	});
	assert.equal(select(catalogue(row("ask", "answer"))).mood, "attention");
});

test("attention identifies the selected task without leaking another task's title", () => {
	const result = select(
		catalogue(
			row("running", "busy", { name: "Background work" }),
			row("gate", "approval", { name: "  Plan\nmy trip  " }),
		),
	);
	assert.equal(result.sessionId, "gate");
	assert.equal(result.taskTitle, "Plan my trip");
	assert.equal(result.notifications[0].title, "Plan my trip");
	assert.equal(
		select(catalogue(row("gate", "approval", { name: {} }))).taskTitle,
		undefined,
	);
});
test("a previous completion receipt cannot make an active turn look finished", () => {
	assert.equal(select(catalogue(row("a", "busy", unread))).mood, "working");
	assert.deepEqual(
		select(catalogue(row("a", "busy", unread))).notifications,
		[],
	);
	assert.equal(
		select(catalogue(row("a", "complete", unread))).mood,
		"complete",
	);
	assert.equal(
		select(catalogue(row("a", "complete", { attention: { unseen: false } })))
			.mood,
		"idle",
	);
});
test("delegated work stays working until the authoritative status changes", () => {
	const delegated = row("parent", "delegating", {
		name: "Research",
		...unread,
	});
	assert.deepEqual(select(catalogue(delegated)), {
		mood: "working",
		label: "Working",
		sessionId: "parent",
		taskTitle: "Research",
		notifications: [],
	});
	assert.equal(
		select(catalogue(delegated, row("child", "answer"))).sessionId,
		"child",
	);
});
test("read failures and unfamiliar status never imply readiness", () => {
	for (const body of [
		null,
		{},
		{ result: {} },
		catalogue(row("a", "future-status")),
		catalogue({ id: "missing" }),
	]) {
		assert.equal(select(body).mood, "offline");
	}
	assert.equal(
		select({ result: { sessions: [], degraded: ["session_liveness"] } }).mood,
		"offline",
	);
	assert.equal(select(catalogue()).mood, "idle");
});
test("archived sessions and acknowledged outcomes do not demand attention", () => {
	assert.equal(
		select(catalogue(row("old", "approval", { archived: true }))).mood,
		"idle",
	);
	assert.equal(
		select(catalogue(row("old", "error", { attention: { unseen: false } })))
			.mood,
		"idle",
	);
	assert.equal(select(catalogue(row("failed", "error", unread))).mood, "error");
	assert.equal(select(catalogue(row("stale", "wedged"))).label, "Check chat");
});
test("interrupted unread work is distinct from an unavailable backend", () => {
	assert.deepEqual(select(catalogue(row("paused", "interrupted", unread))), {
		mood: "attention",
		label: "Paused",
		sessionId: "paused",
		notifications: [
			{
				sessionId: "paused",
				title: "Untitled task",
				kind: "interrupted",
				label: "Paused",
				key: '["paused","interrupted",null]',
			},
		],
	});
});

test("notifications include every waiting agent in stable urgency order", () => {
	const result = select(
		catalogue(
			row("finished", "complete", unread),
			row("paused", "interrupted", unread),
			row("running", "busy", unread),
			row("failed", "error", unread),
			row("question", "answer", { attention: { unseen: false } }),
			row("stuck", "wedged", { attention: { unseen: false } }),
			row("permission", "approval", { attention: { unseen: false } }),
		),
	);
	assert.deepEqual(
		result.notifications.map(({ sessionId }) => sessionId),
		["question", "permission", "failed", "stuck", "paused", "finished"],
	);
	assert.equal(result.sessionId, "question");
	for (const code of ["wedged", "error", "interrupted"]) {
		assert.equal(
			select(catalogue(row("running", "busy"), row("needs-you", code, unread)))
				.sessionId,
			"needs-you",
		);
	}
	assert.equal(
		select(
			catalogue(row("finished", "complete", unread), row("running", "busy")),
		).sessionId,
		"running",
	);
});

test("resolved gates and read outcomes disappear on the next catalogue snapshot", () => {
	for (const code of ["approval", "answer", "wedged"]) {
		assert.equal(select(catalogue(row("a", code))).notifications.length, 1);
		assert.deepEqual(select(catalogue(row("a", "busy"))).notifications, []);
	}
	for (const code of ["complete", "error", "interrupted"]) {
		assert.equal(
			select(catalogue(row("a", code, unread))).notifications.length,
			1,
		);
		assert.deepEqual(
			select(catalogue(row("a", code, { attention: { unseen: false } })))
				.notifications,
			[],
		);
	}
	assert.deepEqual(select(catalogue()).notifications, []);
});

test("receipt keys change for a new outcome without copying unrelated metadata", () => {
	for (const code of ["complete", "error", "interrupted"]) {
		const notice = (token, extra = {}) =>
			select(
				catalogue(
					row("a", code, {
						attention: { unseen: true, completion_token: token, ...extra },
					}),
				),
			).notifications[0];
		assert.notEqual(notice("first").key, notice("second").key);
		assert.equal(
			notice("first").key,
			notice("first", { revision: [10, 20], anchor_id: "private detail" }).key,
		);
		assert.equal(notice({ secret: "private detail" }).key, notice(null).key);
	}
	assert.equal(
		select(
			catalogue(
				row("gate", "approval", { attention: { completion_token: "old" } }),
			),
		).notifications[0].key,
		select(catalogue(row("gate", "approval"))).notifications[0].key,
	);
});

test("malformed, archived, and duplicate rows cannot create extra notifications", () => {
	const result = select(
		catalogue(
			null,
			row(null, "approval"),
			row("", "answer"),
			row("   ", "wedged"),
			row("archived", "answer", { archived: true }),
			row("running", "busy"),
			row("running", "complete", unread),
			row("one", "approval", { name: "  Plan\nmy\ttrip  " }),
			row("one", "approval", { name: "Duplicate" }),
			row("two", "answer", { name: {} }),
		),
	);
	assert.deepEqual(
		result.notifications.map(({ sessionId, title }) => ({ sessionId, title })),
		[
			{ sessionId: "one", title: "Plan my trip" },
			{ sessionId: "two", title: "Untitled task" },
		],
	);
	const degraded = select({
		result: { sessions: [row("gate", "approval")], degraded: ["attention"] },
	});
	assert.equal(degraded.mood, "offline");
	assert.deepEqual(degraded.notifications, []);
	assert.deepEqual(select(null).notifications, []);
});
test("new gate status revisions change notification identity without depending on titles", () => {
	const request = (revision, name = "Choose a date") =>
		select(
			catalogue(
				row("ask", "answer", {
					name,
					status_epoch: "owner",
					status_revision: revision,
				}),
			),
		).notifications[0].key;
	assert.equal(request(3), request(3, "Renamed task"));
	assert.notEqual(request(3), request(5));
	assert.equal(request(-1), request(Number.NaN));
});

test("position restoration remains on the selected display, including negative coordinates", () => {
	assert.deepEqual(
		clampCompanionPosition(
			{ x: -3000, y: 5000 },
			{ x: -1920, y: 40, width: 1920, height: 1040 },
		),
		{ x: -1920, y: 944 },
	);
	assert.deepEqual(
		clampCompanionPosition(
			{ x: 9000, y: -100 },
			{ x: 0, y: 24, width: 1440, height: 876 },
		),
		{ x: 1308, y: 24 },
	);
});
test("corrupt preferences cannot move a window to nonfinite coordinates", () => {
	assert.deepEqual(
		companionPreferences({
			enabled: false,
			character: "hoodie",
			position: { x: Number.POSITIVE_INFINITY, y: 3 },
		}),
		{ enabled: false, introduced: true, character: "hoodie" },
	);
	assert.deepEqual(
		companionPreferences({ position: { x: -400.4, y: 50.8 } }).position,
		{ x: -400, y: 51 },
	);
	assert.equal(companionPreferences(null).character, "sprout");
});

test("preference migration preserves existing choices without opting new installs in", () => {
	assert.deepEqual(companionPreferences(null), {
		enabled: false,
		introduced: false,
		character: "sprout",
	});
	for (const enabled of [true, false]) {
		assert.deepEqual(companionPreferences({ enabled, character: "pixel" }), {
			enabled,
			introduced: true,
			character: "pixel",
		});
		assert.equal(
			companionPreferences({ enabled, introduced: false }).introduced,
			false,
		);
	}
	assert.equal(companionPreferences({ enabled: "true" }).enabled, false);
});
