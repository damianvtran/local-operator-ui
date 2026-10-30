/**
 * The Team Bridge (`bridge`) tool row: the tokens, and this app's words for them.
 *
 * WHY A FIRST-CLASS ROW. Before this, `bridge` fell to the generic row: a
 * wrench, `Called bridge`, and the first two scalars of its arguments - which
 * for a channel post are the conversation id and whatever came next
 * (`Called bridge bcv_b0044d… 3`, the operator's report). One tool with fourteen
 * ops cannot be read from its wire name, and an opaque id is not a destination
 * a person recognises.
 *
 * TWO HALVES, deliberately separate:
 *
 * 1. `bridgeRow` is a faithful port of the core's shared, host-free
 *    `local_operator/harness/rows.py::bridge_row(args, details)` (sibling PR in
 *    `damianvtran/local-operator`). It returns language-free TOKENS - the op,
 *    the composed action, the target's kind and label, a preview, a count, an
 *    emoji, an outcome and a code - so the TUI, the phone and this app decide
 *    the same facts and word them in their own catalogues. Keep it pure: no
 *    `t()`, no React, no query cache. A change here is a change to the shared
 *    contract and must land in the core function too.
 * 2. `bridgeVerb` / `bridgeSummary` / the copy helpers turn the tokens into
 *    this app's sentence through keyed `t()` copy. The conversation NAME may
 *    come from the Team Bridge query cache, which only a component can reach,
 *    so it arrives as a `resolver` argument rather than an import: the model
 *    stays a pure function the node suites can bundle.
 *
 * Every label and preview is member- or model-written text from another
 * person's organization, so it is flattened and stripped of control
 * characters before it reaches a row, and an id (`bcv_`, `bcmsg_`, `acc_`,
 * `ep_`) is never accepted as a label - an id is the thing this row exists to
 * stop showing.
 */
import { t } from "@shared/i18n";

/** What kind of thing the call acted on; picks the fallback word and the `#`. */
export type BridgeTargetKind =
	| "channel"
	| "dm"
	| "person"
	| "message"
	| "directory"
	| "none";

/**
 * How the call ended, beyond plain success. `null` is plain success, a
 * running call, or a result this build cannot read - never a guess.
 */
export type BridgeOutcome =
	| "inbox_only"
	| "refused"
	| "failed"
	| "unconfirmed"
	| "awaiting_acceptance"
	| null;

export type BridgeRowTokens = {
	op: string;
	/** `op`, except the composites `react-remove`, `ack-working`, `ack-done`. */
	action: string;
	target: { kind: BridgeTargetKind; label: string | null };
	preview: string | null;
	count: number | null;
	emoji: string | null;
	outcome: BridgeOutcome;
	code: string | null;
};

/** The ops whose target is a conversation (named `#…`). */
const CHANNEL_OPS: ReadonlySet<string> = new Set([
	"channel_post",
	"channel_create",
	"channel_history",
	"channel_thread",
	"react",
	"shared_history",
]);

/** The ops that WRITE a message someone else reads (the fold's post noun). */
export const BRIDGE_POST_OPS: ReadonlySet<string> = new Set([
	"channel_post",
	"dm",
	"send",
	"reply",
]);

/**
 * Every op the tool publishes (`BridgeToolParams.op`, mirrored by the core's
 * `BRIDGE_KNOWN_OPS`). An op outside it yields no target, count or outcome -
 * the core's "never a guess" rule for a newer core's op.
 */
const KNOWN_OPS: ReadonlySet<string> = new Set([
	"take_up",
	"ack",
	"send",
	"reply",
	"channels",
	"channel_create",
	"channel_post",
	"channel_history",
	"react",
	"channel_thread",
	"directory",
	"dm",
	"shared_conversations",
	"shared_history",
]);

/** Hub ids are never a label: showing one is the defect this row fixes. */
const HUB_ID = /^(?:bcv|bcmsg|acc|ep)_/i;

/**
 * A whole terminal escape sequence, removed WHOLE before the per-character
 * strip (core `_BRIDGE_ESCAPE_RE`): dropping only the ESC byte would leave
 * `[31m` as text inside a label. Spelled with escapes so the source carries no
 * control bytes.
 */
const ESCAPE_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
	/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|\x9b[0-?]*[ -/]*[@-~]/g;

