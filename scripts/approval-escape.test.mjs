import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The approval card's policy handles — the two links that change the MODE while
 * leaving the pending request unanswered.
 *
 * What is pinned here, and why each is a property a screenshot cannot prove:
 *
 * 1. **The two handles use the two different routes, exactly.** "This session"
 *    is the owner command `approvals auto`; "All sessions" is the typed
 *    setting `tool_approval_mode` FOLLOWED BY the same command for this
 *    conversation, in that order. The setting alone only promises future
 *    sessions, so the live one is moved too. The all-sessions arm deliberately
 *    does NOT send `approvals default auto` through `sessions.command`: the
 *    desktop command bridge answers every `approvals default …` frame with a
 *    `native_action`, which presents the picker and never reaches the runtime,
 *    so that press would look like a save and change nothing.
 *
 * 2. **Nothing on this path answers the gate.** There is no answer port at all:
 *    `runApprovalEscape` can only run a command or edit the default, and the
 *    requests it builds are checked against the answer op by name.
 *
 * 3. **Only a receipt that says the mode moved claims a save.** A `notice` is
 *    the runtime's mode-change receipt; a `native_action`, a `block`, an error
 *    and a transport failure are all `Unchanged: <detail>`. The settings route
 *    additionally reads the stored value back, because a resolved edit that
 *    reports another value did not save `auto`. When the default saves and the
 *    live command then fails, the outcome is `default-only` — the default is
 *    real, the conversation still asks — and the copy says exactly that.
 *
 * 4. **A policy failure cannot touch Approve or Deny.** The handles own their
 *    busy state; the answer pair is disabled only by the answer's own
 *    `answering`/`answer` inputs. The approval-card render below asserts the
 *    pair stays enabled while the handles are present.
 *
 * ## Why no DOM
 *
 * There is no jsdom in this tree. `ApprovalEscapeControls` is presentational, so
 * a server render is the whole state matrix; the connected half is exercised
 * through `runApprovalEscape` with substituted ports, which is the same
 * function the component calls.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { approvalEscapeRequest, runApprovalEscape, ApprovalEscapeControls, APPROVAL_ESCAPE_COPY } from "./src/renderer/src/features/chat/components/trace/approval-escape";',
			'export { QuestionDock } from "./src/renderer/src/features/chat/components/trace/question-dock";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});

const bundlePath = new URL("./_approval-escape.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
	approvalEscapeRequest,
	runApprovalEscape,
	ApprovalEscapeControls,
	APPROVAL_ESCAPE_COPY,
	QuestionDock,
} = await import(bundlePath.href);
await unlink(bundlePath);

const SESSION = "aaaaaaaaaaaa";

const approvalGate = (over = {}) => ({
	request_id: "11111111-1111-4111-8111-111111111111",
	kind: "approval",
	title: "bash",
	detail: "run: rm -rf ./dist",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	...over,
});

/** The opening tag of the `<button>` whose content contains `label`. */
function buttonOpeningTag(html, label) {
	const segment = html
		.split("<button")
		.find((part) => part.includes(`>${label}<`) || part.includes(label));
	assert.ok(segment, `a button carrying ${JSON.stringify(label)}`);
	return segment.slice(0, segment.indexOf(">"));
}

const renderControls = (props) =>
	renderToStaticMarkup(
		createElement(ApprovalEscapeControls, {
			onSetSession: () => {},
			onSetAll: () => {},
			...props,
		}),
	);

test("the two handles send different routes, and neither answers the gate", () => {
	assert.deepEqual(approvalEscapeRequest("session"), {
		op: "sessions.command",
		command: "approvals",
		args: "auto",
	});
	assert.deepEqual(approvalEscapeRequest("all"), {
		op: "settings.edit",
		key: "tool_approval_mode",
		value: "auto",
	});
	for (const target of ["session", "all"]) {
		const request = approvalEscapeRequest(target);
		assert.notEqual(request.op, "sessions.answer");
		assert.notEqual(request.op, "approval_answer");
	}
});

test("the session handle runs `approvals auto` and nothing else", async () => {
	const calls = [];
	const outcome = await runApprovalEscape("session", {
		runCommand: async (...args) => {
			calls.push(args);
			return {
				outcome: {
					kind: "notice",
					text: "tool approvals: auto — every tool runs without asking (this session)",
					style: "warning",
					data: {},
				},
				result: { tone: "success", text: "tool approvals: auto" },
			};
		},
		editDefault: async () => {
			throw new Error("the session handle must not write the default");
		},
	});
	assert.deepEqual(calls, [["approvals", "auto"]]);
	assert.deepEqual(outcome, { kind: "saved" });
});

