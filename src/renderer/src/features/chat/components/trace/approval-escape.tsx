/**
 * The approval card's escape hatch: two policy handles under Approve and Deny.
 *
 * ## What this is, and what it is not
 *
 * A pending approval stops the turn. Often the operator can already see that the
 * same tool will ask for every following call, so the card offers the two ways
 * out that do not require answering THIS request: loosen the live gate for the
 * session (`/approvals auto`) or write the default for future sessions
 * (`tool_approval_mode: auto`). Neither path answers the pending request — the
 * card stays fully answerable — and that separation is the whole design. A press
 * on "Set auto" that resolved the card would approve an action the operator has
 * not read; every inline confirmation therefore ends with the fact that this
 * request still needs an answer.
 *
 * ## The two routes are different, and the difference is load-bearing
 *
 * - **This session** runs the owner command `approvals auto` through
 *   `sessions.command`, the same route the `/approvals` picker uses. It is the
 *   only route that moves a LIVE gate; the runtime answers with a `notice`
 *   receipt, and the authority proof for that authority-increasing command is the
 *   server's (issue #1310), not this component's.
 * - **All sessions** writes the typed setting `tool_approval_mode` through
 *   `settings.edit`, then asks THIS conversation to follow it with the same
 *   `approvals auto` command. The settings write alone would only promise
 *   future sessions; the label says all sessions, so the live one is moved too.
 *   It deliberately does NOT send `approvals default auto` through
 *   `sessions.command`: the desktop command bridge answers every
 *   `approvals default …` frame with a `native_action` (see the core's
 *   `server/routes/desktop_sessions.py`), which opens the picker instead of
 *   reaching the runtime, so a press on this handle would appear to succeed and
 *   change nothing. A conversation with its own explicit choice keeps it; the
 *   confirmation says so.
 *
 * ## Which outcome may claim a save
 *
 * A `notice` receipt is the successful mode change; everything else is a
 * refusal and renders `Unchanged: <the backend's detail>`. A `native_action`
 * counts as a refusal here even though it is not an error: it means the server
 * presented a destination instead of running the command, so the mode did not
 * move. The settings route also checks the value it gets back — a resolved edit
 * that reports a value other than `auto` must not be painted as saved.
 *
 * THE ALL-SESSIONS ARM HAS A PARTIAL STATE, and it may not be folded into
 * either neighbour. The default is written first; the live command is second.
 * If the second is refused, the default IS saved and this conversation's mode
 * still asks — so the line states both facts, names the backend's detail for
 * the part that did not apply, and never claims the conversation was changed.
 *
 * ## Layout and copy
 *
 * The handles are text buttons at `ink-muted` (hover steps to `ink` and
 * underlines), below the Approve/Deny band and never above it, so the two
 * controls the card exists for keep their position. `min-h-11` is the 44px hit
 * target; `flex-wrap` lets the pair take two lines rather than truncating a
 * destination. The status line is an `<output>` (implicit `role="status"`) whose
 * slot reserves `2lh` — two line boxes at the card's own text size — so the
 * idle, session-saved, refused and short-partial states occupy the same box and
 * none of them moves the hint when it lands (design round 1, D1: a `min-h-5`
 * one-line floor let the first two-line refusal grow the card by 14.8px at
 * 300px). A dictated sentence longer than two lines grows the slot rather than
 * clipping; there is no truncation.
 *
 * ## The policy line
 *
 * Above the handles sits one quiet line naming the session's effective mode and
 * where it came from — `Approvals: Ask — global default.`, `Approvals: Ask —
 * session override; global Auto.`, `Approvals: Auto — this run.` It is read from
 * the gate's additively carried `approval_mode` / `approval_provenance` (and
 * `approval_global_mode` when a session override differs from the default) and
 * is OMITTED when an older backend sends neither, never inferred from the
 * pending request: a request can remain answerable after the policy changed, so
 * a request-derived provenance would be a claim about the wrong moment
 * (design round 1, D2).
 *
 * THE COPY IS LITERAL ON PURPOSE, following the rest of this surface: the chat
 * trace card is not localized yet, and a new English-only key cannot pass the
 * manifest-backed coverage gate — every supported locale must carry every
 * English key, so new copy either ships translated in all seven or reds
 * `pnpm check-i18n` by construction. These strings live in one object so the
 * i18n wave can extract them without touching the layout.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { cn } from "@shared/lib/utils";
import { useCallback, useId, useRef, useState } from "react";
import type { CommandRun } from "../../pickers/use-picker-backend";
import { errorText, useSessionCommand } from "../../pickers/use-picker-backend";

/** Which gate the press loosens: the live one, or the saved default. */
export type ApprovalEscapeTarget = "session" | "all";