/** C0 (minus the whitespace the flatten step handles), DEL and C1. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control bytes is the point
const CONTROL = /[\x00-\x08\x0e-\x1f\x7f-\x9f]/g;

/**
 * Every Unicode `Cf` (format) character EXCEPT ZWNJ (U+200C) and ZWJ (U+200D),
 * byte-for-byte the core `_bridge_clean`'s rule (agent review round 1, R2).
 *
 * A label here is another organization's member text, and a format character
 * survives the control strip above: `U+202E` (RTL override) turns `gnp.exe`
 * into `exe.png` and, unterminated, reorders the rest of the row; isolates and
 * zero-width characters hide seams without a single control byte. The
 * category, not a codepoint list, is the class (`receipt-row-model.ts`'s
 * `FORMAT_CHARACTERS` precedent) so the next bidi control is covered too. The
 * two joiners are kept on purpose: ZWJ builds emoji sequences (`👨‍👩‍👧`) and
 * both shape Devanagari/Urdu text, so stripping them would corrupt the hi/ur
 * names this row exists to show.
 */
const FORMAT_CHARACTERS = /(?![\u200c\u200d])\p{Cf}/gu;

/** Python's `str.split()` whitespace set, which the core flattens on. */
const WHITESPACE_RUN = /[\t\n\r\v\f ]+/;
/** `str.splitlines()`'s common breaks. */
const LINE_BREAK = /\r\n|\r|\n/;
/** A whole Team Bridge conversation id. */
const CONVERSATION_ID = /^bcv_\S+$/;

/** The core's `_BRIDGE_TEXT_MAX`: keeps a pasted essay from riding every row. */
const TEXT_MAX = 200;

/**
 * Member/model-written text made safe for one row, exactly as the core's
 * `_bridge_clean`: escape sequences and control characters out, whitespace
 * runs flattened to one space, trimmed, capped. `null` when nothing is left.
 */
export function bridgeText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const flat = value
		.replace(ESCAPE_SEQUENCE, "")
		.replace(CONTROL, "")
		.replace(FORMAT_CHARACTERS, "")
		.split(WHITESPACE_RUN)
		.filter(Boolean)
		.join(" ")
		.slice(0, TEXT_MAX);
	return flat || null;
}

/** A label candidate, refused when it is empty or an id. */
function labelText(value: unknown): string | null {
	const text = bridgeText(value);
	return text && !HUB_ID.test(text) ? text : null;
}

/*
 * INLINE MARKDOWN OUT OF THE ONE-LINE PREVIEW (design round 1, D1/D2). A post
 * body is markdown and the expansion renders it as such, but the collapsed
 * summary is plain text: `Tagged **v0.46.7**` put literal asterisks on the
 * most-scanned line in the transcript. Only the PREVIEW token is stripped; the
 * expanded body keeps the author's markdown.
 *
 * A port of the core's `_bridge_plain` regexes, clause for clause, so the TUI,
 * the phone and this app print one preview: leading block markers (heading,
 * quote, list) go; `[text](url)` keeps its text; `**`/`__`/`~~`/backticks are
 * always markers in a one-line preview; a single `*`/`_` goes only at a word
 * EDGE, so `snake_case` and `2 * 3` survive. Python's `\w` is Unicode letters,
 * numbers and `_` - spelled out here because JavaScript's `\w` is ASCII-only.
 */
const MD_BLOCK = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,9}[.)]\s+)+/u;
const MD_LINK = /!?\[([^\]]*)\]\([^)]*\)/gu;
const MD_PAIRED = /\*\*|__|~~|`+/gu;
const MD_EDGE =
	/(?<![\p{L}\p{N}_*])[*_](?=[^\s*_])|(?<=[^\s*_])[*_](?![\p{L}\p{N}_*])/gu;
/** What the core's `str.strip("-=*_~`#> ")` leaves: a markup-only line is skipped. */
const MARKUP_ONLY = /^[-=*_~`#> ]*$/;

/** One markdown line as the plain words a collapsed preview shows. */
export function bridgePlain(line: string): string {
	return line
		.replace(MD_BLOCK, "")
		.replace(MD_LINK, "$1")
		.replace(MD_PAIRED, "")
		.replace(MD_EDGE, "");
}

/** The first non-empty line of a body, flattened, inline markdown removed. */
function firstLine(value: unknown): string | null {
	if (typeof value !== "string") return null;
	for (const line of value.split(LINE_BREAK)) {
		const text = bridgeText(bridgePlain(line));
		// A rule (`---`) or a fence is all markup: try the next line (core rule).
		if (text && !MARKUP_ONLY.test(text)) return text;
	}
	return null;
}

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

/**
 * The JSON a result's `content` carries, or `null`.
 *
 * Read-shaped results put the untrusted clause FIRST and the JSON after the
 * first blank line (`tool.py`: `f"{BRIDGE_UNTRUSTED_CLAUSE}\n\n{json.dumps(…)}"`);
 * `channels`/`channel_create` carry bare JSON. `json.dumps` escapes newlines
 * inside strings, so the first literal blank line is always the clause's end.
 */
