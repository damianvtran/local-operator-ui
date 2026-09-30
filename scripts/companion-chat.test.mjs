import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { CompanionChatService } from "./src/main/companion-chat"; export * from "./src/shared/chief-of-staff";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { CompanionChatService, resolveChiefOfStaff, CHIEF_OF_STAFF_COPY } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
const ID = "abcdef123456";
const OTHER_ID = "fedcba654321";
const receipt = (result, status = 200) => ({
	status,
	body: { result },
});
const admitted = ({ requestId }) =>
	receipt({ status: "admitted", command_id: requestId });
const row = (id, role, text, extra = {}) => ({
	id,
	type: "message",
	payload: { role, content: [{ text }], ...extra },
});
const frame = ({
	sessionId = ID,
	history = [],
	cold_reason = null,
	...state
} = {}) =>
	receipt({
		session_id: sessionId,
		payload: {
			cold_reason,
			history: { entries: history },
			frontend: {
				snapshot: {
					session_id: sessionId,
					epoch: "epoch",
					conversation_title: "A small chat",
					streaming: false,
					pending_gate: null,
					live_events: [],
					generation: 0,
					last_turn_outcome: "",
					...state,
				},
			},
		},
	});

const capabilities = (overrides = {}) => ({
	desktop_available: true,
	desktop_contract: 1,
	desktop_auth: "bearer",
	features: { aida: 1, input_mode: 1 },
	...overrides,
});
const seat = (overrides = {}) => ({
	enabled: true,
	session_id: ID,
	paused: false,
	greeted: true,
	...overrides,
});

function fixture({ chiefOfStaff = false } = {}) {
	const calls = [];
	const changes = [];
	let current = frame();
	let override;
	const service = new CompanionChatService({
		cwd: "/a/known/directory",
		onChange: (snapshot) => changes.push(snapshot),
		requestDesktop: async (input) => {
			calls.push(input);
			if (override) {
				const handled = await override(input);
				if (handled !== undefined) return handled;
			}
			if (input.op === "capabilities") return receipt(capabilities());
			if (input.op === "aida.status") return receipt(seat());
			if (input.op === "aida.control") return receipt(seat({ session_id: ID }));
			if (input.op === "sessions.create") return receipt({ session_id: ID });
			if (input.op === "sessions.get") return current;
			if (input.op === "sessions.message") {
				current = frame({
					history: [
						row(input.requestId, "user", input.text),
						row("answer", "assistant", "Hello back"),
					],
					generation: 1,
					last_turn_outcome: "completed",
				});
				return admitted(input);
			}
			throw new Error(`Unexpected operation ${input.op}`);
		},
	});
	if (!chiefOfStaff) service.newChat();
	return {
		service,
		calls,
		changes,
		messages: () => calls.filter((call) => call.op === "sessions.message"),
		setFrame: (value) => {
			current = value;
		},
		handle: (value) => {
			override = value;
		},
	};
}

test("chat creates lazily with defaults and displays accepted prose", async () => {
	const f = fixture();
	await f.service.open();
	await f.service.refresh();
	assert.equal(f.calls.length, 0);
	const sent = await f.service.send("Hello");
	assert.equal(sent.accepted, true);
	assert.deepEqual(Object.keys(f.calls[0]).sort(), ["cwd", "op", "requestId"]);
	assert.equal(f.calls[0].cwd, "/a/known/directory");
	assert.equal(f.messages()[0].mode, "prompt");
	await f.service.refresh();
	assert.equal(f.service.snapshot.status, "idle");
	assert.equal(f.service.snapshot.canSend, true);
	assert.deepEqual(
		f.service.snapshot.messages.map(({ role, text }) => ({ role, text })),
		[
			{ role: "user", text: "Hello" },
			{ role: "assistant", text: "Hello back" },
		],
	);
});