test("a session refusal keeps the backend's detail and never claims a save", async () => {
	const refusal = await runApprovalEscape("session", {
		runCommand: async () => ({
			outcome: {
				kind: "error",
				text: "this session needs the operator's signature before it can loosen",
				style: "error",
				data: {},
			},
			result: { tone: "error", text: "unused" },
		}),
		editDefault: async () => ({ key: "tool_approval_mode", value: "auto" }),
	});
	assert.deepEqual(refusal, {
		kind: "unchanged",
		detail: "this session needs the operator's signature before it can loosen",
	});

	/*
	 * A `native_action` is the bridge presenting the approvals picker. It is not
	 * an error on the wire, but the mode did not move, so the same refusal arm
	 * applies and the strip's own sentence is the detail.
	 */
	const presented = await runApprovalEscape("session", {
		runCommand: async () => ({
			outcome: {
				kind: "native_action",
				destination: "session.approvals",
				fields: [],
				data: {},
			},
			result: {
				tone: "info",
				text: "The backend needs more input for session.approvals.",
			},
		}),
		editDefault: async () => ({ key: "tool_approval_mode", value: "auto" }),
	});
	assert.deepEqual(presented, {
		kind: "unchanged",
		detail: "The backend needs more input for session.approvals.",
	});

	const unreachable = await runApprovalEscape("session", {
		runCommand: async () => ({
			outcome: null,
			result: {
				tone: "error",
				text: "The mode was not changed: Desktop controls could not reach the backend process.",
			},
		}),
		editDefault: async () => ({ key: "tool_approval_mode", value: "auto" }),
	});
	assert.deepEqual(unreachable, {
		kind: "unchanged",
		detail:
			"The mode was not changed: Desktop controls could not reach the backend process.",
	});
});

test("the all-sessions handle saves the default, then moves this conversation", async () => {
	const calls = [];
	const saved = await runApprovalEscape("all", {
		editDefault: async (value) => {
			calls.push(["settings.edit", value]);
			return { key: "tool_approval_mode", value: "auto" };
		},
		runCommand: async (...args) => {
			calls.push(["sessions.command", ...args]);
			return {
				outcome: {
					kind: "notice",
					text: "tool approvals: auto — every tool runs without asking (this session)",
					style: "warning",
					data: {},
				},
				result: { tone: "success", text: "tool approvals: auto" },
			};
		},
	});
	// The durable half first, then the live one: the order the copy states.
	assert.deepEqual(calls, [
		["settings.edit", "auto"],
		["sessions.command", "approvals", "auto"],
	]);
	assert.deepEqual(saved, { kind: "saved" });

	const wrongValue = await runApprovalEscape("all", {
		runCommand: async () => {
			throw new Error(
				"a default that did not save must not touch this session",
			);
		},
		editDefault: async () => ({ key: "tool_approval_mode", value: "ask" }),
	});
	assert.deepEqual(wrongValue, { kind: "unchanged", detail: "ask" });

	const refused = await runApprovalEscape("all", {
		runCommand: async () => {
			throw new Error("a refused default must not touch this session");
		},
		editDefault: async () => {
			throw new Error("tool_approval_mode is managed by another account");
		},
	});
	assert.deepEqual(refused, {
		kind: "unchanged",
		detail: "tool_approval_mode is managed by another account",
	});
});

test("a saved default with a refused live command reports the half that did not apply", async () => {
	const partial = await runApprovalEscape("all", {
		editDefault: async () => ({ key: "tool_approval_mode", value: "auto" }),
		runCommand: async () => ({
			outcome: {
				kind: "error",
				text: "this session needs the operator's signature before it can loosen",
				style: "error",
				data: {},
			},
			result: { tone: "error", text: "unused" },
		}),
	});
	assert.deepEqual(partial, {
		kind: "default-only",
		detail: "this session needs the operator's signature before it can loosen",
	});

	// The same arm for a transport failure: the default saved, no answer came back.
	const unreachable = await runApprovalEscape("all", {
		editDefault: async () => ({ key: "tool_approval_mode", value: "auto" }),
		runCommand: async () => ({
			outcome: null,
			result: {
				tone: "error",
				text: "The mode was not changed: Desktop controls could not reach the backend process.",
			},
		}),
	});
	assert.deepEqual(unreachable, {
		kind: "default-only",
		detail:
			"The mode was not changed: Desktop controls could not reach the backend process.",
	});
});

