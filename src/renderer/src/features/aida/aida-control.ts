/**
 * Aida's vocabulary: the actions her route takes, the reserved words of `/aida`,
 * and the sentences its receipts and refusals use.
 *
 * PURE IN THE TEST'S SENSE — no React, no route calls — because this is the half
 * the desktop suite bundles and EXECUTES (`scripts/aida-sidebar.test.mjs`), the
 * same split `slash-submit.ts` keeps from `slash-dispatch.ts`: the rules a press
 * turns on are run by the test, and only the wiring is pinned as source. It
 * imports `userFacingMessage` from the transport module, and deliberately: which
 * thrown messages are authored copy is a judgement that lives in ONE place
 * (`desktop-api.ts`, beside `DesktopControlError`), and a second copy of it here
 * is how a raw exception finds its way back to the screen (agent review round 1,
 * MINOR-1). The hooks and the route calls live in `use-aida-target.ts`.
 */

import type { DesktopAidaControlResult } from "../../../../shared/desktop-control-contract";
import {
	DesktopControlError,
	userFacingMessage,
} from "../../shared/api/local-operator/desktop-api";

/** The route's own op vocabulary, mirrored (`aida.control`, `design.md` § 4). */
export type AidaControlAction =
	| "open"
	| "pause"
	| "resume"
	| "greet"
	| "status";

/**
 * The control word an argument names, or null when the argument is a message.
 *
 * THE WHOLE ARGUMENT MUST BE THE WORD — not its first token. `/aida pause` is the
 * control; `/aida pause and tell me what you think` is a message to her, because
 * a rule that read only the first token would silently swallow the rest of a
 * sentence the user addressed to an agent. Case-insensitive, so `/aida Pause`
 * still reads as the control word.
 *
 * THE `=` ESCAPE IS THE TUI'S, TOO (cross-host grammar ruling, agent review round
 * 1 MINOR-3): `/aida =pause` is a message and never a control — `aidaMessageText`
 * strips the `=` — so both hosts of this one command read the same grammar, with
 * one spelling for "talk to her about a word from her own vocabulary". The
 * reserved vocabulary is `design.md`'s (§ 2.5: pause, resume, status), and an
 * escaped argument is excluded HERE rather than at the caller so no future
 * caller can re-derive the rule and reintroduce the divergence.
 */
export function aidaReservedAction(
	argument: string,
): "pause" | "resume" | "status" | null {
	const word = argument.trim();
	/* The escape, first: `=pause` is a message about the word, never the control. */
	if (word.startsWith("=")) return null;
	const lower = word.toLowerCase();
	if (lower === "pause" || lower === "resume" || lower === "status")
		return lower;
	return null;
}

/**
 * The text `/aida <argument>` sends her, with the escape resolved.
 *
 * Mirrors the TUI's own parse (`_cmd_aida` in `app.py`): a leading `=` is
 * STRIPPED, along with any whitespace it introduced, and the remainder is a
 * message even when it is one of her reserved words — that is the escape's whole
 * point (R2's "send `[command]` as a turn" with a spelling for a command that
 * opens with a word she reserves). An escape that strips to nothing (`/aida =`)
 * is the bare form and sends nothing, which the caller reads off the empty
 * string rather than off a second rule.
 *
 * The unescaped text is passed through UNCHANGED — this function resolves the
 * escape and nothing else, so it cannot disagree with `aidaReservedAction` about
 * where the control/message line is.
 */
export function aidaMessageText(argument: string): string {
	const trimmed = argument.trim();
	return trimmed.startsWith("=") ? trimmed.slice(1).trimStart() : trimmed;
}

/**
 * The sentence a control op's receipt shows.
 *
 * Keyed on the OP rather than on the answer's state alone, because the same
 * state answers `status` ("Aida is paused.") and a pause ("Aida is paused. She
 * will not check in until you resume her.") — one reports, one confirms.
 */
export function aidaControlReceipt(
	action: "pause" | "resume" | "status",
	state: DesktopAidaControlResult,
): { text: string; kind: "success" | "info" } {
	if (action === "pause")
		return {
			text: "Aida is paused. She will not check in until you resume her.",
			kind: "success",
		};
	if (action === "resume")
		return {
			text: "Aida is resumed. She will check in on her usual schedule.",
			kind: "success",
		};
	return {
		kind: "info",
		text: state.paused ? "Aida is paused." : "Aida is active.",
	};
}

/**
 * The sentence a failed open or control shows.
 *
 * Routed through the app's ONE copy authority (`userFacingMessage`) rather than
 * echoing whatever a throw carried (agent review round 1, MINOR-1). A runtime
 * exception's `message` is a stack fragment ("TypeError: fetch failed"), and a
 * pairing refusal's is the DAEMON's prose about this app's ownership — both are
 * the register `branding.md` § 8 and § 5.1 refuse. `userFacingMessage` answers
 * with the backend's authored `detail` where there is one, this app's own
 * sentence for the refusal families it knows, and this fallback otherwise: the
 * one thing this surface must not do is fail silently, and the second thing it
 * must not do is fail in the language of the crash.
 */
