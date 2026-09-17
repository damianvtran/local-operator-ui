/**
 * The composer's alert for a send the backend's STORE refused, rendered from the
 * app's own refusal pipeline.
 *
 * WHY THIS IS NOT A STORY WITH TWO PROPS. The change under evidence is not a
 * layout: it is that a 507 or a 500 from the store arrives at the composer
 * carrying its own CODE, so `withholdsRetryHint` withholds the generic "Your
 * message is still in the composer. Send it again." - while the 503 of the same
 * shape keeps it, because there a retry is the right advice. A component handed
 * `{message, code}` proves the component; it proves nothing about the ladder that
 * produced them, and every defect this change exists for lives on that ladder.
 * So the page runs, in order:
 *
 *   1. the app's real transport, against the harness's `/__desktop` (the
 *      backend's verdict substituted at the HTTP boundary, the same substitution
 *      `send-error-evidence.mjs` documents for the 409);
 *   2. the real `desktopResult`, which reads `detail.code`/`detail.message` for
 *      a non-2xx status and builds the `DesktopControlError`;
 *   3. the real `admitChatDraft`, which records the refusal and its code on the
 *      draft ROW the composer reads;
 *   4. the SHIPPED `withholdsRetryHint` and `isStoreWriteRefusal`, on the code
 *      that row holds;
 *   5. the shipped `MessageInput`, on the same derivation `chat-page` uses for
 *      `composerSendError` (`message: sendError || draft.error`, `code:
 *      activeErrorCode`, `heldText`/`heldAttachments` off the row,
 *      `onRestoreHeld`/`onDiscard`/`onReleaseHeld` supplied from the same row).
 *
 * THREE STATES, because one screen cannot answer every claim this set makes
 * (UX round 1, U1/U2/U3/U4):
 *
 *   - `restored` - the payload is back in the box (`Restore message`, or the
 *     user retyped it). This is the state the hint's own condition is satisfied
 *     in, so it is the state that shows the CODE deciding the hint: busy keeps
 *     it, the two store arms do not.
 *   - `held` - the refusal's own state, which is what the operator actually
 *     lands on: the claim holds the text, the BOX IS EMPTY, the chip row still
 *     carries the file, and the two controls are offered. This is where a
 *     sentence that says "send it again" is an instruction the app cannot honour
 *     until its control is named, and where a store sentence's "the outcome is
 *     unknown" contradicts the sentence above it.
 *   - `altered` - the operator's own remedy from 2026-09-17, one step on: the
 *     text restored, the IMAGE DROPPED, and Enter pressed. The second admission
 *     is really issued, so the unchanged-payload guard really fires and its own
 *     code is what the alert renders. Same text, one fewer file - the case that
 *     discriminates a chip-aware payload comparison from a text-only one.
 *
 * The box is set rather than typed, and the chip is the app's own PASTED shape (a
 * `data:` URL, so no filename strip and no artefact of the harness), but the
 * refusal, the row, the guard and the alert are the app's own code throughout.
 */