/**
 * The effective approval modes the policy line can name. `""` is the core's
 * "not stated" stamp (an ask card, an older runtime, or a payload whose
 * publisher could not read the policy) and is treated exactly like absence.
 */
export type ApprovalEscapeMode = "ask" | "auto" | "";
/** Where the effective mode came from; `""` is not stated, like the mode. */
export type ApprovalEscapeProvenance = "global" | "session" | "pin" | "";

/**
 * The card's effective-mode line, or `null` when the backend did not carry the
 * effective policy. Pure so the test can pin every provenance arm without a
 * render, and so the connected half has no formatting of its own.
 */
export const approvalPolicyLine = ({
	mode,
	provenance,
	globalMode,
}: {
	mode?: ApprovalEscapeMode;
	provenance?: ApprovalEscapeProvenance;
	globalMode?: ApprovalEscapeMode;
}): string | null => {
	if (!mode || !provenance) return null;
	const word = mode === "auto" ? "Auto" : "Ask";
	switch (provenance) {
		case "pin":
			return APPROVAL_ESCAPE_COPY.pinnedRun(word);
		case "session":
			return globalMode
				? APPROVAL_ESCAPE_COPY.sessionOverrideOf(
						word,
						globalMode === "auto" ? "Auto" : "Ask",
					)
				: APPROVAL_ESCAPE_COPY.sessionOverride(word);
		case "global":
			return APPROVAL_ESCAPE_COPY.globalDefault(word);
		default:
			return null;
	}
};

/** What a press left on the card. `idle` is the reserved, empty slot. */
export type ApprovalEscapeStatus =
	| { kind: "idle" }
	| { kind: "session-saved" }
	| { kind: "default-saved" }
	| { kind: "default-saved-session-failed"; detail: string }
	| { kind: "refused"; detail: string };

/** The two doors a press can use; a test substitutes both. */
export type ApprovalEscapePorts = {
	runCommand: (command: string, args: string) => Promise<CommandRun>;
	editDefault: (value: string) => Promise<{ key: string; value: unknown }>;
};

/**
 * What one press achieved. `default-only` is the half-succeeded all-sessions
 * arm: the saved default moved, the live conversation's command did not.
 */
export type ApprovalEscapeOutcome =
	| { kind: "saved" }
	| { kind: "default-only"; detail: string }
	| { kind: "unchanged"; detail: string };

/**
 * `serving.py:_approvals_slash`'s no-gates branch answers with a NOTICE whose
 * text begins here. The handle did not own the gate tools consult, so nothing
 * moved; a `notice` alone is therefore not proof of a mode change.
 */
const NO_GATE_NOTICE = "exec uses its original headless approval gate";

/** Run `approvals auto` against the live gate and classify the receipt. */
async function loosenLiveGate(
	ports: ApprovalEscapePorts,
): Promise<{ ok: true } | { ok: false; detail: string }> {
	try {
		const run = await ports.runCommand("approvals", "auto");
		const reported =
			run.outcome && "text" in run.outcome ? run.outcome.text : run.result.text;
		const text = reported.trim() || run.result.text;
		/*
		 * A `notice` is NORMALLY the runtime's mode-change receipt, but one
		 * notice is not: a handle with no gates installed reports "exec uses its
		 * original headless approval gate…" (the branch above). That sentence
		 * says the live gate did not move, so it is a refusal here and its text
		 * is the detail. The runtime's structured `data.ok`, when it is present,
		 * is the same fact in machine form; an older receipt omits it and the
		 * sentence remains the fallback.
		 *
		 * A `native_action` is the bridge presenting the picker and a `block` is
		 * anything the owner chose to report without changing the mode; both are
		 * refusals for the same reason.
		 */
		const receiptOk =
			run.outcome && "data" in run.outcome ? run.outcome.data?.ok : undefined;
		if (
			run.outcome?.kind === "notice" &&
			receiptOk !== false &&
			!text.startsWith(NO_GATE_NOTICE)
		) {
			return { ok: true };
		}
		return { ok: false, detail: dropOurFailurePrefix(text) };
	} catch (error) {
		return { ok: false, detail: errorText(error) };
	}
}

