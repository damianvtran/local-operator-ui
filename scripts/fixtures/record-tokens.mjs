/**
 * THE TOKEN GRAMMAR the model suites and the parity generator share.
 *
 * WHY A MODULE. `scripts/turn-segments.test.mjs` minted these records inline so a
 * fixture could be read as one line (`U T A W T A`). The condense parity fixture
 * (`scripts/generate-condense-parity.mjs`) has to drive the SHIPPED model over
 * the SAME shapes the suites assert, and a second copy of the grammar would drift
 * from the tests that define the behaviour - so the definition lives here once
 * and both import it. Adding a token is a change to what every consumer can
 * express, which is the point: nothing can fall into a shape the fixture cannot
 * build.
 */
/** The token line's separator: `seq` splits a shape string on it. */
const TOKEN_GAP = /\s+/;

export const TS = 1_000_000;

/**
 * Tokens: U user, T tool, N narration (settled assistant text that CARRIES its
 * own `tool_calls`, the wire fact `isFinalResponse` reads; no `stopReason`, so
 * the compat rule and the calls rule are asserted together), A a settled
 * assistant the provider DECLARED finished (`stopReason: "stop"`, no calls), F a
 * settled assistant with NO calls and no declared phase (a final response by the
 * wire's own reading - the V5 token), L the lead-in shape (settled text carried
 * with its own `tool_calls`, so `stopReason: "toolUse"`), S a STREAMING
 * assistant, E an assistant that paints nothing (tool calls only), W wake, P
 * peer, J job_result, H hub_message, X monitor_prompt, M terminal notice
 * (Stopped with an error), K closed receipt (complete notice, info), I
 * session_incident, C compaction, O an info notice (no completion), Q a quiet
 * custom (mcp).
 *
 * `N`, `L`, `E` CARRY `callsTools: true`, because that is what the wire says
 * about them: an assistant message that carries its own calls is mid-turn
 * narration/status commentary (`tui/narration.py::is_intermediate_narration`),
 * and a tool-call-only row is the same fact with no prose. `A` and `F` carry no
 * calls - the handover. `A` AND `L` CARRY THE PROVIDER'S PHASE DECLARATION,
 * because the V4 rule reads it (design note §1 and §2.2): `stop_reason: "stop"`
 * is the model saying it had FINISHED, and the durable reducer keeps exactly
 * that field on a text-bearing row (`transcript-reducer.ts:2264`). `N` and `F`
 * deliberately carry no `stopReason` at all, so the compat rule (an unknown
 * phase is treated as absent) is asserted rather than assumed.
 */
