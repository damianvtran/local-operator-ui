/**
 * The composer's alert for a send the backend's STORE refused, rendered from the
 * app's own refusal pipeline.
 *
 * WHY THIS IS NOT A STORY WITH TWO PROPS. The change under evidence is not a
 * layout: it is that a 507 or a 500 from the store arrives at the composer
 * carrying its own CODE, so `withholdsRetryHint` withholds the generic "Your
 * message is still in the composer. Send it again." - while the 503 of the same
 * shape keeps it, because there a retry is the right advice. A component handed
 * `{message, withholdRetryHint}` proves the component; it proves nothing about
 * the ladder that produced them, and every defect this change exists for lives
 * on that ladder. So the page runs, in order:
 *
 *   1. the app's real transport, against the harness's `/__desktop` (the
 *      backend's verdict substituted at the HTTP boundary, the same substitution
 *      `send-error-evidence.mjs` documents for the 409);
 *   2. the real `desktopResult`, which reads `detail.code`/`detail.message` for
 *      a non-2xx status and builds the `DesktopControlError`;
 *   3. the real `admitChatDraft`, which records the refusal and its code on the
 *      draft ROW the composer reads;
 *   4. the SHIPPED `withholdsRetryHint`, on the code that row holds;
 *   5. the shipped `MessageInput`, on the same derivation `chat-page` uses for
 *      `composerSendError` (`message: sendError || draft.error`,
 *      `withholdRetryHint: withholdsRetryHint(activeErrorCode)`).
 *
 * The box is seeded with the text the refused send carried, for EVERY case.
 * That is deliberate and it is the whole reason the busy case is captured beside
 * the other two: the alert's hint is also gated on the box holding something, so
 * an out-of-space frame shot over an empty composer would show no hint for a
 * reason that has nothing to do with the code. Same box, same pipeline, one
 * difference - the code - and the hint is the thing that moves.
 */

import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { MessageInput } from "@renderer/features/chat/components/message-input";
import type { Message } from "@renderer/features/chat/types/message";
import {
	admitChatDraft,
	isRefusedBeforeAdmission,
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
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;

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
 * A 48x28 PNG, generated rather than inlined by hand (144 bytes, so the request
 * stays far inside every budget this flow checks).
 */
const IMAGE_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAADAAAAAcCAYAAAAnbDzKAAAAV0lEQVR42u3UsQ0AIAgFUQYxjmPhCG5gwyTWrKsL2BENJFdcRfUKvpRaduYEAAAnoI2+MwcAgBfACgEAcD+YracBABAdwAoBcAJUZ4gApAXwxAAAAPjSAQ/BUbNOO4gwAAAAAElFTkSuQmCC";
const IMAGE_DATA_URL = `data:image/png;base64,${IMAGE_B64}`;

type Evidence = {
	case: string;
	status: number | null;
	code: string | undefined;
	message: string | undefined;
	withholdRetryHint: boolean;
	refusedBeforeAdmission: boolean;
	admissionAttempted: boolean | undefined;
	submittedText: string | undefined;
	/** What the alert actually painted, read from the DOM after the first paint. */
	alertText?: string;
};

const evidence: Evidence = {
	case: CASE,
	status: null,
	code: undefined,
	message: undefined,
	withholdRetryHint: false,
	refusedBeforeAdmission: false,
	admissionAttempted: undefined,
	submittedText: undefined,
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
await fetch(`/__store-refusal-case?case=${encodeURIComponent(CASE)}`).then(
	(r) => {
		if (!r.ok)
			throw new Error(`the harness refused case \`${CASE}\`: ${r.status}`);
	},
);

const store = useCanonicalSessionsStore.getState();
const key = store.stageDraft({ kind: "agent", name: "reviewer" });
let raised: unknown;
try {
	await admitChatDraft(
		key,
		{
			text: TEXT,
			attachments: [],
			// The incident's own trigger: the image is the largest write in the
			// flow, so it is what crossed the threshold first.
			images: [{ data_b64: IMAGE_B64, mime_type: "image/png" }],
			mode: "prompt",
			cwd: "/tmp",
		},
		SESSION,
	);
	throw new Error("the harness's refusal did not happen: the send succeeded");
} catch (error) {
	raised = error;
}
const draft = useCanonicalSessionsStore.getState().drafts[key];
if (!draft?.error)
	throw new Error("the refusal reached no draft row to render");

evidence.status =
	typeof (raised as { status?: unknown })?.status === "number"
		? ((raised as { status: number }).status as number)
		: null;
evidence.code = draft.errorCode;
evidence.message = draft.error;
evidence.withholdRetryHint = withholdsRetryHint(draft.errorCode);
evidence.refusedBeforeAdmission = isRefusedBeforeAdmission(raised);
evidence.admissionAttempted = draft.admissionAttempted;
evidence.submittedText = draft.submittedText;

/*
 * The box, seeded with what the refused send carried - the ONE piece of state
 * this harness sets rather than drives. See the module comment: without it the
 * hint's own condition is unsatisfied for every case, and the busy frame would
 * show nothing to compare against.
 */
useConversationInputStore.setState({
	inputByConversation: {
		[CONVERSATION]: {
			currentInput: draft.submittedText ?? TEXT,
			submittedMessages: [],
			currentHistoryIndex: null,
			replies: [],
			attachments: [{ id: "harness-screenshot", path: IMAGE_DATA_URL }],
		},
	},
});

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
	 * wins over the persisted row (`activeError = sendError || draft?.error`) and
	 * the code is what decides the hint
	 * (`activeErrorCode = sendErrorCode ?? draft?.errorCode`). Here both come
	 * from the row, because the refusal was produced by the store.
	 */
	const sendError = {
		message: draft.error,
		withholdRetryHint: withholdsRetryHint(draft.errorCode),
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
 */
requestAnimationFrame(() =>
	requestAnimationFrame(() => {
		const region = document.querySelector('[role="alert"]');
		evidence.alertText = region
			? (region.textContent ?? "").replace(/\s+/g, " ").trim()
			: null;
	}),
);