function contentJson(content: unknown): unknown {
	if (typeof content !== "string") return null;
	try {
		return JSON.parse(content);
	} catch {
		// Not bare JSON: fall through to the clause-wrapped shape.
	}
	const gap = content.indexOf("\n\n");
	if (gap < 0) return null;
	try {
		return JSON.parse(content.slice(gap + 2));
	} catch {
		return null;
	}
}

/** The composed action: the three ops whose flag changes what happened. */
function bridgeAction(
	op: string,
	args: Record<string, unknown>,
	details: Record<string, unknown> | null,
): string {
	/*
	 * `remove === true` only, as the core reads it: the tool's schema is a
	 * strict-typed bool at the wire the core sees, and the shared tokens must
	 * agree byte for byte with the TUI's and the phone's.
	 */
	if (op === "react") return args.remove === true ? "react-remove" : "react";
	if (op === "ack") {
		// The result's own `state` stands in when the args were not kept.
		const state = args.state || details?.state;
		if (state === "working") return "ack-working";
		if (state === "done") return "ack-done";
	}
	return op;
}

function targetKind(op: string): BridgeTargetKind {
	if (CHANNEL_OPS.has(op)) return "channel";
	if (op === "dm") return "dm";
	if (op === "send" || op === "reply") return "person";
	if (op === "take_up" || op === "ack") return "message";
	if (op === "directory") return "directory";
	return "none";
}

/**
 * The target's display label, in the contract's order:
 * 1. `details.conversation_label` (forward-compatible: the core tool does not
 *    emit it yet);
 * 2. the DM receipt's own words, `direct message to <label> in bcv_…`;
 * 3. `channel_create`'s content JSON `name`, then its call's `name`;
 * 4. `to.name`, for the person-shaped ops only.
 */
function targetLabel(
	op: string,
	args: Record<string, unknown>,
	details: Record<string, unknown> | null,
): string | null {
	const fromDetails = labelText(details?.conversation_label);
	if (fromDetails) return fromDetails;
	if (op === "dm" && typeof details?.content === "string") {
		// The core's `_bridge_dm_label`: cut at the FIRST ` in bcv_`.
		const lead = "direct message to ";
		if (details.content.startsWith(lead)) {
			const rest = details.content.slice(lead.length);
			const cut = rest.indexOf(" in bcv_");
			const dm = cut > 0 ? labelText(rest.slice(0, cut)) : null;
			if (dm) return dm;
		}
	}
	if (op === "channel_create") {
		const created = record(contentJson(details?.content));
		const name = labelText(created?.name);
		if (name) return name;
	}
	/*
	 * `name` is a schema field on every op, but the executor reads it ONLY in
	 * `channel_create`. A model can still send `{op:"channel_post",
	 * channel_id:"bcv_X", name:"general"}`: the post lands in bcv_X, and
	 * reading `name` here painted `Posted in #general` - the wrong room, over
	 * the resolver's true name. Core `rows.py::_bridge_target` gates it the
	 * same way, so the TUI, the phone and this app name one call alike
	 * (agent review round 2, R2-1).
	 */
	if (op === "channel_create") {
		const named = labelText(args.name);
		if (named) return named;
	}
	/*
	 * `to` is the RECIPIENT only for the person-shaped ops. On `channel_post`
	 * it is a MENTION (core `tool.py`: `validate_recipient_shape(params.to)`,
	 * which demands a display name): reading it there painted `Posted in
	 * #Alice` for a post in #release that mentioned Alice - a wrong claim about
	 * where the message went (agent review round 1, R1).
	 */
	const kind = targetKind(op);
	if (kind !== "person" && kind !== "dm") return null;
	const to = record(args.to);
	return labelText(to?.name);
}

/**
 * The target, gated as the core gates it: a message or the directory names
 * no conversation (a stray `name` must not dress one up), and an unknown op
 * has no target at all.
 */
function bridgeTarget(
	op: string,
	args: Record<string, unknown>,
	details: Record<string, unknown> | null,
): BridgeRowTokens["target"] {
	const kind = targetKind(op);
	if (kind === "none" || kind === "message" || kind === "directory")
		return { kind, label: null };
	return { kind, label: targetLabel(op, args, details) };
}

/** The first array among a list result's values (`conversations`, `items`, …). */
function listLength(value: unknown): number | null {
	if (Array.isArray(value)) return value.length;
	const object = record(value);
	if (!object) return null;
	for (const key of ["conversations", "items", "data"]) {
		if (Array.isArray(object[key])) return (object[key] as unknown[]).length;
	}
	return null;
}

