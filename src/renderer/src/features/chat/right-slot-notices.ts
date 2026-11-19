/**
 * What a right-slot pane says when its door was pressed where it cannot act yet
 * (the always-visible rail, D1/D3): pure functions from the route's facts to the
 * notice, so `chat-content` mounts one answer and a test can drive every branch
 * without a DOM.
 *
 * WHY HERE AND NOT IN THE COMPONENT. The rail's doors are present on every chat
 * route, so each pane that can be opened over "nothing to show" owes a sentence
 * for each reason it has nothing - and the reasons are facts the route already
 * holds (a conversation or not, a frame read or not, the backend's capability
 * state). Deciding the notice is a pure question; drawing it is
 * `SlotPaneNotice`'s.
 *
 * Frozen notices resolve copy through getters so their stable identity never
 * pins the language that happened to be active when the module was imported.
 */

import { t } from "@shared/i18n";

import {
	backendLoadErrorMessage,
	backendPairingSentence,
} from "@shared/api/local-operator/backend-error";
import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import type { CanonicalSessionStatus } from "@shared/hooks/use-canonical-session";
import type { DaemonPairingCause } from "../../../../shared/backend-status";

/**
 * How a notice reads, which is `PanelNotice`'s own vocabulary (design round 1,
 * D3): `empty` is a quiet fact - nothing to show here yet, nothing lost;
 * `loading` is a wait that will end; `unavailable` is a read that failed, drawn
 * at full ink because it is the thing on screen the user has to act on.
 */
export type SlotNoticeTone = "empty" | "loading" | "unavailable";

export type SlotNotice = {
	/** Which state this is, on the element as `data-slot-pane-notice`. */
	kind: string;
	tone: SlotNoticeTone;
	/**
	 * A sentence, ending in a full stop (design round 1, D2: one rule for every
	 * notice title). A progress title ends in an ellipsis instead.
	 */
	title: string;
	detail?: string;
};

/*
 * THE NEXT STEP IS NAMED (UX round 1, U3): a draft notice says why the pane is
 * empty AND how to get past it, and the way past it is the same for every pane -
 * the first message is what turns a draft into a conversation. One clause, so
 * the three draft notices (and the console's own, `ui.console.json`) say it the
 * same way.
 */

export const RUN_NOTICE_DRAFT: SlotNotice = Object.freeze({
	kind: "run-draft",
	tone: "empty",
	get title() {
		return t("ui.chat.slot_notice.run_draft_title");
	},
	get detail() {
		return t("ui.chat.slot_notice.run_draft_detail");
	},
});

export const RUN_NOTICE_READING: SlotNotice = Object.freeze({
	kind: "run-reading",
	tone: "loading",
	get title() {
		return t("ui.chat.slot_notice.run_reading_title");
	},
});

/*
 * THE READ THAT ENDED (design round 1, D1 = UX round 1, U5). The progress line
 * above is only honest while a read can still answer; once the conversation's
 * stream has given up (`status: "unavailable"` - the snapshot deadline, a spent
 * retry budget, unreadable history, or the 404 that says this host does not
 * have the conversation) the pane says so, and the transcript beside it carries
 * the failure and its Reconnect. Detail is the transcript's own statement when
 * there is one, so the two halves of the window describe one failure in one
 * set of words.
 */
export const RUN_NOTICE_UNREADABLE: SlotNotice = Object.freeze({
	kind: "run-unreadable",
	tone: "unavailable",
	get title() {
		return t("ui.chat.slot_notice.run_unreadable_title");
	},
	get detail() {
		return t("ui.chat.slot_notice.run_unreadable_detail");
	},
});

export const RUN_NOTICE_MISSING: SlotNotice = Object.freeze({
	kind: "run-unreadable",
	tone: "unavailable",
	get title() {
		return t("ui.chat.slot_notice.run_unreadable_title");
	},
	get detail() {
		return t("ui.chat.slot_notice.run_missing_detail");
	},
});

/**
 * The run pane's notice, for a slot with no run model to draw.
 *
 * Three absences, three facts: a draft has no run to report until it starts; a
 * conversation whose stream is still connecting or reconnecting WILL have one
 * (a progress line); and a conversation whose stream gave up will not, until
 * the user reconnects (a resolved line, never a progress claim that cannot
 * complete). `failure` is the canonical view's own sentence, when it has one.
 */
export function runPaneNotice(input: {
	sessionId: string | null | undefined;
	status: CanonicalSessionStatus;
	missing: boolean;
	failure: { statement: string } | null;
}): SlotNotice {
	if (!input.sessionId) return RUN_NOTICE_DRAFT;
	if (input.status !== "unavailable") return RUN_NOTICE_READING;
	if (input.missing) return RUN_NOTICE_MISSING;
	return input.failure
		? { ...RUN_NOTICE_UNREADABLE, detail: input.failure.statement }
		: RUN_NOTICE_UNREADABLE;
}

