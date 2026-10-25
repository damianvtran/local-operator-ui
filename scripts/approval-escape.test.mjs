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
			'export { runApprovalEscape, ApprovalEscapeControls, APPROVAL_ESCAPE_COPY, approvalPolicyLine } from "./src/renderer/src/features/chat/components/trace/approval-escape";',
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
	runApprovalEscape,
	ApprovalEscapeControls,
	APPROVAL_ESCAPE_COPY,
	approvalPolicyLine,
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

/*
 * NO ANSWER DOOR EXISTS. `ApprovalEscapePorts` has only `runCommand` and
 * `editDefault`, and the call-order test below pins the exact command. This
 * source assertion is the belt to that structural brace: a future edit that
 * imported the answer path would name it here first.
 */
test("the escape hatch never reaches the answer op", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/trace/approval-escape.tsx",
		"utf8",
	);
	assert.doesNotMatch(source, /sessions\.answer|approval_answer/);
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
	// ONE prefix: the status adds "Unchanged: ", so the caller's own prefix is
	// dropped here and the transport's detail survives intact.
	assert.deepEqual(unreachable, {
		kind: "unchanged",
		detail: "Desktop controls could not reach the backend process.",
	});
});

test("a no-gates notice is a refusal, not a mode change", async () => {
	const sentence =
		"exec uses its original headless approval gate (non-TTY requests deny); launch with --control for supervisor approval controls";
	const outcome = await runApprovalEscape("session", {
		runCommand: async () => ({
			outcome: { kind: "notice", text: sentence, style: "warning", data: {} },
			result: { tone: "warning", text: sentence },
		}),
		editDefault: async () => {
			throw new Error("the session handle must not write the default");
		},
	});
	assert.deepEqual(outcome, { kind: "unchanged", detail: sentence });

	// The core's structured outcome is the same fact when it is present: a
	// notice carrying `ok: false` did not move the gate, whatever its prose.
	const structured = await runApprovalEscape("session", {
		runCommand: async () => ({
			outcome: {
				kind: "notice",
				text: "tool approvals: auto — every tool runs without asking (this session)",
				style: "warning",
				data: { ok: false },
			},
			result: { tone: "warning", text: "unused" },
		}),
		editDefault: async () => {
			throw new Error("the session handle must not write the default");
		},
	});
	assert.deepEqual(structured, {
		kind: "unchanged",
		detail:
			"tool approvals: auto — every tool runs without asking (this session)",
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
		detail: "Desktop controls could not reach the backend process.",
	});
});

test("the handles are subordinate text buttons with full names", () => {
	const html = renderControls({});
	assert.match(html, /Set auto for this session/);
	assert.match(html, /Set auto for all sessions/);
	// The reserved status slot exists even when empty, so nothing reflows later.
	assert.match(html, /data-approval-escape-status/);
	assert.match(html, /min-h-\[2lh\]/);
	assert.doesNotMatch(html, /min-h-5/);
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

test("the policy line names the effective mode and its provenance", () => {
	assert.equal(
		approvalPolicyLine({ mode: "ask", provenance: "global" }),
		"Approvals: Ask — global default.",
	);
	assert.equal(
		approvalPolicyLine({
			mode: "ask",
			provenance: "session",
			globalMode: "auto",
		}),
		"Approvals: Ask — session override; global Auto.",
	);
	assert.equal(
		approvalPolicyLine({ mode: "ask", provenance: "session" }),
		"Approvals: Ask — session override.",
	);
	assert.equal(
		approvalPolicyLine({ mode: "auto", provenance: "pin" }),
		"Approvals: Auto — this run.",
	);
	// An older backend sends neither field: no line, never a guess.
	assert.equal(approvalPolicyLine({}), null);
	assert.equal(approvalPolicyLine({ mode: "ask" }), null);
	assert.equal(approvalPolicyLine({ provenance: "global" }), null);
	// The core's not-stated stamp (`""`) is absence, not a mode named "Ask".
	assert.equal(approvalPolicyLine({ mode: "", provenance: "" }), null);
	assert.equal(approvalPolicyLine({ mode: "", provenance: "global" }), null);

	const line = renderControls({
		policyLine: approvalPolicyLine({
			mode: "ask",
			provenance: "session",
			globalMode: "auto",
		}),
	});
	assert.match(line, /data-approval-policy-line/);
	assert.match(line, /Approvals: Ask — session override; global Auto\./);
	// Above the handles, in document order.
	assert.ok(
		line.indexOf("Approvals: Ask") < line.indexOf("Set auto for this session"),
	);
	assert.doesNotMatch(renderControls({}), /data-approval-policy-line/);
});

test("the approval card keeps Approve and Deny enabled beside the handles", () => {
	const html = renderToStaticMarkup(
		createElement(QuestionDock, {
			gate: approvalGate({
				approval_mode: "ask",
				approval_provenance: "session",
				approval_global_mode: "auto",
			}),
			sessionId: SESSION,
			onAnswer: () => {},
		}),
	);
	assert.match(html, /Set auto for this session/);
	assert.match(html, /Approvals: Ask — session override; global Auto\./);
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
	assert.doesNotMatch(noSession, /data-approval-policy-line/);

	// The same omission for a gate that CARRIES the fields with the core's
	// not-stated `""`: an empty mode is not a policy to name.
	const notStated = renderToStaticMarkup(
		createElement(QuestionDock, {
			gate: approvalGate({
				approval_mode: "",
				approval_provenance: "",
				approval_global_mode: "",
			}),
			sessionId: SESSION,
			onAnswer: () => {},
		}),
	);
	assert.match(notStated, /Set auto for this session/);
	assert.doesNotMatch(notStated, /data-approval-policy-line/);
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
	assert.match(
		picker,
		/ui\.chat\.pickers\.destination_pickers\.default_for_all_sessions_that_follow_it/,
	);
	assert.match(
		picker,
		/ui\.chat\.pickers\.destination_pickers\.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i/,
		"the saved-default sentence carries both the follower claim and this session's exception",
	);
	assert.doesNotMatch(picker, /This session is unchanged\./);
});