export function aidaControlFailureCopy(error: unknown): string {
	return userFacingMessage(
		error,
		"Aida's controls could not reach the backend.",
	);
}

/**
 * The sentence for a request that arrives at the route with the install's
 * switch already off (`aida.enabled === false`; a control op after the flip
 * answers `409 aida_disabled` — `desktop_aida.py`'s contract).
 *
 * WHY IT EXISTS HERE. `aidaControlFailureCopy` above is the transport's own
 * sentence and it NAMES her, which is correct for the surfaces that already
 * address her by name and wrong for the quick-send mini view, whose copy is
 * deliberately name-free (quick-send design D11) so the rename slice cannot
 * break it. The rail's row is ABSENT while the switch is off — a dead control
 * is what fail-closed omits — but the mini view is already open when it
 * learns, and cannot un-summon itself; so it states the fact once, in the
 * same register as the rest of that surface, and offers nothing it cannot
 * honestly do. One sentence, one place, per the design's own cross-surface
 * rule (§E.5).
 */
export const AIDA_DISABLED_SENTENCE =
	"The chief of staff is switched off on this install.";

/**
 * Where first-run setup lands, and what it says, when `greet` did not open her
 * conversation (first-run onboarding, U1/A2).
 *
 * THE SETUP NEVER STRANDS THE USER: every refusal lands in the chat, because the
 * provider the user just connected works there whatever happened to her. What
 * differs is the sentence:
 *
 * - `aida_no_provider` (409): the backend could not resolve a provider to greet
 *   with - a key that has not propagated yet, or setup finished on a census that
 *   was stale. Said as a fact with its remedy, at `info`, because nothing broke.
 * - `aida_disabled` (409): the install switched her off. Silence is correct -
 *   setup is not the place to advertise a feature the operator turned off.
 * - anything else: the transport's own authored copy, at `error`.
 *
 * The code is read off `DesktopControlError.code`, the vetted category the
 * transport attached from the refusal body's `detail.code` - never matched in
 * the sentence, which is the backend's to reword.
 */
export const AIDA_NO_PROVIDER_CODE = "aida_no_provider";
export const AIDA_DISABLED_CODE = "aida_disabled";

export function aidaGreetFailure(
	error: unknown,
	name: string,
): { kind: "info" | "error"; text: string } | null {
	const code = error instanceof DesktopControlError ? error.code : undefined;
	if (code === AIDA_DISABLED_CODE) return null;
	if (code === AIDA_NO_PROVIDER_CODE)
		return {
			kind: "info",
			text: `${name} will say hello once an AI account is connected. Connect one from the chat to start.`,
		};
	return {
		kind: "error",
		text: `${name}'s conversation could not be opened, so you are in a new chat instead. ${aidaControlFailureCopy(error)}`,
	};
}

/**
 * The one extra sentence a SUCCESSFUL first-run landing may owe (code review
 * round 1, R3's sibling: read the facts, never the prose). Two of them, and both
 * come from the answer's own additive fields rather than from inferring her
 * plans out of `paused`/`greeted`:
 *
 * - `held: true` — a live session on this machine owns her rows, so the greeting
 *   arrives IN THE OTHER WINDOW. The route sets it on exactly that outcome
 *   (`desktop_aida.py`'s `owner` branch) and it is a 200, not a failure; without
 *   it the desktop could only guess, because the ordinary success carries the
 *   same three legacy fields.
 * - `paused` with the greeting unsettled — she is held behind the pause and
 *   `/aida resume` delivers it. `greeting_state` is what says "unsettled":
 *   `delivered` and `skipped` are terminal (the backend's own words for the
 *   ledger), so a pause over either of those owes the user nothing.
 *
 * NOT USED FOR THE SKIP PATH, deliberately: `skipped` is set by the backend for
 * an install that already has human conversations before the first-run
 * precondition is read — the desktop's "Skip to chat" never calls `greet` at all,
 * so there is no request of ours for a state word to describe.
 *
 * TOLERANT OF AN OLDER BACKEND: with both additions absent the notice falls back
 * to the `paused && !greeted` inference this shipped with, so an older payload
 * still gets the resume sentence and never a wrong owner sentence.
 */
export function aidaGreetHeldNotice(
	state: Pick<
		DesktopAidaControlResult,
		"paused" | "greeted" | "greeting_state" | "held"
	>,
	name: string,
): string | null {
	if (state.held === true)
		return `${name} is already open in another window, so she will say hello there.`;
	/*
	 * "Settled" is delivered-or-skipped, and `greeted` is the OLDER spelling of
	 * exactly those two states for a backend that predates the ledger: it is the
	 * frozen field's whole meaning ("the greeting has been delivered"), so an
	 * absent `greeting_state` falls back to it rather than to "nothing is
	 * settled", which would tell a user whose name she already knows that she
	 * still has to say hello.
	 */
	const settled =
		state.greeting_state === "delivered" ||
		state.greeting_state === "skipped" ||
		(state.greeting_state == null && state.greeted === true);
	if (state.paused && !settled)
		return `${name} is paused, so she will say hello when you resume her: type /aida resume.`;
	return null;
}
