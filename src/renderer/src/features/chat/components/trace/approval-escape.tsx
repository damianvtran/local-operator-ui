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
 * THE COPY IS KEYED (`ui.chat.approval.escape.*`), resolved at CALL time through
 * `APPROVAL_ESCAPE_COPY`'s functions so a language switch re-words a card that is
 * already on screen. It used to be literal on purpose, because a new English-only
 * key cannot pass the manifest-backed coverage gate; the keying slice therefore
 * lands together with its translations. The mode words (`Auto`/`Ask`) are copy
 * too, but the mode VALUES (`auto`/`ask`) that travel to the runtime are not.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Check } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CommandRun } from "../../pickers/use-picker-backend";
import { errorText, useSessionCommand } from "../../pickers/use-picker-backend";
import {
	invalidateApprovalMode,
	useApprovalMode,
} from "../../session-status/approval-mode";

/** Which gate the press loosens: the live one, or the saved default. */
/**
 * `ask` is the way BACK (operator request, 2026-11-24, from Ryan Copp's
 * feedback): a one-click loosening the operator cannot undo with one click is
 * not reversible in any sense they can use, so once this session is on auto the
 * card offers "Always ask", which sends `approvals ask` through the same owner
 * route. `ask` is the runtime's canonical token (`serving.py:_approvals_slash`
 * accepts `ask`/`on`/`prompt`; `desktop_catalogues.py` lists `auto`/`ask`).
 *
 * `all-ask` is the all-sessions arm's mirror, added for the composer's approvals
 * picker (operator request 2026-11-25: "set for this session, all sessions"):
 * a picker that can make Auto the default but not Ask would be the same
 * one-way door the card's "Always ask" exists to close. It follows the `all`
 * arm exactly - default first, then this conversation - with the same partial
 * state when only the first half lands. The card itself never sends it.
 */
export type ApprovalEscapeTarget = "session" | "all" | "ask" | "all-ask";

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
	const word = modeWord(mode);
	switch (provenance) {
		case "pin":
			return APPROVAL_ESCAPE_COPY.pinnedRun(word);
		case "session":
			return globalMode
				? APPROVAL_ESCAPE_COPY.sessionOverrideOf(word, modeWord(globalMode))
				: APPROVAL_ESCAPE_COPY.sessionOverride(word);
		case "global":
			return APPROVAL_ESCAPE_COPY.globalDefault(word);
		default:
			return null;
	}
};

/**
 * The policy the card states once a press has SAVED something (design round 1,
 * D4): the mode/provenance pair the outcome established, over the gate's own.
 *
 * WHY. `approvalMode`/`approvalProvenance` come from the pending gate
 * (`question-dock.tsx`, `gate.approval_mode`), which describes the policy when
 * the request was RAISED; nothing in this tree re-reads it after a press, so the
 * frames kept "Approvals: Ask — global default." above "✓ Auto is now the
 * default". The press's own outcome is the fresher fact: a session save makes
 * this session auto by its own choice; a default save moves the global mode
 * (and, when both landed, the session too). A refusal changes nothing.
 */
export function policyAfterSave(
	status: ApprovalEscapeStatus,
	gate: {
		mode?: ApprovalEscapeMode;
		provenance?: ApprovalEscapeProvenance;
		globalMode?: ApprovalEscapeMode;
	},
): {
	mode?: ApprovalEscapeMode;
	provenance?: ApprovalEscapeProvenance;
	globalMode?: ApprovalEscapeMode;
} {
	switch (status.kind) {
		case "session-saved":
			return { ...gate, mode: "auto", provenance: "session" };
		case "default-saved":
			return { mode: "auto", provenance: "session", globalMode: "auto" };
		case "default-saved-session-failed":
			// The session part did not apply: only the default is known to have moved.
			return { ...gate, globalMode: "auto" };
		case "ask-saved":
			// The session made its own choice again, this time to ask.
			return { ...gate, mode: "ask", provenance: "session" };
		default:
			return gate;
	}
}

/** What a press left on the card. `idle` is the reserved, empty slot. */
export type ApprovalEscapeStatus =
	| { kind: "idle" }
	| { kind: "session-saved" }
	| { kind: "default-saved" }
	| { kind: "default-saved-session-failed"; detail: string }
	/** `approvals ask` landed: this session asks again before every tool. */
	| { kind: "ask-saved" }
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