test("the handles are subordinate text buttons with full names", () => {
	const html = renderControls({});
	assert.match(html, /Set auto for this session/);
	assert.match(html, /Set auto for all sessions/);
	// The reserved status slot exists even when empty, so nothing reflows later.
	assert.match(html, /data-approval-escape-status/);
	assert.match(html, /min-h-5/);
	// Muted ink, never the accent/primary fill.
	assert.match(html, /text-ink-muted/);
	assert.doesNotMatch(html, /bg-accent/);
	// 44px minimum hit targets.
	assert.match(html, /min-h-11/);
});

test("a policy call disables only its own handles", () => {
	const html = renderControls({ busy: true });
	assert.match(
		buttonOpeningTag(html, "Set auto for this session"),
		/ disabled(?:=""|\s|>)/,
	);
	assert.match(
		buttonOpeningTag(html, "Set auto for all sessions"),
		/ disabled(?:=""|\s|>)/,
	);
});

test("the reserved slot carries the confirmation or the refusal", () => {
	assert.equal(
		renderControls({ status: { kind: "idle" } }).includes("<output"),
		true,
	);

	const session = renderControls({ status: { kind: "session-saved" } });
	assert.match(
		session,
		/Auto for this session — this request still needs an answer\./,
	);

	const savedDefault = renderControls({ status: { kind: "default-saved" } });
	assert.match(
		savedDefault,
		/Auto set for this conversation; saved as the default for sessions that follow it\. Conversations with their own choice keep it\. This request still needs an answer\./,
	);

	const partial = renderControls({
		status: {
			kind: "default-saved-session-failed",
			detail: "this session needs operator authority",
		},
	});
	assert.match(
		partial,
		/Auto saved as the default for sessions that follow it\. The session part did not apply: this session needs operator authority\. This request still needs an answer\./,
	);
	assert.match(partial, /text-danger/);

	const refused = renderControls({
		status: { kind: "refused", detail: "no operator anchor on this machine" },
	});
	assert.match(refused, /Unchanged: no operator anchor on this machine/);
	assert.match(refused, /text-danger/);
	// The failure does not leave its own handles disabled either.
	assert.doesNotMatch(
		buttonOpeningTag(refused, "Set auto for this session"),
		/ disabled(?:=""|\s|>)/,
	);
	assert.equal(APPROVAL_ESCAPE_COPY.unchanged("x"), "Unchanged: x");
});

test("the approval card keeps Approve and Deny enabled beside the handles", () => {
	const html = renderToStaticMarkup(
		createElement(QuestionDock, {
			gate: approvalGate(),
			sessionId: SESSION,
			onAnswer: () => {},
		}),
	);
	assert.match(html, /Set auto for this session/);
	assert.doesNotMatch(
		buttonOpeningTag(html, "Approve"),
		/ disabled(?:=""|\s|>)/,
	);
	assert.doesNotMatch(buttonOpeningTag(html, "Deny"), / disabled(?:=""|\s|>)/);

	// Without a session there is no gate to address, so the row is absent rather
	// than present and inert.
	const noSession = renderToStaticMarkup(
		createElement(QuestionDock, {
			gate: approvalGate(),
			onAnswer: () => {},
		}),
	);
	assert.doesNotMatch(noSession, /Set auto for this session/);
});

/*
 * Finding 2: the picker's default scope may no longer promise that THIS session
 * is left alone. The saved default reaches live conversations that follow it, so
 * the claim is about followers, and a conversation with its own choice keeps it.
 */
test("the approvals picker's default scope describes followers, not an unchanged session", () => {
	const picker = readFileSync(
		"src/renderer/src/features/chat/pickers/destination-pickers.tsx",
		"utf8",
	);
	assert.match(picker, /label: "Default for all sessions that follow it"/);
	assert.match(picker, /Default approvals for all sessions that follow it:/);
	assert.match(
		picker,
		/This session follows it unless it has its own choice\./,
	);
	assert.doesNotMatch(picker, /This session is unchanged\./);
});
