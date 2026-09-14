/**
 * Error notices in the canonical transcript, at the lengths the backend
 * actually produces.
 *
 * QA Q6: a notice shorter than the "long" threshold is rendered as a
 * `verbOverride` inside `TraceRow`'s `truncate` span with no disclosure to
 * open, so it was clipped to an ellipsis and the rest was reachable only
 * through devtools. The three actionable cold-start reasons land exactly in
 * that dead zone once the renderer prefixes "The message was not sent: "
 * (115-146 chars), and the clipped half is the INSTRUCTION rather than the
 * symptom.
 *
 * These stories render the production `CanonicalTranscript`, so they judge what
 * ships rather than a hand-built row. Read them at a narrow width too: the
 * point is that no width silently eats the second half of the sentence.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
	applyHistoryPage,
} from "./transcript-reducer";

/** The exact sentences `launch._ACTIONABLE_STARTUP_REASONS` ships, prefixed as the renderer prefixes them. */
const PREFIX = "The message was not sent: ";

const REASONS = [
	// 128 chars rendered.
	"No model provider is configured yet. Connect one in Settings > Providers, then send the message again.",
	// 146 chars rendered — the longest, and the one that lost the most.
	"This session's model provider is not recognised. Choose a provider in Settings > Providers, then send the message again.",
	// 115 chars rendered.
	"No model is selected for this session. Pick one with /model, then send the message again.",
];

const notice = (
	id: string,
	text: string,
	level: "info" | "warning" | "error",
): TranscriptRecord => ({
	kind: "notice",
	id,
	ts: 1_760_000_000_000,
	text,
	level,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
	} as TranscriptState;
}