function resultCount(
	op: string,
	details: Record<string, unknown> | null,
): number | null {
	if (!details) return null;
	const parsed = contentJson(details.content);
	const page = record(parsed);
	if (op === "channel_history" || op === "shared_history") {
		return Array.isArray(page?.messages)
			? (page.messages as unknown[]).length
			: null;
	}
	if (op === "channel_thread") {
		if (!page) return null;
		const root = record(page.root) ? 1 : 0;
		const replies = Array.isArray(page.replies)
			? (page.replies as unknown[]).length
			: null;
		if (replies === null && root === 0) return null;
		return root + (replies ?? 0);
	}
	if (op === "directory") {
		if (typeof page?.count === "number" && Number.isInteger(page.count))
			return page.count;
		return Array.isArray(details.members)
			? (details.members as unknown[]).length
			: null;
	}
	if (op === "channels" || op === "shared_conversations")
		return listLength(parsed);
	return null;
}

function resultOutcome(
	op: string,
	details: Record<string, unknown> | null,
): { outcome: BridgeOutcome; code: string | null } {
	if (!details || Object.keys(details).length === 0)
		return { outcome: null, code: null };
	const code = bridgeText(details.code);
	if (details.ok === true) {
		if (details.destination_type === "peer_inbox")
			return { outcome: "inbox_only", code: null };
		const state = details.recipient_state;
		if (
			op === "dm" &&
			typeof state === "string" &&
			state !== "" &&
			state !== "active"
		)
			return { outcome: "awaiting_acceptance", code: null };
		return { outcome: null, code: null };
	}
	if (details.ok === false) {
		/*
		 * `post_failed` means the hub may have TAKEN the post and only the
		 * confirmation was lost: "failed" would invite a duplicate re-post.
		 */
		if (code === "send_unconfirmed" || code === "post_failed")
			return { outcome: "unconfirmed", code };
		if (code?.endsWith("_failed")) return { outcome: "failed", code };
		return { outcome: "refused", code };
	}
	return { outcome: null, code };
}

/**
 * The shared tokens for one `bridge` call. Port of
 * `local_operator/harness/rows.py::bridge_row`; see this file's header.
 *
 * `details` is the result's `ToolResult.details` - the whole `execute_bridge`
 * dict minus `_images` (`local_operator/team_bridge/tool.py`) - or `null` while
 * the call runs, on an old transcript, or when the live budget stripped it.
 */
export function bridgeRow(
	args: Record<string, unknown> | null | undefined,
	details?: Record<string, unknown> | null,
): BridgeRowTokens {
	const call = args ?? {};
	// Cleaned, NOT lowercased: the core keeps the op's own spelling, and the
	// schema's Literal means a real call is already lowercase.
	const op = bridgeText(call.op) ?? "";
	const facts = record(details);
	const known = KNOWN_OPS.has(op);
	const preview =
		BRIDGE_POST_OPS.has(op) || op === "take_up"
			? (firstLine(call.body) ?? firstLine(call.text) ?? firstLine(facts?.text))
			: null;
	return {
		op,
		action: bridgeAction(op, call, facts),
		target: known
			? bridgeTarget(op, call, facts)
			: { kind: "none", label: null },
		preview,
		// A count is a fact about what came back, so only a success states one.
		count: known && facts?.ok === true ? resultCount(op, facts) : null,
		emoji: op === "react" ? bridgeText(call.emoji) : null,
		...(known ? resultOutcome(op, facts) : { outcome: null, code: null }),
	};
}

/* ------------------------------------------------------------- copy */

/**
 * Looks a conversation's NAME up by its `bcv_` id, or answers `null`.
 *
 * Built by the component from the Team Bridge conversations query cache when
 * it is populated (`conversationTitle`); absent everywhere else. The model
 * never reaches for the cache itself.
 */
export type BridgeLabelResolver = (conversationId: string) => string | null;

/** The conversation id a call addressed, for the resolver. */
export function bridgeConversationId(
	args: Record<string, unknown> | null | undefined,
	details?: Record<string, unknown> | null,
): string | null {
	for (const value of [args?.channel_id, details?.conversation_id]) {
		if (typeof value === "string" && CONVERSATION_ID.test(value.trim()))
			return value.trim();
	}
	return null;
}

/** The ops this build has words for, keyed by their catalogue segment. */
const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
	"channel_post",
	"dm",
	"send",
	"reply",
	"channels",
	"channel_create",
	"channel_history",
	"channel_thread",
	"react",
	"react_remove",
	"directory",
	"shared_conversations",
	"shared_history",
	"take_up",
	"ack_working",
	"ack_done",
]);

