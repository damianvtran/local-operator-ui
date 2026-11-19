/**
 * The sentences a reader sees when a conversation cannot be read.
 *
 * WHY THIS IS HERE AND NOT IN `shared/desktop-stream-notice.ts`. That module is
 * imported by MAIN and PRELOAD for its machine vocabulary
 * (`DESKTOP_STREAM_DETAIL`), and the copy it used to hold was resolved through
 * `t()` at call time — which pulled every English catalogue into the preload
 * bundle (measured: 333 kB before, 7.5 MB after) for strings a preload script
 * never draws. The shared half now classifies the failure as an ID
 * (`sessionFailureKind`), and this renderer-side module turns that ID into the
 * product sentence, so the catalogue stays where it is used.
 *
 * WHY THE SENTENCES ARE FUNCTIONS AND NOT CONSTANTS: `t()` resolves the active
 * locale when it is called, so a module-level object would freeze the language
 * the process started in and every notice already on screen would keep speaking
 * it. A caller that holds a notice reads one at the moment it renders.
 *
 * WHAT THE COPY MUST DO (`SessionFailureNotice`'s contract, kept from the
 * original module): state what happened and what to do, assert no cause the app
 * has not observed, and blame nobody. `action` is null where no control can
 * honestly help.
 */

import { t } from "@shared/i18n";
import {
	type SessionFailureAction,
	type SessionFailureKind,
	type SessionFailureNotice,
	sessionFailureKind,
} from "../../../../../shared/desktop-stream-notice";

/** One sentence per kind, in the active locale. */
const STATEMENT_KEY = {
	frameTooLarge: "ui.common.connection.session_loss.frame_too_large",
	historyUnreadable: "ui.common.connection.session_loss.history_unreadable",
	lost: "ui.common.connection.session_loss.lost",
	notPaired: "ui.common.connection.session_loss.not_paired",
	serverDown: "ui.common.connection.session_loss.server_down",
} as const satisfies Record<SessionFailureKind, string>;

/**
 * Whether a control can honestly help, per kind.
 *
 * `notPaired` offers nothing: the action that helps is main re-claiming the
 * plane, which this notice cannot perform or promise.
 */
const ACTION: Record<SessionFailureKind, SessionFailureAction | null> = {
	frameTooLarge: "reconnect",
	historyUnreadable: "reconnect",
	lost: "reconnect",
	notPaired: null,
	serverDown: "reconnect",
};

/**
 * The sentence and control for one classified kind, in the ACTIVE locale.
 *
 * Exported because a holder of a notice must be able to ask for it again: the
 * app's session store stores the notice in render state, and a locale change
 * has to re-resolve it (see `use-canonical-session`'s locale listener) rather
 * than leave a stale sentence on screen.
 */
export function noticeFor(kind: SessionFailureKind): SessionFailureNotice {
	return { kind, statement: t(STATEMENT_KEY[kind]), action: ACTION[kind] };
}

/**
 * Translate a transport detail into the sentence the reader sees.
 *
 * The classification is the shared contract's; this module only words it.
 */
export function streamFailureNotice(
	detail: string | null | undefined,
): SessionFailureNotice {
	return noticeFor(sessionFailureKind(detail));
}

/** Durable history could not be read, so the transcript may not claim empty. */
export const historyUnreadable = (): SessionFailureNotice =>
	noticeFor("historyUnreadable");
