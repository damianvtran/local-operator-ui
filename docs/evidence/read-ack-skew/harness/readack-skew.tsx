/**
 * The read-receipt skew's two states, on the shipped components.
 *
 * `?state=before` (run from the unmodified checkout) shows the defect: the
 * announcement arm fires `showWarningToast(readAckNoticeSentence(notice))` for
 * the `unsettled` notice a give-up publishes, and the sentence it composes
 * carries the backend's own words - the refusal body the rig captured.
 *
 * `?state=after` (run from the fixed checkout) runs the same page: the loop now
 * publishes the `remote` KIND for the skew class, the arm's own condition reads
 * it (`kind !== "unsettled"` returns early), and nothing is announced. The
 * readout prints the class's copy - the row's clause and description through
 * `readAckCopy` - and the predicates the fix keys on, so the quiet state is
 * readable even though its whole point is that no card is painted.
 *
 * IMPORTS ARE NAMESPACES, and both fix-only members are feature-detected: this
 * one file runs against BOTH checkouts, and the unmodified one simply does not
 * export `isRemoteReceiptDeferral` or the three-argument `readAckCopy`. A named
 * import of a member the module lacks is a load-time SyntaxError, which would
 * make the `before` run impossible; a namespace property reads `undefined` and
 * the readout says so.
 *
 * The refusal bytes are the rig's own, and each state stages exactly what ITS
 * wire carried: the pre-#2004 daemon's `{code}` alone (`rig/seen-409-raw.txt`)
 * and the post-#2004 route's `{code, cause}` pair (`rig/seen-409.txt`). A fleet
 * in rollout has both shapes live at once, and staging the cause into the
 * before readout would fabricate the field the fix's code fallback exists for
 * (agent review round 1, m1).
 */
import * as noticeApi from "@renderer/features/chat/read-ack-notice";
import * as desktopApi from "@shared/api/local-operator/desktop-api";
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { showWarningToast } from "@shared/utils/toast-manager";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./readack-skew.css";

const params = new URLSearchParams(window.location.search);
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;
const STATE = params.get("state") ?? "after";

applyThemeToDocument(THEME);

const SESSION_ID = "d7c2d1e7b496";
const DEVICE_NAME = "cloud-node-1";

/**
 * The operator's popup, verbatim: what a pre-#2004 daemon echoed into the 409
 * (`rig/seen-409-raw.txt`), which is the `message` their toast carried.
 */
const RAW_ECHO =
	"The unread mark for d7c2d1e7b496 lives on cloud-node-1, and it could not " +
	"be cleared there right now: 'net_session_receipt' is not an operation this " +
	"build dispatches.";

/**
 * The post-#2004 route's composed body (`rig/seen-409.txt`), with the cause the
 * fix keys on.
 */
const COMPOSED =
	"The unread mark for d7c2d1e7b496 lives on cloud-node-1, and it could not " +
	"be cleared there right now: cloud-node-1 runs an older build, and the mark " +
	"clears when that device updates.";

const refusalDetail =
	STATE === "before"
		? { code: "session_is_remote" }
		: { code: "session_is_remote", cause: "owner_build_behind" };

const refusal = new desktopApi.DesktopControlError(
	409,
	STATE === "before" ? RAW_ECHO : COMPOSED,
	undefined,
	"session_is_remote",
	undefined,
	refusalDetail,
);

/**
 * The notice each build's loop publishes for this refusal: `unsettled` was the
 * unmodified give-up's kind (it spent the ladder and announced), `remote` is the
 * fix's deferral kind (published by `use-completion-view`'s skew arm).
 */
const notice = {
	sessionId: SESSION_ID,
	kind: STATE === "before" ? ("unsettled" as const) : ("remote" as const),
	revision: 1,
	reason: refusal,
};

/**
 * The announcement arm, reduced to the one condition that decides it (the
 * sidebar's `if (readAckNotice?.kind !== "unsettled")` early return) - INSIDE
 * the fixed build the arm's kind is never `unsettled` for this class, which is
 * exactly the quiet half. The sentence is composed either way (the table is
 * total by design) and the readout keeps what it said.
 */
const sentence = noticeApi.readAckNoticeSentence(notice);
const announced = notice.kind === "unsettled";

const readAckCopy = noticeApi.readAckCopy as (
	notice: unknown,
	sessionId: string,
	deviceLabel?: string | null,
) => { clause: string; description: string } | null;

const copy = readAckCopy(notice, SESSION_ID, DEVICE_NAME);
const unnamed = readAckCopy(notice, SESSION_ID, null);

const isRemoteReceiptDeferral = (
	desktopApi as { isRemoteReceiptDeferral?: (error: unknown) => boolean }
).isRemoteReceiptDeferral;

const readout = {
	state: STATE,
	theme: THEME,
	build:
		STATE === "before"
			? "unmodified checkout (origin/main)"
			: "fix/read-ack-skew-tolerance",
	refusal: {
		status: 409,
		code: refusal.code,
		cause: (refusal.detail as { cause?: string } | undefined)?.cause ?? null,
		message: refusal.message,
	},
	classifiesAsSkewDeferral:
		typeof isRemoteReceiptDeferral === "function"
			? isRemoteReceiptDeferral(refusal)
			: "(predicate absent - pre-fix build)",
	noticeKind: notice.kind,
	announcement: {
		wouldAnnounce: announced,
		toastSentence: announced
			? sentence
			: "(none - the quiet kind returns before the toast)",
	},
	rowCopyNamed: copy,
	rowCopyUnnamed: unnamed,
	mark: "the unread mark stays until that device updates (a later ask settles it)",
};

const Harness = () => {
	useEffect(() => {
		if (announced) showWarningToast(sentence);
		const el = document.getElementById("readout");
		if (el) {
			el.textContent = JSON.stringify(readout, null, 2);
			el.setAttribute("data-ok", "true");
		}
	}, []);

	return <ThemedToastContainer duration={Number.POSITIVE_INFINITY} />;
};

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