/**
 * Run `approvals <mode>` against the live gate and classify the receipt. The
 * tightening direction (`ask`) reads its receipt by the same rule: a notice is
 * the mode change, anything else is a refusal whose text is the detail.
 */
async function setLiveGate(
	ports: ApprovalEscapePorts,
	mode: "auto" | "ask" = "auto",
): Promise<{ ok: true } | { ok: false; detail: string }> {
	try {
		const run = await ports.runCommand("approvals", mode);
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
	if (target === "session" || target === "ask") {
		const live = await setLiveGate(ports, target === "ask" ? "ask" : "auto");
		return live.ok
			? { kind: "saved" }
			: { kind: "unchanged", detail: live.detail };
	}
	const mode = target === "all-ask" ? "ask" : "auto";
	try {
		const saved = await ports.editDefault(mode);
		/*
		 * NEVER CLAIM A SAVE THE BACKEND DID NOT REPORT. The route resolves with
		 * the stored row; a value other than the one asked for is the fact that
		 * this press did not take, and painting it as saved would be the one lie
		 * this component exists to avoid.
		 */
		if (saved.value !== mode) {
			return { kind: "unchanged", detail: String(saved.value) };
		}
	} catch (error) {
		return { kind: "unchanged", detail: errorText(error) };
	}
	const live = await setLiveGate(ports, mode);
	return live.ok
		? { kind: "saved" }
		: { kind: "default-only", detail: live.detail };
}

/**
 * The copy in one place. See the file docblock for why these are literal
 * rather than `t()` keys.
 */
export const APPROVAL_ESCAPE_COPY = {
	setSession: () => t("ui.chat.approval.escape.set_session"),
	setAll: () => t("ui.chat.approval.escape.set_all"),
	alwaysAsk: () => t("ui.chat.approval.escape.always_ask"),
	alwaysAskScope: () => t("ui.chat.approval.escape.always_ask_scope"),
	askSaved: () => t("ui.chat.approval.escape.ask_saved"),
	/**
	 * What auto does NOT switch off. The operator's condition for the one-click
	 * switch was that the copy says guardrails still bind: auto skips the
	 * approval prompt only, while guardrail refusals and the dangerous-delete
	 * review are separate gates the runtime keeps applying in auto mode.
	 */
	guardrailsNote: () => t("ui.chat.approval.escape.guardrails_note"),
	sessionSaved: () => t("ui.chat.approval.escape.session_saved"),
	defaultSaved: () => t("ui.chat.approval.escape.default_saved"),
	/**
	 * The half-succeeded all-sessions arm: the default is saved, the live
	 * conversation's command was refused. It names both facts so the reader can
	 * see what did and did not change.
	 */
	defaultSavedSessionFailed: (detail: string) =>
		t("ui.chat.approval.escape.default_saved_session_failed", { detail }),
	unchanged: (detail: string) =>
		t("ui.chat.approval.escape.unchanged", { detail }),
	/** The prefix a transport failure carries, since no backend detail exists. */
	notChanged: () => t("ui.chat.approval.escape.not_changed"),
	/** The effective-policy line; see `approvalPolicyLine`. */
	globalDefault: (mode: string) =>
		t("ui.chat.approval.escape.global_default", { mode }),
	sessionOverride: (mode: string) =>
		t("ui.chat.approval.escape.session_override", { mode }),
	sessionOverrideOf: (mode: string, globalMode: string) =>
		t("ui.chat.approval.escape.session_override_of", {
			mode,
			globalMode,
		}),
	pinnedRun: (mode: string) =>
		t("ui.chat.approval.escape.pinned_run", { mode }),
	/** What stands where the two handles would be on a bridge-latched card. */
	bridgeLatched: () => t("ui.chat.approval.escape.bridge_latched"),
};

/** The localized word for an approval mode value (the value itself is protocol). */
const modeWord = (mode: string | undefined): string =>
	mode === "auto"
		? t("ui.chat.approval.mode.auto")
		: t("ui.chat.approval.mode.ask");

/**
 * The words `useSessionCommand.run` puts in front of a call that never reached
 * the owner. The status copy adds `Unchanged: ` itself, so that prefix is
 * removed rather than nested; the transport's own detail survives intact.
 */
const dropOurFailurePrefix = (text: string): string => {
	// Built per call: the prefix is the localized sentence `run` was handed, so a
	// module-level constant would pin it to the language at load time.
	const prefix = `${APPROVAL_ESCAPE_COPY.notChanged()}: `;
	return text.startsWith(prefix) ? text.slice(prefix.length) : text;
};

/**
 * Whether the backend says this card may not be loosened from here.
 *
 * Either flag counts, and neither is derived from the title or the detail:
 * `bridge_latched` is the host's stamp that the conversation holds Team Bridge
 * (teammate-agent) content, and `approval_suspended: "bridge"` says a session
 * auto granted BEFORE that content arrived stopped covering calls. In both the
 * backend refuses `approvals auto` from this surface (`approval_reason:
 * "bridge_latched"`; the desktop command carries no `bridge_ack`), so a handle
 * that offers it can only fail. Absent or false flags - an older backend, an
 * unlatched conversation - read as not latched, which is today's behaviour.
 */
export const approvalGateIsBridgeLatched = (gate: {
	bridge_latched?: boolean;
	approval_suspended?: string;
}): boolean =>
	gate.bridge_latched === true || gate.approval_suspended === "bridge";

/**
 * The one line that stands where the two handles would be on a latched card.
 *
 * It carries no control and writes nothing: the refusal it explains is the
 * backend's deliberate rule (a teammate's message must not be able to authorise
 * anything), and the only deliberate loosening is the typed `/approvals auto`
 * in the terminal, which this surface cannot send. Approve and Deny are
 * untouched and stay the way to answer this request.
 */
export const ApprovalLatchedNote = ({ className }: { className?: string }) => {
	useI18nLocale();
	return (
		<p
			data-approval-latched-note=""
			className={cn("text-ink-muted text-meta", className)}
		>
			{APPROVAL_ESCAPE_COPY.bridgeLatched()}
		</p>
	);
};

const ESCAPE_LINK =
	"inline-flex min-h-11 items-center rounded-sm text-meta text-ink-muted underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-disabled disabled:no-underline";

/*
 * A handle whose state already holds: warning ink (design round 1, D3 - the
 * composer chip marks Auto amber, and "auto is on" is one fact with one tone;
 * amber also matches the guardrail note's "this loosens a check"), no underline, and the
 * not-allowed cursor dropped - the press is not refused, it is finished. The
 * `disabled:` variants of ESCAPE_LINK would otherwise paint it as unavailable.
 */
const DONE_HANDLE =
	"disabled:cursor-default disabled:text-warning hover:no-underline";

/*
 * The handle whose press is in flight (design round 1, D1): its label IS the
 * press's status, so it keeps muted body ink instead of the disabled palette
 * (measured 2.30:1), and is refused by `aria-disabled` and the press guard.
 */
const PENDING_HANDLE = "cursor-progress text-ink-muted hover:no-underline";

/**
 * Bring `element` into view inside its OWN nearest scrolling ancestor only
 * (agent review round 1, N4). `scrollIntoView({block:"nearest"})` also scrolls
 * every outer ancestor, which moved the transcript under the reader when the
 * dock's secondary region was already in view of it.
 */
export function revealInOwnScroller(element: HTMLElement): void {
	let scroller = element.parentElement;
	while (scroller) {
		const { overflowY } = getComputedStyle(scroller);
		if (
			(overflowY === "auto" || overflowY === "scroll") &&
			scroller.scrollHeight > scroller.clientHeight
		)
			break;
		scroller = scroller.parentElement;
	}
	if (!scroller) return;
	const box = element.getBoundingClientRect();
	const frame = scroller.getBoundingClientRect();
	if (box.bottom > frame.bottom)
		scroller.scrollTop += box.bottom - frame.bottom;
	else if (box.top < frame.top) scroller.scrollTop -= frame.top - box.top;
}

const statusText = (status: ApprovalEscapeStatus): string => {
	switch (status.kind) {
		case "session-saved":
			return APPROVAL_ESCAPE_COPY.sessionSaved();
		case "default-saved":
			return APPROVAL_ESCAPE_COPY.defaultSaved();
		case "default-saved-session-failed":
			return APPROVAL_ESCAPE_COPY.defaultSavedSessionFailed(status.detail);
		case "ask-saved":
			return APPROVAL_ESCAPE_COPY.askSaved();
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
/**
 * What each handle reads as, given the press in flight and the last outcome.
 *
 * WHY THE HANDLE ITSELF CHANGES (D9, onboarding-friction 2026-11): PostHog
 * recorded 41 external users pressing "Set auto for all sessions" and 10 of
 * them rage-clicking it. The confirmation existed, but only in the status
 * `<output>` BELOW the handles, and on the dock these handles live in
 * `AskSecondary`, the region that gives way first (`shrink-[999]`): at the
 * dock's usual heights the status line sat under the fold of that region, so
 * the press changed nothing the user could see and the handle still offered
 * the same press. The control that was pressed is the one place the reader is
 * guaranteed to be looking, so it now carries the in-flight word and the
 * result; the status line keeps the full sentence (and is scrolled into view).
 *
 * Pure, so the focused test pins every arm without a DOM.
 */
export function approvalEscapeHandleState(
	which: ApprovalEscapeTarget,
	pending: ApprovalEscapeTarget | null,
	status: ApprovalEscapeStatus,
): "idle" | "pending" | "done" {
	if (pending === which) return "pending";
	/*
	 * "All sessions" covers this session too: once the default AND the live
	 * gate moved, both handles describe a state that already holds, so neither
	 * offers a press that would do nothing. A default-only save did not move the
	 * session, so the session handle stays pressable there.
	 */
	// "Always ask" is never a finished state: it stays pressable while shown.
	if (which === "ask") return "idle";
	if (status.kind === "default-saved") return "done";
	if (status.kind === "session-saved" && which === "session") return "done";
	if (status.kind === "default-saved-session-failed" && which === "all")
		return "done";
	return "idle";
}

const handleLabel = (
	which: ApprovalEscapeTarget,
	state: "idle" | "pending" | "done",
): string => {
	if (which === "ask") return APPROVAL_ESCAPE_COPY.alwaysAsk();
	if (state === "pending") return t("ui.recovery.approval.setting_auto");
	if (state === "done")
		return which === "all"
			? /*
				 * What the all-sessions press actually changed (design round 1, D4): the
				 * DEFAULT, which sessions with their own choice do not follow - "Auto is
				 * on for all sessions" said more than the sentence under it.
				 */
				t("ui.recovery.approval.default_done")
			: t("ui.recovery.approval.session_done");
	return which === "all"
		? APPROVAL_ESCAPE_COPY.setAll()
		: APPROVAL_ESCAPE_COPY.setSession();
};

export const ApprovalEscapeControls = ({
	busy = false,
	pending = null,
	status = { kind: "idle" },
	policyLine = null,
	onSetSession,
	onSetAll,
	onAlwaysAsk,
	showAlwaysAsk = false,
	compactIdle = false,
	className,
}: {
	/**
	 * Offer "Always ask" — only while this session is known to be on auto, so the
	 * idle card keeps its two handles and the way back appears exactly when there
	 * is something to go back from.
	 */
	showAlwaysAsk?: boolean;
	onAlwaysAsk?: () => void;
	busy?: boolean;
	status?: ApprovalEscapeStatus;
	/**
	 * Drop the status slot's `2lh` reserve while nothing is in flight and no
	 * result is showing. For a host with no height to spare - the bounded inline
	 * dock, where the idle reserve was most of the 56 blank pixel rows design D1
	 * measured under the policy links at 1024x600. The cost is the one the reserve exists to avoid (the
	 * hint below moves when a result lands), accepted there because a press is
	 * rare and a hidden question is not.
	 */
	compactIdle?: boolean;
	/**
	 * Which handle's press is in flight, so THAT handle says so (D9). `busy`
	 * alone disabled both handles with no word changing, which on a fast round
	 * trip read as a press that did nothing.
	 */
	pending?: ApprovalEscapeTarget | null;
	/** The effective-mode line; absent on a backend that does not carry it. */
	policyLine?: string | null;
	onSetSession: () => void;
	onSetAll: () => void;
	className?: string;
}) => {
	useI18nLocale();
	const statusId = useId();
	const statusRef = useRef<HTMLOutputElement>(null);
	/*
	 * A RESULT IS BROUGHT INTO VIEW. The dock's secondary region scrolls under a
	 * fade when it is squeezed, and the status line is its last row - exactly the
	 * row that was clipped when users rage-clicked (D9). `nearest` moves nothing
	 * when the line is already visible. Guarded because jsdom has no layout.
	 */
	useEffect(() => {
		if (status.kind === "idle") return;
		const line = statusRef.current;
		if (line) revealInOwnScroller(line);
	}, [status]);
	const sessionState = approvalEscapeHandleState("session", pending, status);
	const allState = approvalEscapeHandleState("all", pending, status);
	const askState = approvalEscapeHandleState("ask", pending, status);
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
					data-state={sessionState}
					disabled={
						sessionState === "done" || (busy && sessionState !== "pending")
					}
					aria-disabled={sessionState === "pending" || undefined}
					aria-busy={sessionState === "pending" || undefined}
					aria-describedby={statusId}
					onClick={() => {
						if (!busy) onSetSession();
					}}
					className={cn(
						ESCAPE_LINK,
						sessionState === "done" && DONE_HANDLE,
						sessionState === "pending" && PENDING_HANDLE,
					)}
				>
					{sessionState === "done" ? (
						<Check aria-hidden="true" className="me-1 size-3.5 shrink-0" />
					) : null}
					{handleLabel("session", sessionState)}
				</button>
				<button
					type="button"
					data-approval-escape-all=""
					data-state={allState}
					disabled={allState === "done" || (busy && allState !== "pending")}
					aria-disabled={allState === "pending" || undefined}
					aria-busy={allState === "pending" || undefined}
					aria-describedby={statusId}
					onClick={() => {
						if (!busy) onSetAll();
					}}
					className={cn(
						ESCAPE_LINK,
						allState === "done" && DONE_HANDLE,
						allState === "pending" && PENDING_HANDLE,
					)}
				>
					{allState === "done" ? (
						<Check aria-hidden="true" className="me-1 size-3.5 shrink-0" />
					) : null}
					{handleLabel("all", allState)}
				</button>
				{showAlwaysAsk && onAlwaysAsk ? (
					<button
						type="button"
						data-approval-escape-ask=""
						data-state={askState}
						disabled={busy && askState !== "pending"}
						// The handle sits beside "all sessions" but moves only this one
						// (design round 1, D5); the label is the operator's own wording.
						title={APPROVAL_ESCAPE_COPY.alwaysAskScope()}
						aria-disabled={askState === "pending" || undefined}
						aria-busy={askState === "pending" || undefined}
						aria-describedby={statusId}
						onClick={() => {
							if (!busy) onAlwaysAsk();
						}}
						className={cn(
							ESCAPE_LINK,
							askState === "pending" && PENDING_HANDLE,
						)}
					>
						{handleLabel("ask", askState)}
					</button>
				) : null}
			</div>
			<p data-approval-guardrails-note="" className="text-ink-muted text-meta">
				{APPROVAL_ESCAPE_COPY.guardrailsNote()}
			</p>
			{/*
			 * A reserved slot rather than a line that appears: a confirmation that
			 * pushes the hint down moves two rows the reader was aiming at, and a
			 * refusal that does the same on a slow round trip reads as a layout
			 * fault. `<output>` carries the status role, so the change is announced
			 * once without stealing focus.
			 */}
			<output
				ref={statusRef}
				id={statusId}
				data-approval-escape-status=""
				className={cn(
					"block text-meta",
					compactIdle && !busy && status.kind === "idle" ? null : "min-h-[2lh]",
					status.kind === "refused" ||
						status.kind === "default-saved-session-failed"
						? "text-danger"
						: "text-ink-muted",
				)}
			>
				{statusText(status)}
				{/*
				 * THE NEXT STEP, NAMED (UX round 1, U5): every D9 replay ended with the
				 * user finding Approve 4-14 s after the receipt landed. Setting auto
				 * does not answer the request in front of them, so the line says what
				 * does, in full ink so it reads as the instruction.
				 */}
				{status.kind === "session-saved" ||
				status.kind === "default-saved" ||
				status.kind === "default-saved-session-failed" ? (
					<span data-approval-escape-next="" className="text-ink">
						{" "}
						{t("ui.recovery.approval.answer_hint")}
					</span>
				) : null}
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
	compactIdle = false,
	className,
}: {
	/** See `ApprovalEscapeControls.compactIdle`. */
	compactIdle?: boolean;
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
	useI18nLocale();
	const command = useSessionCommand(sessionId);
	const { client } = useOptionalQueryClient();
	const [target, setTarget] = useState<ApprovalEscapeTarget | null>(null);
	const [status, setStatus] = useState<ApprovalEscapeStatus>({ kind: "idle" });
	/*
	 * The one-press lock, held as a ref rather than read from `target`: two
	 * presses in the same tick would both see the pre-render state and send two
	 * policy calls, and the second could land after the first's confirmation.
	 */
	const inFlight = useRef(false);
	/*
	 * THE LIVE MODE, SHARED WITH THE CHIP (design round 1, D1 / QA Q1). The gate's
	 * `approval_mode` describes the policy when the request was RAISED; a chip
	 * press or a typed `/approvals` while the card stays mounted left it saying
	 * "Ask - session override" beside a chip saying Auto, offering the loosening
	 * that already held and hiding the way back. Every approvals route
	 * invalidates this one query, so the card reads it too. Until its first
	 * answer (or on an unknown value) the gate-carried mode stands.
	 *
	 * Provenance: the query carries only the mode. A mode that DIFFERS from the
	 * gate's was moved by a session command after the request was raised, which
	 * is a session override by definition; an equal mode keeps the gate's own
	 * provenance, the best fact available.
	 */
	const live = useApprovalMode(sessionId);
	const liveMode = live.updatedAt > 0 ? live.mode : null;
	const mode: ApprovalEscapeMode | undefined = liveMode ?? approvalMode;
	const provenance: ApprovalEscapeProvenance | undefined =
		liveMode && liveMode !== approvalMode ? "session" : approvalProvenance;
	/*
	 * A NEW OR CHANGED GATE IS A FRESH POLICY READING (design D4 / QA Q2): the
	 * runtime stamps the gate with the mode at the moment it asked, so a gate
	 * whose stamp moved - including a change from the TUI or another client -
	 * is the cheap signal to re-read the shared query the chip paints from.
	 */
	// One stamp for mode + provenance, so a provenance-only move also re-reads.
	const gateStamp =
		approvalMode === undefined
			? null
			: `${approvalMode}|${approvalProvenance ?? ""}`;
	useEffect(() => {
		if (gateStamp === null) return;
		invalidateApprovalMode(client, sessionId);
	}, [gateStamp, client, sessionId]);
	/*
	 * A CONFIRMATION ENDS WHEN THE MODE STOPS MATCHING IT (agent review round 1,
	 * N3; design round 1, D1). "Auto is on" after a chip switch back to ask - or
	 * "asks again" after a switch to auto - would be a claim about a mode the
	 * session no longer has. Keyed on the mode CHANGING, so the save itself
	 * (which lands before the re-read reports the new mode) is not undone by the
	 * stale value it replaced.
	 */
	useEffect(() => {
		if (!mode) return;
		setStatus((current) => {
			const claims =
				current.kind === "session-saved" || current.kind === "default-saved"
					? "auto"
					: current.kind === "ask-saved"
						? "ask"
						: null;
			return claims && claims !== mode ? { kind: "idle" } : current;
		});
	}, [mode]);

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
						command.run(name, args, APPROVAL_ESCAPE_COPY.notChanged()),
					editDefault,
				});
				setStatus(
					outcome.kind === "saved"
						? which === "ask"
							? { kind: "ask-saved" }
							: which === "session"
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
				// The composer's approval chip repaints from the backend, not the press.
				invalidateApprovalMode(client, sessionId);
				inFlight.current = false;
				setTarget(null);
			}
		},
		[command, editDefault, client, sessionId],
	);

	const policy = policyAfterSave(status, {
		mode,
		provenance,
		globalMode: approvalGlobalMode,
	});
	return (
		<ApprovalEscapeControls
			policyLine={approvalPolicyLine(policy)}
			showAlwaysAsk={policy.mode === "auto"}
			onAlwaysAsk={() => void choose("ask")}
			busy={target !== null}
			pending={target}
			status={status}
			compactIdle={compactIdle}
			onSetSession={() => void choose("session")}
			onSetAll={() => void choose("all")}
			className={className}
		/>
	);
};