test(
	"admission releases the composer without waiting for old or new polls",
	{ timeout: 2000 },
	async () => {
		const f = fixture();
		await f.service.open(ID);
		const oldRead = Promise.withResolvers();
		const nextRead = Promise.withResolvers();
		let reads = 0;
		f.handle((input) => {
			if (input.op !== "sessions.get") return;
			reads++;
			if (reads === 1) return oldRead.promise;
			if (reads === 3) return nextRead.promise;
		});
		const poll = f.service.refresh();
		const sent = await f.service.send("Hello");
		assert.equal(sent.accepted, true);
		assert.equal(sent.snapshot.status, "working");
		assert.deepEqual(sent.snapshot.activeQuestion, {
			id: f.messages()[0].requestId,
			text: "Hello",
		});
		sent.snapshot.activeQuestion.text = "Cannot change the active question";
		assert.equal(f.service.snapshot.activeQuestion.text, "Hello");
		assert.equal(reads, 3);
		oldRead.resolve(frame({ history: [row("old", "assistant", "Old reply")] }));
		await poll;
		assert.equal(f.service.snapshot.messages.length, 0);
		nextRead.resolve(frame({ generation: 1, last_turn_outcome: "completed" }));
		await f.service.refresh();
		assert.equal(f.service.snapshot.canSend, true);
		assert.equal(f.service.snapshot.activeQuestion, undefined);
		f.service.dispose();
	},
);

test("lost creation reuses its request ID", async () => {
	const f = fixture();
	let once = true;
	f.handle((input) => {
		if (input.op === "sessions.create" && once) {
			once = false;
			throw new Error("timeout");
		}
	});
	assert.equal((await f.service.send("Hello")).accepted, false);
	assert.equal((await f.service.send("Revised draft")).accepted, true);
	const creates = f.calls.filter((call) => call.op === "sessions.create");
	assert.deepEqual(creates[0], creates[1]);
});

test("uncertain delivery permits only an exact retry with the same identity", async () => {
	for (const fail of [
		() => {
			throw new Error("timeout after admission");
		},
		(input) => receipt({ status: "pending", command_id: input.requestId }),
		() => receipt({ status: "admitted", command_id: "wrong-request" }),
	]) {
		const f = fixture();
		f.handle((input) => {
			if (input.op === "sessions.message" && f.messages().length === 1)
				return fail(input);
		});
		const first = await f.service.send("Do this once");
		assert.equal(first.accepted, false);
		assert.equal(first.snapshot.sessionId, ID);
		assert.equal(first.snapshot.pendingText, "Do this once");
		assert.equal(first.snapshot.activeQuestion, undefined);
		await f.service.refresh();
		assert.equal(f.service.snapshot.pendingText, "Do this once");
		const count = f.calls.length;
		assert.equal((await f.service.send("Different task")).accepted, false);
		assert.equal(f.calls.length, count);
		assert.equal((await f.service.send("Do this once")).accepted, true);
		assert.equal(f.service.snapshot.pendingText, undefined);
		assert.deepEqual(f.messages()[0], f.messages()[1]);
		assert.equal(
			f.calls.filter((call) => call.op === "sessions.create").length,
			1,
		);
	}
});

test("definite refusals allow edits with a new request ID", async () => {
	for (const status of [413, 422]) {
		const f = fixture();
		f.handle((input) => {
			if (input.op === "sessions.message" && f.messages().length === 1) {
				return receipt({}, status);
			}
		});
		assert.equal((await f.service.send("/unsupported")).accepted, false);
		assert.equal(f.service.snapshot.pendingText, undefined);
		assert.equal((await f.service.send("A plain prompt")).accepted, true);
		assert.notEqual(f.messages()[0].requestId, f.messages()[1].requestId);
	}
});

test("conversation changes during creation cannot abandon or duplicate the original send", async () => {
	const f = fixture();
	const creating = Promise.withResolvers();
	f.handle((input) =>
		input.op === "sessions.create" ? creating.promise : undefined,
	);
	const first = f.service.send("Original task");
	assert.equal(f.service.newChat(), false);
	assert.equal(f.service.chooseConversation("chief-of-staff"), false);
	assert.equal((await f.service.send("Duplicate task")).accepted, false);
	creating.resolve(receipt({ session_id: ID }));
	assert.equal((await first).accepted, true);
	await f.service.refresh();
	assert.deepEqual(
		f.messages().map((call) => call.text),
		["Original task"],
	);
	assert.equal(f.service.newChat(), true);
});