/** `react-remove` → `react_remove`: catalogue key segments use underscores. */
const actionSegment = (action: string): string => {
	/*
	 * `ack` with no `working`/`done` state is reachable - the executor REFUSES
	 * it (`ack needs message_id and state`) - and is still a documented op, so
	 * it must not read as an unknown one (`Used Team Bridge ack`; agent review
	 * round 1, R3). There is no neutral ack verb, so it takes the claim words:
	 * an ack without a state is an attempt to take the message up.
	 */
	if (action === "ack") return "ack_working";
	const segment = action.replace(/-/g, "_");
	return KNOWN_ACTIONS.has(segment) ? segment : "unknown";
};

/** Whether this build has a verb for the call's action. */
export function isKnownBridgeAction(action: string): boolean {
	return actionSegment(action) !== "unknown";
}

/*
 * The keys are written out rather than built from the segment so the typed
 * `t()` checks every one at compile time - a template-literal key would lose
 * that, and a missing catalogue entry would only surface as a raw id on screen.
 */
type VerbForms = { settled: string; running: string; failed: string };
const VERBS: Record<string, () => VerbForms> = {
	channel_post: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.channel_post.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.channel_post.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.channel_post.failed"),
	}),
	dm: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.dm.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.dm.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.dm.failed"),
	}),
	send: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.send.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.send.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.send.failed"),
	}),
	reply: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.reply.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.reply.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.reply.failed"),
	}),
	channels: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.channels.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.channels.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.channels.failed"),
	}),
	channel_create: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.channel_create.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.channel_create.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.channel_create.failed"),
	}),
	channel_history: () => ({
		settled: t(
			"ui.chat.canonical.tool_row.bridge.verb.channel_history.settled",
		),
		running: t(
			"ui.chat.canonical.tool_row.bridge.verb.channel_history.running",
		),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.channel_history.failed"),
	}),
	channel_thread: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.channel_thread.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.channel_thread.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.channel_thread.failed"),
	}),
	react: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.react.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.react.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.react.failed"),
	}),
	react_remove: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.react_remove.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.react_remove.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.react_remove.failed"),
	}),
	directory: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.directory.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.directory.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.directory.failed"),
	}),
	shared_conversations: () => ({
		settled: t(
			"ui.chat.canonical.tool_row.bridge.verb.shared_conversations.settled",
		),
		running: t(
			"ui.chat.canonical.tool_row.bridge.verb.shared_conversations.running",
		),
		failed: t(
			"ui.chat.canonical.tool_row.bridge.verb.shared_conversations.failed",
		),
	}),
	shared_history: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.shared_history.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.shared_history.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.shared_history.failed"),
	}),
	take_up: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.take_up.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.take_up.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.take_up.failed"),
	}),
	ack_working: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.ack_working.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.ack_working.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.ack_working.failed"),
	}),
	ack_done: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.ack_done.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.ack_done.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.ack_done.failed"),
	}),
	unknown: () => ({
		settled: t("ui.chat.canonical.tool_row.bridge.verb.unknown.settled"),
		running: t("ui.chat.canonical.tool_row.bridge.verb.unknown.running"),
		failed: t("ui.chat.canonical.tool_row.bridge.verb.unknown.failed"),
	}),
};

/**
 * The verb forms for an action (`toolOp`'s composed token). Resolved at call
 * time, never at module load, so an interface-language switch repaints them.
 * An op this build does not know says `Used Team Bridge` and puts the op in
 * the object - the honest claim, the generic row's own rule.
 */
export function bridgeVerb(action: string): VerbForms {
	return VERBS[actionSegment(action)]();
}

/** The target as the row prints it: `#name`, a bare person, or a kind word. */
export function bridgeTargetText(
	tokens: BridgeRowTokens,
	resolved: string | null = null,
): string {
	const { kind } = tokens.target;
	const label = tokens.target.label ?? labelText(resolved);
	if (label) {
		return kind === "channel" && !label.startsWith("#") ? `#${label}` : label;
	}
	/*
	 * The verb already names the thing (`Read shared conversation`): a kind
	 * word after it read `Read shared conversation a conversation`, on every
	 * real call, since a shared read's result carries no label. Same rule in
	 * the core port (QA round 2, Q2-5 / review R2-5).
	 */
	if (tokens.op === "shared_history") return "";
	if (kind === "channel")
		return t("ui.chat.canonical.tool_row.bridge.fallback.conversation");
	if (kind === "dm") return t("ui.chat.canonical.tool_row.bridge.fallback.dm");
	if (kind === "person")
		return t("ui.chat.canonical.tool_row.bridge.fallback.teammate");
	if (kind === "message")
		return t("ui.chat.canonical.tool_row.bridge.fallback.message");
	return "";
}