import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import {
	type ComposerSendError,
	MessageInput,
} from "@renderer/features/chat/components/message-input";
import type { Message } from "@renderer/features/chat/types/message";
import {
	admitChatDraft,
	isRefusedBeforeAdmission,
	isStoreWriteRefusal,
	useCanonicalSessionsStore,
	withholdsRetryHint,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { DEFAULT_THEME, applyThemeToDocument, getTheme } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "./store-refusal-evidence.css";

const params = new URLSearchParams(window.location.search);
const COLUMN = Number(params.get("w") ?? 892);
const CASE = params.get("case") ?? "out-of-space";
const STATE = (params.get("state") ?? "restored") as State;
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;

type State = "restored" | "held" | "altered";

applyThemeToDocument(THEME);

/**
 * The desktop bridge, installed at module scope - the composer reaches it from a
 * passive effect on mount, and React runs a CHILD's effects before its parent's,
 * so a stub installed by a wrapper arrives one commit too late (the trap
 * `composer-alert-geometry.tsx` records).
 *
 * `window.api` is deliberately left ABSENT: `desktopRequest` then takes its real
 * `/__desktop` HTTP path, which is the hop this harness wants to exercise rather
 * than the Electron IPC one.
 */
window.electron = {
	...(window.electron ?? {}),
	ipcRenderer: {
		...(window.electron?.ipcRenderer ?? {}),
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
		send: () => {},
		invoke: async (channel: string) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
} as typeof window.electron;

/** The sentinel `composer-alert-geometry.tsx` uses: an empty-chat greeting is not a chat. */
const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

const CONVERSATION = "store-refusal-evidence";
const SESSION = "111111111111";

/** What the refused send carried. One sentence, one image: the incident's shape. */
const TEXT = "Here is the screenshot from the failing run.";
/**
 * That image, as the app's own PASTED shape.
 *
 * A `data:` URL rather than a path on purpose: a pasted screenshot is how a user
 * attaches one, and the composer's chip renders a real thumbnail from it with no
 * filename strip (there is no name to show), so the frame carries no artefact of
 * the harness - a nonexistent path would photograph a placeholder tile that no
 * user ever sees. The same bytes go on the wire as the send's image, so the chip
 * and the refused payload are one image rather than two.
 *
 * It is passed as an ATTACHMENT as well as an image, because that is what the app
 * does: `chat-page` sends `attachments.map((a) => a.path)` beside the encoded
 * images, and the store's unchanged-payload guard compares text AND attachments
 * AND images. A fixture that put the image only on the wire would be a payload
 * whose chip set does not match its row - i.e. permanently in the state U2 is
 * about, and the `restored` frame would show no hint for a reason that has
 * nothing to do with its code.
 *
 * A 48x28 PNG, generated rather than inlined by hand (144 bytes, so the request
 * stays far inside every budget this flow checks).
 */
const IMAGE_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAADAAAAAcCAYAAAAnbDzKAAAAV0lEQVR42u3UsQ0AIAgFUQYxjmPhCG5gwyTWrKsL2BENJFdcRfUKvpRaduYEAAAnoI2+MwcAgBfACgEAcD+YracBABAdwAoBcAJUZ4gApAXwxAAAAPjSAQ/BUbNOO4gwAAAAAElFTkSuQmCC";
const IMAGE_DATA_URL = `data:image/png;base64,${IMAGE_B64}`;

type Evidence = {
	case: string;
	state: State;
	status: number | null;
	/** The code this state's refusal classified itself with, as `chat-page` reads it. */
	code: string | undefined;
	/** The row's own copy of it, which the guard's refusal does not update (R-4). */
	rowCode?: string | undefined;
	rowMessage?: string | undefined;
	message: string | undefined;
	withholdRetryHint: boolean;
	storeWriteRefusal: boolean;
	refusedBeforeAdmission: boolean;
	admissionAttempted: boolean | undefined;
	submittedText: string | undefined;
	/** The files the held payload carried, as the row records them. */
	submittedAttachments: string[] | undefined;
	/** The chips in the composer as the page seeded them. */
	boxAttachments: string[] | undefined;
	/** What the alert actually painted, read from the DOM after the first paint. */
	alertText?: string;
	/** The same, over the PROSE only: the sentences, without the controls' labels. */
	alertProse?: string;
};

const evidence: Evidence = {
	case: `${CASE}-${STATE}`,
	state: STATE,
	status: null,
	code: undefined,
	message: undefined,
	withholdRetryHint: false,
	storeWriteRefusal: false,
	refusedBeforeAdmission: false,
	admissionAttempted: undefined,
	submittedText: undefined,
	submittedAttachments: undefined,
	boxAttachments: undefined,
};
(
	window as unknown as { __storeRefusalEvidence: Evidence }
).__storeRefusalEvidence = evidence;

/**
 * Run the pipeline, once, before the first render.
 *
 * Deliberately awaited at module scope rather than in an effect: the alert has to
 * be on the first painted frame, or the driver photographs a composer that is
 * briefly refusing nothing.
 */
await fetch(
	`/__store-refusal-case?case=${encodeURIComponent(CASE)}&state=${encodeURIComponent(STATE)}`,
).then((r) => {
	if (!r.ok)
		throw new Error(`the harness refused case \`${CASE}\`: ${r.status}`);
});

const store = useCanonicalSessionsStore.getState();
const key = store.stageDraft({ kind: "agent", name: "reviewer" });

/** The refused send: the incident's own shape, text plus one pasted image. */
const firstAttempt = {
	text: TEXT,
	attachments: [IMAGE_DATA_URL] as string[],
	images: [{ data_b64: IMAGE_B64, mime_type: "image/png" }],
	mode: "prompt" as const,
	cwd: "/tmp",
};

let raised: unknown;
try {
	await admitChatDraft(key, firstAttempt, SESSION);
	throw new Error("the harness's refusal did not happen: the send succeeded");
} catch (error) {
	raised = error;
}
evidence.refusedBeforeAdmission = isRefusedBeforeAdmission(raised);

/*
 * THE OPERATOR'S OWN REMEDY, FOR THE CASE THAT DISCRIMINATES IT (UX round 1, U2).
 *
 * The second send is really issued - the same text, the dropped image, exactly
 * what `Restore message` then removing the chip produces - so the store's own
 * unchanged-payload guard is what answers it, and its code is what reaches the
 * row. A fixture that handed the composer that code would prove the component;
 * this proves the guard produces it for this payload pair.
 */
if (STATE === "altered") {
	try {
		await admitChatDraft(
			key,
			{ ...firstAttempt, attachments: [], images: [] },
			SESSION,
		);
		throw new Error(
			"the altered retry was accepted, so the guard never fired and this frame proves nothing",
		);
	} catch (error) {
		raised = error;
	}
}

const draft = useCanonicalSessionsStore.getState().drafts[key];
if (!draft?.error)
	throw new Error("the refusal reached no draft row to render");

evidence.status =
	typeof (raised as { status?: unknown })?.status === "number"
		? ((raised as { status: number }).status as number)
		: null;
/*
 * WHAT THE COMPOSER IS HANDED, which is `chat-page`'s own derivation and not the
 * row: `activeError = sendError || draft.error` and
 * `activeErrorCode = sendErrorCode ?? draft.errorCode`, where the LOCAL half is
 * the error this send threw. The distinction is load-bearing for the `altered`
 * case, and it is the R-4 mechanism seen from the other side: the
 * unchanged-payload guard throws OUTSIDE `admitChatDraft`'s catch (it fires before
 * the request is built), so the failing second send records nothing new on the
 * row - the row still holds the previous refusal's code while the composer is
 * handed the guard's. A harness that read only the row would photograph the wrong
 * code for the one frame that exists to pin this.
 */
evidence.rowCode = draft.errorCode;
evidence.rowMessage = draft.error;
evidence.code =
	typeof (raised as { code?: unknown })?.code === "string"
		? ((raised as { code: string }).code as string)
		: draft.errorCode;
evidence.message =
	raised instanceof Error && raised.message ? raised.message : draft.error;
evidence.withholdRetryHint = withholdsRetryHint(evidence.code);
evidence.storeWriteRefusal = isStoreWriteRefusal(evidence.code);
evidence.admissionAttempted = draft.admissionAttempted;
evidence.submittedText = draft.submittedText;
evidence.submittedAttachments = draft.submittedAttachments;

/**
 * The chips, per state: the file the refused send carried is still attached
 * (`held`), was re-attached with the restored text (`restored`), or was removed -
 * the remedy - in `altered`.
 *
 * The chip surviving a refusal is the product's behaviour, not the harness's:
 * `Clear` and a removed chip are the user's actions, and the payload they act on
 * is the claim's, not the box's.
 */
const boxAttachments =
	STATE === "altered"
		? []
		: [{ id: "harness-screenshot", path: IMAGE_DATA_URL }];
/**
 * The box, per state. `restored` and `altered` hold the held text (the `restore`
 * control writes exactly `heldText`); `held` is the state the refusal leaves -
 * empty box, claim holding the payload, chip row intact.
 */
const boxText = STATE === "held" ? "" : (draft.submittedText ?? TEXT);

/**
 * The held payload, on `chat-page`'s own terms: the claim holds the text only
 * once an admission has been ISSUED and SETTLED (`admissionAttempted &&
 * !pending`), which is what a post-admission refusal leaves behind - and why the
 * box is empty in the `held` state and the restore control is the only way back
 * to a sendable payload.
 */
const heldText =
	draft.admissionAttempted && !draft.pending ? draft.submittedText : undefined;

useConversationInputStore.setState({
	inputByConversation: {
		[CONVERSATION]: {
			currentInput: boxText,
			submittedMessages: [],
			currentHistoryIndex: null,
			replies: [],
			attachments: boxAttachments,
		},
	},
});
evidence.boxAttachments = boxAttachments.map((a) => a.path);

const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const Harness = () => {
	const columnRef = useRef<HTMLDivElement>(null);
	const [isSmallView, setIsSmallView] = useState(false);

	// The app's own rule, on the app's own element: `chat-content.tsx` observes
	// the chat container and compacts below 550px.
	useEffect(() => {
		const element = columnRef.current;
		if (!element) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries)
				setIsSmallView(entry.contentRect.width < 550);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	/*
	 * `chat-page`'s own derivation, to the letter: the composer's local failure
	 * wins over the persisted row (`activeError = sendError || draft?.error`), the
	 * code is what the composer reads its predicates off
	 * (`activeErrorCode = sendErrorCode ?? draft?.errorCode`), and the held payload
	 * travels from the same row (`heldText` gated on an admission having been
	 * attempted and settled, `refusedText`/`refusedAttachments` on the
	 * pre-admission rows). Here every one of them comes from the row, because the
	 * refusal was produced by the store.
	 *
	 * The abandon handlers are no-ops: a still cannot show what a press did, and
	 * reaching them is the QA round's business rather than this rig's. What their
	 * PRESENCE decides is the control's label (`Discard message` with an empty box
	 * or the held text in it, `Stop holding it` when the box holds a different
	 * payload) - i.e. copy, which is exactly what a still is for. Stated in the
	 * README's "does not prove" list rather than left to be inferred.
	 */
	const sendError: ComposerSendError = {
		message: evidence.message,
		code: evidence.code,
		heldText,
		heldAttachments: draft.submittedAttachments,
		onRestoreHeld: () => {},
		onDiscard: () => {},
		onReleaseHeld: () => {},
	};

	return (
		<div
			ref={columnRef}
			className="mx-auto"
			style={{ width: COLUMN }}
			data-store-refusal-column={COLUMN}
		>
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId={CONVERSATION}
				isSmallView={isSmallView}
				onSendMessage={async () => true}
				sendError={sendError}
			/>
		</div>
	);
};

createRoot(document.getElementById("root") as HTMLElement).render(
	/* `getTheme` returns the Option, whose `theme` is the MUI theme - the same
	   pairing Storybook's decorator uses, so a component that reads MUI tokens
	   reads the palette this frame claims to be. */
	<MuiThemeProvider theme={getTheme(THEME).theme}>
		<CssBaseline />
		<QueryClientProvider client={client}>
			<MemoryRouter>
				{/* Bottom-anchored, like the app's own band, so the alert sits above
				    the composer exactly where the user meets it. */}
				<div
					style={{ height: "100vh", display: "flex", flexDirection: "column" }}
					className="justify-end bg-canvas"
				>
					<Harness />
				</div>
			</MemoryRouter>
		</QueryClientProvider>
	</MuiThemeProvider>,
);

/*
 * Record what the alert PAINTED, from the DOM, after the first paint. The code
 * and the message above are what the pipeline produced; this is what a person
 * reads, and the pair is the evidence: a withheld hint that is absent because the
 * copy dropped the sentence would look identical in a screenshot.
 *
 * `alertProse` is the region's PARAGRAPHS - the sentences - without the
 * controls' own labels, which live in the pinned row beside them. U1's claim is
 * about the prose naming a control, and reading it off the whole region would be
 * satisfied by the button rendering at all.
 */
requestAnimationFrame(() =>
	requestAnimationFrame(() => {
		const region = document.querySelector('[role="alert"]');
		evidence.alertText = region
			? (region.textContent ?? "").replace(/\s+/g, " ").trim()
			: null;
		evidence.alertProse = region
			? [...region.querySelectorAll("p")]
					.map((p) => p.textContent ?? "")
					.join(" ")
					.replace(/\s+/g, " ")
					.trim()
			: null;
	}),
);