test("fresh gates and silent owners stop an uncertain retry before delivery", async () => {
	for (const options of [
		{ pending_gate: { kind: "approval" } },
		{ pending_gate: { kind: "ask" } },
		{ cold_reason: "owner-silent" },
		{ cold_reason: "owner-leaving" },
	]) {
		const f = fixture();
		f.handle((input) => {
			if (input.op === "sessions.message") throw new Error("timeout");
		});
		await f.service.send("One task");
		f.setFrame(frame(options));
		assert.equal((await f.service.send("One task")).accepted, false);
		assert.equal(f.service.snapshot.canSend, false);
		assert.equal(f.messages().length, 1);
	}
});

test("transcript excludes reasoning, tools, attachments and partial updates", async () => {
	const f = fixture();
	f.setFrame(
		frame({
			history: [
				row("u", "user", "Hi"),
				row("a", "assistant", "", {
					content: [
						{ type: "thinking", text: "private reasoning" },
						{ text: "Visible reply" },
						{ type: "image", text: "image metadata" },
						{ attachment: "digest", text: "image caption metadata" },
						{ data: "abc", text: "base64 metadata" },
					],
				}),
				row("tool", "tool", "secret tool result"),
				row("custom", "assistant", "internal notice", { kind: "custom" }),
			],
			live_events: [
				{
					type: "message_update",
					delta: "partial fragment",
					message: { id: "partial", role: "assistant" },
				},
			],
		}),
	);
	await f.service.open(ID);
	assert.deepEqual(
		f.service.snapshot.messages.map((row) => row.text),
		["Hi", "Visible reply"],
	);
});

test("accepted work needs its own terminal turn, including after an owner change", async () => {
	for (const [epoch, echo, outcome, expected] of [
		["epoch", false, "aborted", "idle"],
		["replacement", true, "error", "error"],
		["replacement", false, "completed", "working"],
	]) {
		const f = fixture();
		f.handle((input) =>
			input.op === "sessions.message" ? admitted(input) : undefined,
		);
		const sent = await f.service.send("My exact task");
		assert.equal(sent.accepted, true);
		assert.equal(sent.snapshot.status, "working");
		await f.service.refresh();
		f.setFrame(
			frame({
				epoch,
				generation: 1,
				last_turn_outcome: outcome,
				history: echo
					? [row(f.messages()[0].requestId, "user", "My exact task")]
					: [],
			}),
		);
		await f.service.refresh();
		assert.equal(f.service.snapshot.status, expected);
		assert.equal(f.service.snapshot.canSend, expected !== "working");
	}
});

test("read error outcomes remain visible and permit another prompt", async () => {
	const f = fixture();
	f.setFrame(
		frame({
			generation: 1,
			last_turn_outcome: "error",
			attention: { unseen: false, kind: "error" },
		}),
	);
	await f.service.open(ID);
	assert.equal(f.service.snapshot.status, "error");
	assert.equal(f.service.snapshot.canSend, true);
	assert.equal((await f.service.send("Try a smaller task")).accepted, true);
});

test("an old poll failure cannot replace newer chat state", async () => {
	const f = fixture();
	await f.service.open(ID);
	const pending = Promise.withResolvers();
	let once = true;
	f.handle((input) => {
		if (input.op === "sessions.get" && once) {
			once = false;
			return pending.promise;
		}
	});
	const oldPoll = f.service.refresh();
	const send = f.service.send("Hello");
	await new Promise((resolve) => setImmediate(resolve));
	pending.reject(new Error("old poll timed out"));
	await oldPoll;
	assert.equal((await send).accepted, true);
	await f.service.refresh();
	assert.equal(f.service.snapshot.status, "idle");
	assert.equal(f.service.snapshot.error, null);
});

test("session changes and disposal discard late reads", async () => {
	for (const dispose of [false, true]) {
		const f = fixture();
		await f.service.open(ID);
		const pending = Promise.withResolvers();
		f.handle((input) =>
			input.sessionId === ID ? pending.promise : frame({ sessionId: OTHER_ID }),
		);
		const first = f.service.refresh();
		if (dispose) f.service.dispose();
		else await f.service.open(OTHER_ID);
		const count = f.changes.length;
		pending.resolve(frame({ conversation_title: "Wrong old title" }));
		await first;
		assert.equal(f.changes.length, count);
		if (!dispose) assert.equal(f.service.snapshot.sessionId, OTHER_ID);
	}
});