/**
 * Run one policy change and classify the outcome. Pure over its ports so the
 * test can assert the exact command, the exact setting and every refusal arm
 * without a backend or a DOM.
 *
 * THE ALL-SESSIONS ARM IS TWO CALLS, IN THIS ORDER. The default is written
 * first because it is the durable half; the live conversation is then asked to
 * follow it, which is what makes the handle's name true rather than only a
 * promise about future sessions. If the second call fails the first is NOT
 * rolled back — the default is a real save — so the outcome says exactly that
 * instead of reporting a whole success or a whole refusal.
 */
export async function runApprovalEscape(
	target: ApprovalEscapeTarget,
	ports: ApprovalEscapePorts,
): Promise<ApprovalEscapeOutcome> {
	if (target === "session") {
		const live = await loosenLiveGate(ports);
		return live.ok
			? { kind: "saved" }
			: { kind: "unchanged", detail: live.detail };
	}
	try {
		const saved = await ports.editDefault("auto");
		/*
		 * NEVER CLAIM A SAVE THE BACKEND DID NOT REPORT. The route resolves with
		 * the stored row; a value other than `auto` is the fact that this press
		 * did not take, and painting it as saved would be the one lie this
		 * component exists to avoid.
		 */
		if (saved.value !== "auto") {
			return { kind: "unchanged", detail: String(saved.value) };
		}
	} catch (error) {
		return { kind: "unchanged", detail: errorText(error) };
	}
	const live = await loosenLiveGate(ports);
	return live.ok
		? { kind: "saved" }
		: { kind: "default-only", detail: live.detail };
}

/**
 * The copy in one place. See the file docblock for why these are literal
 * rather than `t()` keys.
 */
export const APPROVAL_ESCAPE_COPY = {
	setSession: "Set auto for this session",
	setAll: "Set auto for all sessions",
	sessionSaved: "Auto for this session — this request still needs an answer.",
	defaultSaved:
		"Auto set for this conversation; saved as the default for sessions that follow it. Conversations with their own choice keep it. This request still needs an answer.",
	/**
	 * The half-succeeded all-sessions arm: the default is saved, the live
	 * conversation's command was refused. It names both facts so the reader can
	 * see what did and did not change.
	 */
	defaultSavedSessionFailed: (detail: string) =>
		`Auto saved as the default for sessions that follow it. The session part did not apply: ${detail}. This request still needs an answer.`,
	unchanged: (detail: string) => `Unchanged: ${detail}`,
	/** The prefix a transport failure carries, since no backend detail exists. */
	notChanged: "The mode was not changed",
	/** The effective-policy line; see `approvalPolicyLine`. */
	globalDefault: (mode: string) => `Approvals: ${mode} — global default.`,
	sessionOverride: (mode: string) => `Approvals: ${mode} — session override.`,
	sessionOverrideOf: (mode: string, globalMode: string) =>
		`Approvals: ${mode} — session override; global ${globalMode}.`,
	pinnedRun: (mode: string) => `Approvals: ${mode} — this run.`,
};

/**
 * The words `useSessionCommand.run` puts in front of a call that never reached
 * the owner. The status copy adds `Unchanged: ` itself, so that prefix is
 * removed rather than nested; the transport's own detail survives intact.
 */
const FAILURE_PREFIX = `${APPROVAL_ESCAPE_COPY.notChanged}: `;

const dropOurFailurePrefix = (text: string): string =>
	text.startsWith(FAILURE_PREFIX) ? text.slice(FAILURE_PREFIX.length) : text;

const ESCAPE_LINK =
	"inline-flex min-h-11 items-center rounded-sm text-meta text-ink-muted underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-disabled disabled:no-underline";

const statusText = (status: ApprovalEscapeStatus): string => {
	switch (status.kind) {
		case "session-saved":
			return APPROVAL_ESCAPE_COPY.sessionSaved;
		case "default-saved":
			return APPROVAL_ESCAPE_COPY.defaultSaved;
		case "default-saved-session-failed":
			return APPROVAL_ESCAPE_COPY.defaultSavedSessionFailed(status.detail);
		case "refused":
			return APPROVAL_ESCAPE_COPY.unchanged(status.detail);
		default:
			return "";
	}
};

/**
 * The presentational half: two handles and the reserved status line. Exported
 * so stories and the focused test can render every state (including a refusal)
 * without a backend.
 */