/**
 * The object column for a `bridge` row, in the settled copy's grammar
 * (verb + object): `#release · Tagged v0.46.7`, `#release (12 messages)`.
 *
 * The ` · ` join is the row's existing separator between independent facts
 * (`sendSummary`), not a sentence being assembled; every phrase with grammar
 * in it is one ICU message.
 */
export function bridgeSummary(
	tokens: BridgeRowTokens,
	args: Record<string, unknown> | null | undefined,
	resolver?: BridgeLabelResolver | null,
	details?: Record<string, unknown> | null,
): string {
	const id = bridgeConversationId(args, details);
	const resolved = !tokens.target.label && id && resolver ? resolver(id) : null;
	const target = bridgeTargetText(tokens, resolved);
	const join = (...parts: (string | null)[]) =>
		parts.filter(Boolean).join(" · ");
	// `trim()`: an unlabelled shared read has an empty `{target}` (see
	// `bridgeTargetText`), and every locale leads the message with it.
	const withMessages = () =>
		tokens.count === null
			? target
			: t("ui.chat.canonical.tool_row.bridge.summary.messages", {
					target,
					count: tokens.count,
				}).trim();
	switch (actionSegment(tokens.action)) {
		case "channel_post": {
			const thread =
				typeof args?.thread_root_id === "string" && args.thread_root_id.trim()
					? t("ui.chat.canonical.tool_row.bridge.target.thread", { target })
					: target;
			return join(thread, tokens.preview);
		}
		case "dm":
		case "send":
		case "reply":
		case "take_up":
			return join(target, tokens.preview);
		case "channels":
		case "shared_conversations":
			return tokens.count === null
				? ""
				: t("ui.chat.canonical.tool_row.bridge.summary.count", {
						count: tokens.count,
					});
		case "directory":
			return tokens.count === null
				? ""
				: t("ui.chat.canonical.tool_row.bridge.summary.members", {
						count: tokens.count,
					});
		case "channel_history":
		case "channel_thread":
		case "shared_history":
			return withMessages();
		case "react":
		case "react_remove":
			return join(target, tokens.emoji);
		case "channel_create":
		case "ack_working":
		case "ack_done":
			return target;
		default:
			return tokens.op;
	}
}

/**
 * The trailing word a FAILED bridge row prints in error ink: `refused ·
 * not_member`, `failed · post_failed`. `null` for every other outcome, so the
 * row keeps its generic `failed`. The code is the tool's own machine token and
 * is never translated.
 */
export function bridgeFailureWord(tokens: BridgeRowTokens): string | null {
	if (tokens.outcome === "refused")
		return tokens.code
			? t("ui.chat.canonical.tool_row.bridge.outcome.refused", {
					code: tokens.code,
				})
			: t("ui.chat.canonical.tool_row.bridge.outcome.refused_bare");
	if (tokens.outcome === "failed")
		return tokens.code
			? t("ui.chat.canonical.tool_row.bridge.outcome.failed", {
					code: tokens.code,
				})
			: t("ui.chat.canonical.tool_row.bridge.outcome.failed_bare");
	return null;
}

/**
 * The result fields a `bridge` row carries on its record, read once from
 * `details` by the reducer. Only the scalar facts the row and its expansion
 * print; images never ride `details` (the core pops them first).
 */
export type BridgeResultFacts = Record<string, unknown>;

/** The keys the expansion lists under `Details`, in this order. */
export const BRIDGE_INTERNAL_KEYS = [
	"conversation_id",
	"message_id",
	"seq",
	"thread_root_id",
	"body_sha256",
	"destination_type",
	"receipt_stage",
	"execution_confirmed",
	"resolved_account_id",
	"recipient_state",
	"account_id",
	"endpoint_id",
	"state",
	"code",
] as const;

/**
 * The bridge facts a frame states, under the reducer's absent-vs-stated rule
 * (`preferDeliveryState`'s): a frame with no `details` object keeps
 * `previous`; a frame with one is the producer's statement and wins. Every
 * other tool answers `null`, so no other row grows the field.
 */
export function preferBridgeFacts(
	toolName: string,
	details: unknown,
	previous: BridgeResultFacts | null | undefined,
): BridgeResultFacts | null {
	if (toolName.trim().toLowerCase() !== "bridge") return null;
	const stated = record(details);
	if (!stated) return previous ?? null;
	const { _images: _dropped, ...facts } = stated;
	if (previous && sameFacts(previous, facts)) return previous;
	return facts;
}

/**
 * The destination's display name a RESULT states, without the call's args:
 * the core's label order minus its args step (`conversation_label`, the DM
 * receipt's `direct message to <label> in bcv_…`, `channel_create`'s returned
 * `name`). The DM and create readings are guarded by their receipts' own
 * shapes - `destination_type: "conversation_dm"`, `state: "created"` - since
 * the op itself is not on `details`.
 */