test("invalid drafts stay local and snapshots cannot mutate state", async () => {
	const f = fixture();
	for (const text of ["", "   ", "x".repeat(16_001)])
		assert.equal((await f.service.send(text)).accepted, false);
	assert.equal(f.calls.length, 0);
	const snapshot = f.service.snapshot;
	snapshot.messages.push({ id: "fake", role: "assistant", text: "injected" });
	assert.deepEqual(f.service.snapshot.messages, []);
});

test("the shared resolver uses the existing paused seat without resuming it", async () => {
	const calls = [];
	const caps = capabilities();
	const target = await resolveChiefOfStaff(async (input) => {
		calls.push(input);
		if (input.op === "capabilities") return caps;
		if (input.op === "aida.status") return seat({ paused: true });
		throw new Error("No writes expected");
	});
	assert.equal(target.sessionId, ID);
	assert.equal(target.capabilities, caps);
	assert.deepEqual(calls, [{ op: "capabilities" }, { op: "aida.status" }]);
});

test("the shared resolver gates missing, unpaired, disabled and unreachable seats", async () => {
	for (const [caps, state, reason, expectedCalls] of [
		[capabilities({ features: {} }), seat(), "missing", ["capabilities"]],
		[
			capabilities({ features: { aida: 0 } }),
			seat(),
			"missing",
			["capabilities"],
		],
		[
			capabilities({ desktop_available: false }),
			seat(),
			"unreachable",
			["capabilities"],
		],
		[null, seat(), "unreachable", ["capabilities"]],
		[
			capabilities(),
			seat({ enabled: false }),
			"disabled",
			["capabilities", "aida.status"],
		],
		[capabilities(), null, "unreachable", ["capabilities", "aida.status"]],
		[
			capabilities(),
			seat({ session_id: "invalid" }),
			"openFailed",
			["capabilities", "aida.status"],
		],
	]) {
		const calls = [];
		await assert.rejects(
			() =>
				resolveChiefOfStaff(async (input) => {
					calls.push(input.op);
					return input.op === "capabilities" ? caps : state;
				}),
			{ message: CHIEF_OF_STAFF_COPY[reason] },
		);
		assert.deepEqual(calls, expectedCalls);
	}
});

test("first-use resolution only ensures the single seat, and handles a disabled race", async () => {
	for (const disabled of [false, true]) {
		const calls = [];
		const target = resolveChiefOfStaff(async (input) => {
			calls.push(input);
			if (input.op === "capabilities") return capabilities();
			if (input.op === "aida.status")
				return seat({ session_id: null, paused: true });
			if (disabled) throw { code: "aida_disabled" };
			return seat({ paused: true });
		});
		if (disabled)
			await assert.rejects(() => target, {
				message: CHIEF_OF_STAFF_COPY.disabled,
			});
		else assert.equal((await target).sessionId, ID);
		assert.deepEqual(calls, [
			{ op: "capabilities" },
			{ op: "aida.status" },
			{ op: "aida.control", action: "open" },
		]);
	}
});

test("pet chat reads and sends to the shared chief of staff; New chat is explicit", async () => {
	const f = fixture({ chiefOfStaff: true });
	f.setFrame(
		frame({ history: [row("quick-send", "user", "From the shortcut")] }),
	);
	await f.service.open();
	assert.equal(f.service.snapshot.sessionId, ID);
	assert.equal(f.service.snapshot.messages[0].text, "From the shortcut");
	assert.equal((await f.service.send("From the pet")).accepted, true);
	await f.service.refresh();
	assert.equal(f.messages()[0].sessionId, ID);
	assert.equal(
		f.calls.some((call) => call.op === "sessions.create"),
		false,
	);
	f.service.newChat();
	assert.equal(f.service.snapshot.sessionId, null);
	const before = f.calls.length;
	assert.equal((await f.service.send("A separate task")).accepted, true);
	assert.equal(f.calls[before].op, "sessions.create");
});

test("disabled chief-of-staff preserves the draft route and recovers without a new agent", async () => {
	const f = fixture({ chiefOfStaff: true });
	let enabled = false;
	f.handle((input) =>
		input.op === "aida.status" ? receipt(seat({ enabled })) : undefined,
	);
	await f.service.open();
	assert.equal(f.service.snapshot.canSend, false);
	assert.ok(f.service.snapshot.error.includes(CHIEF_OF_STAFF_COPY.disabled));
	assert.equal((await f.service.send("Keep my draft")).accepted, false);
	assert.equal(f.messages().length, 0);
	enabled = true;
	await f.service.refresh();
	assert.equal((await f.service.send("Keep my draft")).accepted, true);
	assert.equal(
		f.calls.some(
			(call) => call.op === "aida.control" || call.op === "sessions.create",
		),
		false,
	);
});