export const ApprovalEscapeControls = ({
	busy = false,
	status = { kind: "idle" },
	policyLine = null,
	onSetSession,
	onSetAll,
	className,
}: {
	busy?: boolean;
	status?: ApprovalEscapeStatus;
	/** The effective-mode line; absent on a backend that does not carry it. */
	policyLine?: string | null;
	onSetSession: () => void;
	onSetAll: () => void;
	className?: string;
}) => {
	const statusId = useId();
	return (
		<div
			className={cn("flex flex-col gap-1", className)}
			data-approval-escape=""
		>
			{policyLine ? (
				<p data-approval-policy-line="" className="text-ink-muted text-meta">
					{policyLine}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-x-4">
				<button
					type="button"
					data-approval-escape-session=""
					disabled={busy}
					aria-describedby={statusId}
					onClick={onSetSession}
					className={ESCAPE_LINK}
				>
					{APPROVAL_ESCAPE_COPY.setSession}
				</button>
				<button
					type="button"
					data-approval-escape-all=""
					disabled={busy}
					aria-describedby={statusId}
					onClick={onSetAll}
					className={ESCAPE_LINK}
				>
					{APPROVAL_ESCAPE_COPY.setAll}
				</button>
			</div>
			{/*
			 * A reserved slot rather than a line that appears: a confirmation that
			 * pushes the hint down moves two rows the reader was aiming at, and a
			 * refusal that does the same on a slow round trip reads as a layout
			 * fault. `<output>` carries the status role, so the change is announced
			 * once without stealing focus.
			 */}
			<output
				id={statusId}
				data-approval-escape-status=""
				className={cn(
					"block min-h-[2lh] text-meta",
					status.kind === "refused" ||
						status.kind === "default-saved-session-failed"
						? "text-danger"
						: "text-ink-muted",
				)}
			>
				{statusText(status)}
			</output>
		</div>
	);
};

/**
 * The connected half: owns the command hook and the status, so the dock's own
 * file and `chat-content.tsx` change by one prop.
 */
export const ApprovalEscape = ({
	sessionId,
	approvalMode,
	approvalProvenance,
	approvalGlobalMode,
	className,
}: {
	/**
	 * The session whose live gate a press loosens. Required: a card with no
	 * session id has no gate to address, and the dock omits the row there.
	 */
	sessionId: string;
	/** The gate's effective mode/provenance; absent on an older backend. */
	approvalMode?: ApprovalEscapeMode;
	approvalProvenance?: ApprovalEscapeProvenance;
	approvalGlobalMode?: ApprovalEscapeMode;
	className?: string;
}) => {
	const command = useSessionCommand(sessionId);
	const [target, setTarget] = useState<ApprovalEscapeTarget | null>(null);
	const [status, setStatus] = useState<ApprovalEscapeStatus>({ kind: "idle" });
	/*
	 * The one-press lock, held as a ref rather than read from `target`: two
	 * presses in the same tick would both see the pre-render state and send two
	 * policy calls, and the second could land after the first's confirmation.
	 */
	const inFlight = useRef(false);

	const editDefault = useCallback(
		(value: string) =>
			desktopResult<{ key: string; value: unknown }>({
				op: "settings.edit",
				key: "tool_approval_mode",
				value,
			}),
		[],
	);

	const choose = useCallback(
		async (which: ApprovalEscapeTarget) => {
			if (inFlight.current) return;
			inFlight.current = true;
			setTarget(which);
			try {
				const outcome = await runApprovalEscape(which, {
					/*
					 * The caller's own words for a call that never reached the
					 * owner: this press is not a slash command, so naming
					 * `/approvals` would send the reader to a surface they never
					 * used.
					 */
					runCommand: (name, args) =>
						command.run(name, args, APPROVAL_ESCAPE_COPY.notChanged),
					editDefault,
				});
				setStatus(
					outcome.kind === "saved"
						? which === "session"
							? { kind: "session-saved" }
							: { kind: "default-saved" }
						: outcome.kind === "default-only"
							? {
									kind: "default-saved-session-failed",
									detail: outcome.detail,
								}
							: { kind: "refused", detail: outcome.detail },
				);
			} finally {
				inFlight.current = false;
				setTarget(null);
			}
		},
		[command, editDefault],
	);

	return (
		<ApprovalEscapeControls
			policyLine={approvalPolicyLine({
				mode: approvalMode,
				provenance: approvalProvenance,
				globalMode: approvalGlobalMode,
			})}
			busy={target !== null}
			status={status}
			onSetSession={() => void choose("session")}
			onSetAll={() => void choose("all")}
			className={className}
		/>
	);
};