export function bridgeLabelFromDetails(details: unknown): string | null {
	const facts = record(details);
	if (!facts) return null;
	const op =
		facts.destination_type === "conversation_dm"
			? "dm"
			: facts.state === "created"
				? "channel_create"
				: "channel_post";
	return targetLabel(op, {}, facts);
}

/** `bridgeLabel` under the reducer's absent-vs-stated rule; `null` off-tool. */
export function preferBridgeLabel(
	toolName: string,
	details: unknown,
	previous: string | null | undefined,
): string | null {
	if (toolName.trim().toLowerCase() !== "bridge") return null;
	if (!record(details)) return previous ?? null;
	return bridgeLabelFromDetails(details);
}

/** Shallow equality over scalar facts, so a replayed frame keeps identity. */
function sameFacts(a: BridgeResultFacts, b: BridgeResultFacts): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every(
		(key) =>
			a[key] === b[key] ||
			(typeof a[key] === "object" &&
				JSON.stringify(a[key]) === JSON.stringify(b[key])),
	);
}

/* ------------------------------------------------------- the row view */

/**
 * Everything a `bridge` row paints beyond the generic row, from its record.
 *
 * Pure (the resolver is passed in), so the transcript stays a thin mount and
 * the suite can assert every state without a DOM.
 */
export type BridgeRowView = {
	tokens: BridgeRowTokens;
	/** The object column (`#release · Tagged v0.46.7`). */
	summary: string;
	/**
	 * The settled verb for a refused or failed call (`Couldn't post in`), or
	 * `null`: `Posted in … refused` would be the row contradicting itself.
	 */
	failedVerb: string | null;
	/** `refused · not_member` / `failed · post_failed`, or `null`. */
	failureWord: string | null;
	/** The expansion's first line: `Direct message to Ada`, `Posted in #release`. */
	headline: string | null;
	/** What was said, verbatim (markdown), or `null` for a read. */
	body: string | null;
	/**
	 * The outcome sentence the expansion prints under the body (`Posted at
	 * seq 42`, `Refused (not_member): …`), or `null` when the delivery note
	 * (`deliveryNote`) or nothing at all says it.
	 */
	outcome: string | null;
	/** The machine fields behind the `Details` disclosure, in a fixed order. */
	internals: { key: string; value: string }[];
	/** The raw result text (`content`, or the output), behind the same disclosure. */
	raw: string | null;
};

/** Args that carry a machine identity worth listing under `Details`. */
const ARG_INTERNALS: Readonly<Record<string, string>> = {
	channel_id: "conversation_id",
	message_id: "message_id",
	thread_root_id: "thread_root_id",
	body_sha256: "body_sha256",
	account_id: "account_id",
	endpoint_id: "endpoint_id",
};

/** An opaque Team Bridge id inside free text; see `bridgeRowView`'s scrub. */
const BRIDGE_ID_TOKEN = /\b(bcv|bcmsg|acc|ep)_[A-Za-z0-9_-]+/gi;

function scalar(value: unknown): string | null {
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return String(value);
	return null;
}