const Frame = ({
	records,
	height = 600,
	expand = null,
}: {
	records: TranscriptRecord[];
	/** The viewport the rows are captured in, sized to what they hold. */
	height?: number;
	/**
	 * Row id whose disclosure is OPENED by clicking its own trigger after
	 * mount, the way a reader opens one.
	 *
	 * `CanonicalTranscript` deliberately takes no "start open" prop, so the
	 * expansion requirement is evidenced through the affordance a user has
	 * rather than through a state only a story can reach: if the trigger
	 * stopped reaching the body, this frame comes back collapsed.
	 */
	expand?: string | null;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!expand) return;
		/* The capture rig asks whether the story rendered, and a transcript with
		   every row shut answers yes — so it holds the shutter until the state
		   under test is actually in the DOM, exactly as
		   `chat-trace--conversation-reasoning-open` does. */
		document.documentElement.dataset.capturePending = "1";
		containerRef.current
			?.querySelector<HTMLButtonElement>(
				`[data-record-id="${expand}"] button[aria-expanded="false"]`,
			)
			?.click();
		document.documentElement.removeAttribute("data-capture-pending");
	}, [expand]);
	return (
		<div className="overflow-y-auto p-6" style={{ height }} ref={containerRef}>
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				gate={null}
				waiting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				failure={null}
				/*
				 * A read conversation with rows: the notice is what this set is about, not
				 * the read, so the reader's question is answered `true` and the hold cannot
				 * fire (`records` are non-empty in every frame here).
				 */
				hydrated={true}
				onReconnect={() => {}}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Canonical notices",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The statement register must not fall into TraceLine's tool-label fallback.
 * Both detail shapes matter: a clipped static row has no disclosure through
 * which a reader could recover the missing error, while a detailed row must
 * retain the full headline independently of its supporting body.
 */
export const JobResultMessages: Story = {
	render: () => (
		<Frame
			height={720}
			records={[
				...(["failed", "completed"] as const).flatMap((outcome) =>
					[
						null,
						"Supporting job output remains available through this disclosure.",
					].map((detail, index): TranscriptRecord => {
						const headline = `background job 'review-long-result' ${outcome}: ${
							outcome === "failed"
								? "[Errno 28] No space left on device while writing the verification report; free disk space before retrying."
								: "All requested suites passed and the complete verification report is ready for the independent reviewer."
						}`;
						return {
							kind: "custom",
							id: `job-${outcome}-${index}`,
							ts: 1_760_000_000_000,
							customType: "job_result",
							level: "info",
							category: null,
							provider: null,
							headline,
							text: [headline, detail].filter(Boolean).join("\n"),
							attribution: "system",
							detail,
						};
					}),
				),
				{
					kind: "custom",
					id: "job-ordinary",
					text: "The independent reviewer finished checking the complete verification report and found no remaining blockers.",
					attribution: "system",
					ts: 1_760_000_000_000,
					customType: "job_result",
					level: "info",
					category: null,
					provider: null,
					headline:
						"The independent reviewer finished checking the complete verification report and found no remaining blockers.",
					detail: null,
				},
			]}
		/>
	),
};

/**
 * The regression. Every one of these must be readable to its final word --
 * "then send the message again" is the actionable half.
 */
export const ActionableColdStartReasons: Story = {
	render: () => (
		<Frame
			records={REASONS.map((reason, index) =>
				notice(`reason-${index}`, PREFIX + reason, "error"),
			)}
		/>
	),
};

/** The boundary either side of the threshold, plus the cases that already worked. */
export const NoticeLengths: Story = {
	render: () => (
		<Frame
			height={340}
			records={[
				notice("short", "Session resumed.", "info"),
				notice("at-72", `${"x".repeat(64)} ends here`, "warning"),
				notice(
					"just-over",
					`${"y".repeat(70)} and then some more text`,
					"warning",
				),
				notice(
					"multiline",
					"Two lines of notice.\nThe second line must not be swallowed either.",
					"error",
				),
				notice("long", `${"z".repeat(400)} END`, "error"),
			]}
		/>
	),
};

/**
 * Session incidents, and the other harness statements, on their own rows.
 *
 * The operator's report: a turn dies, and the row that explains why reads only
 * `session incident`, in the info ink, with the whole message behind a
 * chevron. 946 of those rows are in his own transcripts, so the shape is the
 * normal case rather than an edge one — an MCP authorization that expired is
 * what most of them are.
 *
 * These rows are built by the PRODUCTION reducer from the persisted payloads
 * themselves (`DesktopHistoryPage["entries"]`, quoted from
 * `~/.local-operator/sessions/…/transcript.jsonl`), so the frame judges what
 * the row is GIVEN as well as what it paints. What to look for:
 *
 * - Every incident is ONE error row: the danger glyph, the category as the
 *   row's label (`mcp`, `cut-off`, `rate-limit`, …) and the vendor's own error
 *   text in place, wrapping rather than truncating.
 * - Two wrapped rows are the wrap case, and they are the widest the producer
 *   writes: the `context-length` one at 217 characters of raw, and the
 *   `rate-limit` one at 296 — the store's maximum `raw` and its maximum
 *   rendered head line (601 characters of `text`). Both must be readable to
 *   their last word, at 1280 and at a narrow column.
 * - The `unknown` row has no suggested action, so its disclosure is short —
 *   the tail sentence alone. A row with nothing behind it is a disabled
 *   trigger with a reserved chevron gutter, not a hole.
 * - The `older row without raw` is the fallback: the message comes from the
 *   head line's remainder when the producer persisted no `raw` (every row in
 *   the store today has one, so this row is constructed; see below).
 * - The three harness STATEMENTS — a model switch, an MCP recovery, a stored
 *   credential — are informational, not errors, and their message is likewise
 *   the row.
 * - The relayed rows are the other direction: a payload is genuinely bulky, so
 *   its body stays behind the disclosure — but the row states the message
 *   rather than the envelope's manners, stepping over the opening tag AND the
 *   fixed instruction line every hub relay carries above its content.
 * - The empty relay states its envelope instead of its closing tag, and the
 *   wake row states its cadence instead of the agent's own cancellation call.
 * - All of them sit on the ledger pitch, so a run of mixed rows does not go
 *   ragged where one appears.
 */
/** The mcp row, whose supporting detail this frame opens. */
const INCIDENT_OPEN = "801c032e12604b478ab44b3bedcbd503";

export const SessionIncidents: Story = {
	render: () => (
		<Frame records={incidentTranscript()} height={800} expand={INCIDENT_OPEN} />
	),
};

/**
 * The same rows in a narrow column, where they wrap hardest.
 *
 * Design round 1's D1 was measured at 420px, which is where a three-line row
 * lost its mark entirely — the chevron and the glyph both sat on line 2, so line
 * 1 carried no kind at all. This is the same transcript at 560, the narrowest
 * width the column is designed around, so the fix is shown where the defect was
 * found rather than only at 1280, where a wrapped row is still the exception.
 */
export const SessionIncidentsNarrow: Story = {
	render: () => <Frame records={incidentTranscript()} height={1220} />,
};

const custom = (
	id: string,
	ts: number,
	custom_type: string,
	details: Record<string, unknown>,
): DesktopHistoryPage["entries"][number] => ({
	id,
	ts,
	type: "message",
	payload: { kind: "custom", custom_type, details },
});

/**
 * Real persisted payloads, one per incident category the classifier can emit.
 *
 * Copied verbatim: the ids are the entries' own, so any row can be found again
 * in the store it came from. The `mcp` and `cut-off` rows are the two the
 * defect report quotes.
 */
const HISTORY: DesktopHistoryPage["entries"] = [
	// 636 of the 946 in the store are `mcp`, and this is the one from the report.
	custom(INCIDENT_OPEN, 1789113543.470046, "session_incident", {
		text: "[session incident (openrouter/deepseek/deepseek-v4.1-flash)] mcp: MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired\nsuggested action: An MCP server is unavailable: its tools are gone until it reconnects. Do not call its tools in a tight loop; say which server is down.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired",
	}),
	custom("5308360d093f48b688d6663a5d939578", 1789100000.1, "session_incident", {
		text: "[session incident (anthropic/claude-opus-5)] mcp: MCP server 'notion': MCP authorization failed; run /mcp login notion to authorize\nsuggested action: An MCP server is unavailable: its tools are gone until it reconnects. Do not call its tools in a tight loop; say which server is down.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "MCP server 'notion': MCP authorization failed; run /mcp login notion to authorize",
	}),
	custom("3c9cd1b5f1e44b24964f00ef4197d40f", 1789100001.1, "session_incident", {
		text: "[session incident (anthropic/claude-opus-5)] auth: MCP server 'notion': MCP authorization failed; notion rejected our credentials (401) — set its API key or headers\nsuggested action: Credentials were rejected: tell the user which provider and suggest `local-operator login <provider>`. Do not retry the identical request.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "MCP server 'notion': MCP authorization failed; notion rejected our credentials (401) — set its API key or headers",
	}),
	custom("de7be977e9dc4363b0c88458185d98b1", 1789100002.1, "session_incident", {
		text: "[session incident (anthropic/claude-opus-5)] rate-limit: transient provider error (HTTP 529): overloaded_error: Overloaded\nsuggested action: Back off and retry later; if it persists, tell the user which provider hit the limit — they may need to switch model or top up quota.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "transient provider error (HTTP 529): overloaded_error: Overloaded",
	}),
	custom("68bab38958084b039c48227942b50d8a", 1789100003.1, "session_incident", {
		text: "[session incident (deepseek/deepseek-flash)] context-length: invalid request: prompt is too large for deepseek-flash: about 995,106 tokens of input against a 1,000,000-token context window leaves under 4,096 tokens for the reply. Compact the conversation or start a new session.\nsuggested action: The request was too large for the model: the harness compacts and drops the oldest screenshots automatically, so retry once; if it repeats, ask the user to /compact or send fewer and smaller images.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "invalid request: prompt is too large for deepseek-flash: about 995,106 tokens of input against a 1,000,000-token context window leaves under 4,096 tokens for the reply. Compact the conversation or start a new session.",
	}),
	// The widest raw the producer writes (296 chars, rendered head 601) and the
	// store's only 601-char head line, so the frame covers the real maximum
	// rather than an understated one.
	custom("078983ad4c7a4261816e92d305b97a09", 1789100003.6, "session_incident", {
		text: "[session incident (anthropic/claude-fable-5-1)] rate-limit: rate limit or quota exceeded: All 5 OAuth sign-in credentials for provider 'anthropic' are not usable right now (rate limited, a token refresh failed, or the stored credential could not be read). The credentials are still configured; retry once the limit resets, or sign in again to replace them.\nsuggested action: Back off and retry later; if it persists, tell the user which provider hit the limit — they may need to switch model or top up quota.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "rate limit or quota exceeded: All 5 OAuth sign-in credentials for provider 'anthropic' are not usable right now (rate limited, a token refresh failed, or the stored credential could not be read). The credentials are still configured; retry once the limit resets, or sign in again to replace them.",
	}),
	custom("fff1d0c0cbcc44c79ceea3903057cad9", 1789100004.1, "session_incident", {
		text: "[session incident (openrouter/qwen/qwen3.8-max)] provider: transient provider error (HTTP 502): provider_unavailable: Network connection lost.\nsuggested action: The provider is failing server-side: a retry may work; if it repeats, suggest switching model or provider.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "transient provider error (HTTP 502): provider_unavailable: Network connection lost.",
	}),
	custom("249dc68e1f8349c7819d343174c5e02f", 1789100005.1, "session_incident", {
		text: "[session incident (anthropic/claude-opus-4-8)] network: provider timeout: ReadTimeout: stream stalled: no data for 180s\nsuggested action: The connection failed mid-stream: retrying is usually right; if it repeats, check connectivity.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "provider timeout: ReadTimeout: stream stalled: no data for 180s",
	}),
	// No suggested action: the classifier had nothing to advise, so the tail
	// sentence is the whole disclosure.
	custom("6abc90638c6a442ea4e10dfa684feb27", 1789100006.1, "session_incident", {
		text: "[session incident (anthropic/claude-opus-5)] unknown: [Errno 28] No space left on device\nThis is why the previous turn ended. Take it into account before repeating the same request.",
		raw: "[Errno 28] No space left on device",
	}),
	// The report's own cut-off row.
	custom(
		"70955f43a35f47b785621c39d779b0e9",
		1789319740.171721,
		"session_incident",
		{
			text: "[session incident] cut-off: the turn was cut off and the cause could not be determined\nsuggested action: The runtime was cut off before this turn produced a result. The transcript holds whatever was written before it stopped and nothing after. Check the state of anything it was mid-way through before repeating the work; do not assume the request completed.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
			raw: "the turn was cut off and the cause could not be determined",
			token: "a25744d5-33eb-4767-a88f-ea182e93ec94",
		},
	),
	/*
	 * CONSTRUCTED, and the only row here that is: the `raw`-less fallback. All
	 * 947 incidents in the store carry a `raw` (the producer has always written
	 * one), so there is no example to copy — this is the same row with the field
	 * removed, which is the shape a row persisted by an older runtime would
	 * have.
	 */
	custom("constructed-no-raw", 1789100007.1, "session_incident", {
		text: "[session incident (anthropic/claude-opus-5)] unknown: provider returned an unclassified error envelope\nThis is why the previous turn ended. Take it into account before repeating the same request.",
	}),
	// The three harness statements. Their text is the formatter's own output.
	custom(
		"a1f8e0b7c3d94a2e8f6b5c4d3e2f1a09",
		1789100008.1,
		"session_model_switch",
		{
			text: "[model switch] You are now running as openrouter/deepseek/deepseek-v4.1-flash (was anthropic/claude-opus-5).\nThis applies from now on. Capabilities, context window, and tone may differ from the previous model; act as the model you now are.",
			new_label: "openrouter/deepseek/deepseek-v4.1-flash",
			previous_label: "anthropic/claude-opus-5",
			transient: false,
		},
	),
	custom("constructed-mcp-recovery", 1789100009.1, "session_mcp_recovery", {
		text: "[mcp recovery] MCP server 'gitlab' is connected again and 12 tools are available again. This supersedes the earlier session incident about this server: its tools are usable now, so call them normally and stop reporting it as unavailable.",
	}),
	custom("constructed-credential", 1789100010.1, "session_credential", {
		text: "[session credential] DEPLOY_KEY was just stored by the operator. Its value is held in session memory and injected as the environment variable $DEPLOY_KEY into every bash command — use it there (a child process reads it), never echo, print, or write it. It is not readable through read_variable.",
		key: "DEPLOY_KEY",
		action: "stored",
		replaced: false,
	}),
	// The control: a relayed payload, which is genuinely bulky.
	custom("110e891fd4004f6faf251d47a64700dd", 1789100011.1, "hub_message", {
		text: "<parent-message>\nThis is a note, not a question. No reply is needed unless it changes what you should do.\n\nCorrection: rebase onto the CURRENT origin/main, not the ref I named. main has moved twice while you worked: origin/main is now `0ae91825c` (v0.54.21, released 09:27). Fetch again, then rebase the branch onto `origin/main` and report the resulting head SHA.\n</parent-message>",
		direction: "to_child",
		expects_reply: false,
	}),
	// An empty relay: 34 real rows in the store are this shape, and the closing
	// tag is not a message.
	custom("daf1c68b41ba4924ad74b85f5f47862a", 1789100012.1, "hub_message", {
		text: "<subagent-message label='rollover-template-fix' job='5fb25794e06c'>\n\n</subagent-message>",
		direction: "to_parent",
		job_id: "5fb25794e06c",
		label: "rollover-template-fix",
		body: "",
	}),
	// A wake prompt: the cadence is the datum, and the arming call addressed to
	// the agent is what the row used to lead with (749 of 951 store rows).
	custom("59ea7ac6d2da40f0bd7b7a80cb039990", 1789100013.1, "wake_prompt", {
		text: '(alarm) Scheduled wake w1 (1/16, every 1h30m) — cancel with wake({op:"cancel",id:"w1"}) once its goal is met.\n\nGPU capacity probe — NER backfill is 12 pods Pending on prod-2.',
		wake_id: "w1",
		occurrence: 1,
	}),
];

/** The rows the production reducer makes of the persisted payloads above. */
function incidentTranscript(): TranscriptRecord[] {
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: HISTORY,
		has_more: false,
		cursor_missing: false,
	}).records;
}