export const RECORDS = {
	U: (id, i) => ({ kind: "user", id, ts: TS + i, text: "hi" }),
	T: (id, i) => ({
		kind: "tool",
		id,
		ts: TS + i,
		toolName: "bash",
		isError: false,
		stopped: false,
		neverSent: false,
		notRunReason: null,
		endedAt: null,
		phase: "done",
	}),
	N: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
		callsTools: true,
	}),
	/* A final response with NO declared phase and NO calls: V5's own token. */
	F: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
	}),
	A: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
		stopReason: "stop",
	}),
	L: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
		stopReason: "toolUse",
		callsTools: true,
	}),
	S: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: true,
	}),
	E: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "",
		streaming: false,
		callsTools: true,
	}),
	W: (id, i) => ({ kind: "wake", id, ts: TS + i, text: "wake" }),
	P: (id, i) => ({
		kind: "peer",
		id,
		ts: TS + i,
		body: "peer",
		/*
		 * The FULL sender shape the reducer's `peerFields` guarantees. It used to
		 * be `{}` - a laxity nothing read until the quiet group's sender summary
		 * called `peerIdentity` on it and `sender.cwd.replace` threw (the `P` arm's
		 * crash pinned the contract harder than any comment had).
		 */
		sender: {
			pid: "",
			conversationName: "",
			cwd: "",
			sessionId: "",
			modelLabel: "",
		},
	}),
	J: (id, i) => custom(id, i, "job_result"),
	H: (id, i) => custom(id, i, "hub_message"),
	X: (id, i) => custom(id, i, "monitor_prompt"),
	Q: (id, i) => custom(id, i, "session_mcp_unavailable"),
	I: (id, i) => custom(id, i, "session_incident", "error"),
	/*
	 * The quiet-turn tokens (S2): `Z` is a SETTLED `no_reply` call (a close),
	 * `R` the same call still running (not one). `Q` was taken by the MCP custom.
	 */
	Z: (id, i) => ({
		kind: "tool",
		id,
		ts: TS + i,
		toolName: "no_reply",
		isError: false,
		stopped: false,
		neverSent: false,
		notRunReason: null,
		endedAt: null,
		phase: "done",
	}),
	R: (id, i) => ({
		kind: "tool",
		id,
		ts: TS + i,
		toolName: "no_reply",
		isError: false,
		stopped: false,
		neverSent: false,
		notRunReason: null,
		endedAt: null,
		phase: "running",
	}),
	M: (id, i) => ({
		kind: "notice",
		id,
		ts: TS + i,
		text: "Stopped with an error",
		level: "error",
		complete: true,
	}),
	K: (id, i) => ({
		kind: "notice",
		id,
		ts: TS + i,
		text: "Completed",
		level: "info",
		complete: true,
	}),
	O: (id, i) => ({ kind: "notice", id, ts: TS + i, text: "n", level: "info" }),
	C: (id, i) => ({ kind: "compaction", id, ts: TS + i, text: "Context" }),
	/*
	 * THE TOOL VARIETY TOKENS. One `bash` cannot pin the thing the fold is FOR:
	 * the count line's class/kind/name ordering, the failure tally and `Took`. Each
	 * of these names a tool whose `actionClass` (or KIND noun, or display name)
	 * lands in a different arm of `foldCountSegments`, and their ids say which arm
	 * a failing case is about.
	 */
	/** A file READ: `class:files`. */
	Rd: (id, i) => foldTool(id, i, "read"),
	/** A file WRITE: `class:edits`. */
	Wr: (id, i) => foldTool(id, i, "write"),
	/** A page FETCH: `class:searches` (the class table files `grep` under files). */
	Sr: (id, i) => foldTool(id, i, "web_fetch"),
	/** A WEB search: `class:web`. */
	Wb: (id, i) => foldTool(id, i, "web_search"),
	/**
	 * An MCP call: `name:<display name>`. The display name is where the core's
	 * `mcp__<server>_<tool>` minting is read, so this token is what pins
	 * `displayName`'s one-underscore split - a defect the real-journal run found
	 * while the corpus could not see it.
	 */
	Mc: (id, i) => foldTool(id, i, "mcp__datadog_search_datadog_metrics"),
	/** A delegated TASK: `class:delegated`. */
	Ag: (id, i) => foldTool(id, i, "task"),
	/** PYTHON: the `kind:python` runtime noun (`kill|shell · python`). */
	Py: (id, i) => foldTool(id, i, "eval"),
	/** An AGENT profile read: `kind:agent`, the meta-kind noun arm. */
	Ak: (id, i) => foldTool(id, i, "agent"),
	/** A TODO write: the `kind:todo` ID arm. */
	Td: (id, i) => foldTool(id, i, "todo"),
	/** A FAILED call: the group's `failedCount` and the bar's failure tally. */
	Fa: (id, i) => ({ ...foldTool(id, i, "bash"), isError: true }),
	/** A call that reported a DURATION: `workedSeconds`, and a bar's `Took`. */
	Du: (id, i) => ({ ...foldTool(id, i, "bash"), durationS: 7 }),
};

/** A settled tool record carrying only what the fold reads. */
function foldTool(id, i, toolName) {
	return {
		kind: "tool",
		id,
		ts: TS + i,
		toolName,
		phase: "done",
		isError: false,
		stopped: false,
		neverSent: false,
		notRunReason: null,
		durationS: null,
	};
}

function custom(id, i, customType, level = "info") {
	return { kind: "custom", id, ts: TS + i, customType, level, text: "t" };
}

/** `seq("U T A")` -> records with ids `U0 T1 A2`. */
export const seq = (spec) =>
	spec
		.trim()
		.split(TOKEN_GAP)
		.map((token, index) => RECORDS[token](`${token}${index}`, index));