export function bridgeRowView(
	input: {
		args: Record<string, unknown> | null | undefined;
		/** The record's `bridge` facts (the result's `details`), when kept. */
		details: Record<string, unknown> | null | undefined;
		/** The record's `bridgeLabel`, read from the result by the reducer. */
		label?: string | null;
		output?: string | null;
		/** The row failed for the counts (`isFailedResult`). */
		failed: boolean;
	},
	resolver?: BridgeLabelResolver | null,
): BridgeRowView {
	const args = input.args ?? {};
	const details = input.details ?? null;
	const base = bridgeRow(args, details);
	// The reducer's label is the same source order, read at the moment the
	// result landed; it stands in when a later frame's details were stripped.
	const tokens =
		base.target.label === null &&
		input.label &&
		base.target.kind !== "none" &&
		base.target.kind !== "message" &&
		base.target.kind !== "directory"
			? { ...base, target: { ...base.target, label: input.label } }
			: base;
	const id = bridgeConversationId(args, details);
	const resolved = !tokens.target.label && id && resolver ? resolver(id) : null;
	const target = bridgeTargetText(tokens, resolved);
	const refusedOrFailed =
		tokens.outcome === "refused" || tokens.outcome === "failed";
	const failedVerb =
		input.failed || refusedOrFailed ? bridgeVerb(tokens.action).failed : null;
	/*
	 * The expansion's first line is a LABELLED sentence, the TUI's
	 * (`bridge_copy.bridge_expanded`): `Posted in #release`, `Sent to a
	 * teammate`, `Direct message to Ada` - never a bare `#release` the reader
	 * has to guess the role of (design round 1, D4). The object is the summary
	 * without its preview (the body is printed right below it), so a read keeps
	 * its count (`Read #general (7 messages)`) and a thread post its suffix.
	 */
	const verb = failedVerb ?? bridgeVerb(tokens.action).settled;
	// No preview and no emoji: the body is printed below, and the TUI headline
	// is `Reacted in a conversation`, not `… · 🚀` (QA round 2 nit).
	const head = bridgeSummary(
		{ ...tokens, preview: null, emoji: null },
		args,
		resolver,
		details,
	);
	/*
	 * A DM's headline names the PERSON. The kind word made an unlabelled one
	 * read `Direct message to a DM`; the core falls back to `a teammate`
	 * (QA round 2, Q2-4).
	 */
	const dmTarget =
		tokens.target.label ??
		labelText(resolved) ??
		t("ui.chat.canonical.tool_row.bridge.fallback.teammate");
	const headline =
		tokens.op === "dm"
			? t("ui.chat.canonical.tool_row.bridge.detail.headline.dm", {
					target: dmTarget,
				})
			: head
				? t("ui.chat.canonical.tool_row.bridge.detail.headline.target", {
						verb,
						target: head,
					})
				: verb;
	const bodyText = [args.body, args.text, details?.text].find(
		(value): value is string =>
			typeof value === "string" && value.trim() !== "",
	);
	const seq = typeof details?.seq === "number" ? details.seq : null;
	const rawError = scalar(details?.error);
	/*
	 * The refusal sentence names the conversation the way the lines above it
	 * do (design round 1, D5): `not a member of bcv_2210` under a headline
	 * that says `a conversation` gave one object two names, one of them an
	 * internal id. A `bcv_` token becomes the row's own target words; a
	 * message, account or endpoint id becomes `…`. Prefixes and case rule are
	 * core `bridge_copy._ID_TOKEN_RE` (review R2-2 / QA Q2-3); the raw text
	 * stays one click away, under `Details` (`error` below).
	 */
	const conversationWords =
		(tokens.target.kind === "channel" || tokens.target.kind === "dm") && target
			? target
			: t("ui.chat.canonical.tool_row.bridge.fallback.conversation");
	const error = rawError
		? rawError.replace(BRIDGE_ID_TOKEN, (_id, prefix: string) =>
				prefix.toLowerCase() === "bcv" ? conversationWords : "…",
			)
		: null;
	/*
	 * No empty slots (review R2-3 / QA Q2-2): a refusal can arrive without a
	 * message, a code, or either. Only the full pair takes the keyed sentence;
	 * an error alone is printed as it came (the `unconfirmed` precedent); with
	 * no error the row's own trailing word (`refused · not_member`, kept in the
	 * header above this panel) already says everything, so no line repeats it.
	 * This keeps the catalogue unchanged rather than add four arms per outcome
	 * that seven locales would have to re-translate.
	 */
	const outcome =
		tokens.outcome === "refused" || tokens.outcome === "failed"
			? error && tokens.code
				? t(
						tokens.outcome === "refused"
							? "ui.chat.canonical.tool_row.bridge.detail.outcome.refused"
							: "ui.chat.canonical.tool_row.bridge.detail.outcome.failed",
						{ code: tokens.code, error },
					)
				: error
			: tokens.outcome === "unconfirmed"
				? error
				: details?.ok === true && seq !== null
					? t(
							"ui.chat.canonical.tool_row.bridge.detail.outcome.posted_at_seq",
							{
								seq,
							},
						)
					: null;
	const internals: { key: string; value: string }[] = [];
	const seen = new Set<string>();
	const push = (key: string, value: unknown) => {
		const text = scalar(value);
		if (text === null || seen.has(key)) return;
		seen.add(key);
		internals.push({ key, value: text });
	};
	for (const key of BRIDGE_INTERNAL_KEYS) push(key, details?.[key]);
	// The unedited error, only when the sentence above had to rewrite it.
	if (rawError && rawError !== error) push("error", rawError);
	for (const [arg, key] of Object.entries(ARG_INTERNALS)) push(key, args[arg]);
	const rawText =
		(typeof details?.content === "string" && details.content) ||
		input.output ||
		null;
	// The output of a refusal is usually the error itself, already in the
	// sentence or the `error` row: printing it again stated it thrice (design
	// round 2, D9).
	const raw = rawText && rawText.trim() === rawError ? null : rawText;
	return {
		tokens,
		summary: bridgeSummary(tokens, args, resolver, details),
		failedVerb,
		failureWord: bridgeFailureWord(tokens),
		headline,
		body: bodyText ?? null,
		outcome,
		internals,
		raw,
	};
}