/**
 * How long a PROGRESS notice waits before it is drawn (UX round 1, U1).
 *
 * A conversation switch with Run details open reads the new frame in 50-90 ms
 * (measured, 3 of 3 switches), and drawing "Reading…" for that long is a
 * sentence the eye catches but cannot read - a blink on every switch. Below this
 * bound the slot shows its empty ground and the real pane lands in it; above it
 * the read is a real wait and the line says so. 200 ms is under the ~250 ms at
 * which a silent pane starts to read as stuck, and well over the measured read,
 * so a slow read still gets its sentence and a fast one never flashes. Only
 * `loading` notices wait: a resolved notice is an answer and shows at once.
 */
export const SLOT_NOTICE_PROGRESS_DELAY_MS = 200;

export const CODE_NOTICE_DRAFT: SlotNotice = Object.freeze({
	kind: "code-draft",
	tone: "empty",
	get title() {
		return t("ui.chat.slot_notice.code_draft_title");
	},
	get detail() {
		return t("ui.chat.slot_notice.code_draft_detail");
	},
});

/*
 * THE NOUN IS "the Local Operator server" (design round 1, D2), the shared copy
 * table's choice (`backend-error.ts`, "One process, one name"): the 404 path
 * drawn in this same pane says "server", so the capability line must too.
 */
export const CODE_NOTICE_BELOW_VERSION: SlotNotice = Object.freeze({
	kind: "code-below-version",
	tone: "empty",
	get title() {
		return t("ui.chat.slot_notice.code_below_version_title");
	},
	get detail() {
		return t("ui.chat.slot_notice.code_below_version_detail");
	},
});

export const CODE_NOTICE_CHECKING: SlotNotice = Object.freeze({
	kind: "code-checking",
	tone: "loading",
	get title() {
		return t("ui.chat.slot_notice.code_checking_title");
	},
});

/** The lead `backendLoadErrorMessage` composes a failed capabilities read with. */
export function codeNoticeLoadLead(): string {
	return t("ui.chat.slot_notice.code_load_lead");
}

/**
 * The code review pane's notice, or null when `CodeReviewPane` may mount.
 *
 * The pane - and with it the ledger's query - mounts ONLY on `enabled` with a
 * conversation, so a backend that predates `features.code_requests` is never
 * asked for routes it does not serve (D3: the door is always shown, the 404s are
 * not). The other states each say a different thing, because each is a different
 * fact:
 *
 * - a draft has no ledger yet, whatever the backend serves;
 * - `below-version` is durable and names its own remedy (the speech section's
 *   shape for the same condition);
 * - `unpaired` is a PAIRING fact and takes the shared table's sentence for the
 *   cause main published (`backendPairingSentence`, the seam every per-surface
 *   gate reads), so this pane cannot describe one daemon differently from the
 *   band above it;
 * - `unknown` is no answer YET while the read is in flight, and the read's own
 *   failure once it has failed - never "not answering" for a read still on its
 *   way.
 */
export function codeReviewPaneNotice(input: {
	sessionId: string | null | undefined;
	state: DesktopFeatureState;
	cause: DaemonPairingCause | null;
	/** The capabilities read's error, when it failed with no answer in hand. */
	loadError: unknown;
}): CodeReviewSlot {
	if (!input.sessionId) return { notice: CODE_NOTICE_DRAFT };
	const notice = codeCapabilityNotice(input);
	return notice === null
		? { notice: null, sessionId: input.sessionId }
		: { notice };
}

/**
 * What the code review slot draws: the pane, for the conversation it reads, or a
 * notice. One value rather than a nullable notice beside a separately-checked id
 * (agent review n2): the pane needs a conversation, and only this function knows
 * that "no notice" implies one, so it hands the id over with the verdict.
 */
export type CodeReviewSlot =
	| { notice: null; sessionId: string }
	| { notice: SlotNotice };

function codeCapabilityNotice(input: {
	state: DesktopFeatureState;
	cause: DaemonPairingCause | null;
	loadError: unknown;
}): SlotNotice | null {
	switch (input.state) {
		case "enabled":
			return null;
		case "below-version":
			return CODE_NOTICE_BELOW_VERSION;
		/*
		 * THE TWO FAILURES LEAD WITH WHAT THIS PANE CANNOT DO (design round 1, D3):
		 * the title is this pane's own lead, and the shared sentence - the pairing
		 * table's, or the load error's diagnosis and remedy - is the detail, kept
		 * verbatim so the pane cannot describe one daemon differently from the band
		 * above it. `unavailable` tone: a failed read, not a quiet empty state.
		 */
		case "unpaired":
			return {
				kind: "code-unpaired",
				tone: "unavailable",
				title: codeNoticeLoadLead(),
				detail: backendPairingSentence("unpaired", input.cause) ?? undefined,
			};
		case "unknown": {
			if (!input.loadError) return CODE_NOTICE_CHECKING;
			const rest = backendLoadErrorMessage("", input.loadError).trim();
			return {
				kind: "code-unreadable",
				tone: "unavailable",
				title: codeNoticeLoadLead(),
				...(rest ? { detail: rest } : {}),
			};
		}
	}
}