test("the pet rechecks the seat before sending, and keeps an uncertain send on its original session", async () => {
	const f = fixture({ chiefOfStaff: true });
	await f.service.open();
	let enabled = false;
	f.handle((input) =>
		input.op === "aida.status" ? receipt(seat({ enabled })) : undefined,
	);
	assert.equal((await f.service.send("Not while disabled")).accepted, false);
	assert.equal(f.messages().length, 0);
	enabled = true;
	await f.service.refresh();
	f.handle((input) => {
		if (input.op === "sessions.message") throw new Error("receipt lost");
	});
	assert.equal((await f.service.send("Only once")).accepted, false);
	const first = f.messages()[0];
	f.handle((input) =>
		input.op === "aida.status"
			? receipt(seat({ session_id: OTHER_ID }))
			: undefined,
	);
	assert.equal((await f.service.send("Only once")).accepted, false);
	assert.equal(f.service.snapshot.sessionId, ID);
	assert.equal(f.service.snapshot.pendingText, "Only once");
	assert.equal(f.messages().length, 1);
	f.handle(() => undefined);
	await f.service.refresh();
	assert.equal((await f.service.send("Only once")).accepted, true);
	assert.deepEqual(f.messages()[1], first);
});

test("conversation changes wait for chief-of-staff resolution", async () => {
	const f = fixture({ chiefOfStaff: true });
	const pending = Promise.withResolvers();
	f.handle((input) =>
		input.op === "aida.status" ? pending.promise : undefined,
	);
	const opened = f.service.open();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.service.newChat(), false);
	await f.service.open(OTHER_ID);
	assert.equal(f.service.snapshot.sessionId, null);
	pending.resolve(receipt(seat()));
	await opened;
	assert.equal(f.service.snapshot.sessionId, ID);
	assert.equal(f.service.snapshot.destination, "chief-of-staff");
});

test("an explicit return to the chief of staff shares the existing conversation without changing its cadence", async () => {
	const f = fixture();
	assert.equal(f.service.chooseConversation("chief-of-staff"), true);
	await f.service.refresh();
	assert.equal(f.service.snapshot.destination, "chief-of-staff");
	assert.equal(f.service.snapshot.sessionId, ID);
	assert.equal(f.service.chooseConversation("chief-of-staff"), false);
	assert.equal(f.service.newChat(), true);
	assert.equal(f.service.snapshot.sessionId, null);
	assert.equal(f.service.chooseConversation("chief-of-staff"), true);
	await f.service.refresh();
	assert.deepEqual(
		f.calls.map((call) => call.op),
		[
			"capabilities",
			"aida.status",
			"sessions.get",
			"capabilities",
			"aida.status",
			"sessions.get",
		],
	);
});

test("switching cannot lose an uncertain send or its retry identity", async () => {
	const f = fixture();
	f.handle((input) => {
		if (input.op === "sessions.message") throw new Error("receipt lost");
	});
	assert.equal((await f.service.send("Only once")).accepted, false);
	const snapshot = f.service.snapshot;
	assert.equal(f.service.newChat(), false);
	assert.equal(f.service.chooseConversation("chief-of-staff"), false);
	await f.service.open(OTHER_ID);
	assert.deepEqual(f.service.snapshot, snapshot);
	f.handle(() => undefined);
	assert.equal((await f.service.send("Only once")).accepted, true);
	assert.deepEqual(f.messages()[1], f.messages()[0]);
});

test("an admitted turn blocks navigation until it settles", async () => {
	const f = fixture();
	f.handle((input) =>
		input.op === "sessions.message" ? admitted(input) : undefined,
	);
	assert.equal((await f.service.send("Still working")).accepted, true);
	await f.service.refresh();
	assert.equal(f.service.newChat(), false);
	assert.equal(f.service.chooseConversation("chief-of-staff"), false);
	f.setFrame(frame({ generation: 1, last_turn_outcome: "completed" }));
	await f.service.refresh();
	assert.equal(f.service.chooseConversation("chief-of-staff"), true);
	await f.service.refresh();
});
