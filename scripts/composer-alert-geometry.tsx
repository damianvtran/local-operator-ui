/**
 * Rendered-geometry harness: the composer's notice at a chosen column width.
 *
 * See `composer-alert-geometry.html` for why this page exists rather than a story
 * or a live-app capture. What it mounts is the SHIPPED `MessageInput`, with the
 * app's own stylesheet, palette and font faces, in one of three states, at the
 * column width the driver names:
 *
 *   - `idle`   the draft a failed send leaves - the message and its files back in
 *              the composer - with NO notice at all. It is the baseline every
 *              other state is compared against, and it holds the SAME draft, so
 *              the only thing that differs between it and the states below is the
 *              notice.
 *   - `notice` that same draft under the unknown-outcome notice ("Couldn't
 *              confirm your message was sent."), which is the sentence the
 *              operator photographed and the one with the most controls (Retry
 *              and Clear).
 *   - `muted`  that same draft under the muted send-lock notice, which is a
 *              statement of fact with no controls at all.
 *
 * AND THE ARMS THE NOTICE TABLE'S OTHER ROWS PRODUCE (review round 1, D3/D4 and
 * the evidence sweep below): `unreachable` (nothing answered), `too-large` and
 * `too-long` (the two real budget sentences - the transport's own backstop and the
 * renderer's pre-flight, taken from the code that writes them rather than retyped,
 * because the set used to show a shorter sentence the app never produces), `gone`
 * (the conversation does not exist) and `delivered` (the muted late-confirmation
 * line over the draft the user edited while the message was in flight). Each is
 * rendered by the SHIPPED composer from the same `sendError` contract the pane
 * passes, so what the frame shows is what the app paints for that arm.
 *
 * WHAT CHANGED HERE, AND WHY THE OLD STATES ARE GONE. This page used to render
 * the held-claim screen: a refusal plus the "split adoption" where the refused
 * text and files came back into `heldText`/`heldAttachments` props, under an
 * alert region capped at 7.5rem that scrolled internally. The payload is no
 * longer held anywhere, so the props are gone and the draft now arrives the way
 * the app delivers it - written into the composer's own store row by the return
 * path, which is where the box reads its text and its chips. The cap is gone with
 * it, and the claim this page measures changed with the design: not "what
 * survives the cap" but "does the notice move the line the user is typing".
 *
 * `isSmallView` is not passed in by the driver. This page runs the app's own
 * rule - a ResizeObserver on the column, `contentRect.width < 550`, copied from
 * `chat-content.tsx` - so the compaction the app applies at a narrow column is a
 * function of the measured column rather than a second copy of the threshold
 * here that could drift from it.
 */

import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import {
	type ComposerSendError,
	MessageInput,
} from "@renderer/features/chat/components/message-input";
import type { Message } from "@renderer/features/chat/types/message";
import { messageBudgetRefusal } from "@renderer/features/chat/utils/message-budget";
import {
	SEND_FAILURE_COPY,
	normalizeSendText,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { DEFAULT_THEME, applyThemeToDocument, getTheme } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
	DESKTOP_MESSAGE_MAX_CHARS,
	DESKTOP_REQUEST_TOO_LARGE_DETAIL,
} from "@contract/desktop-contract";
import "./composer-alert-geometry.css";

const params = new URLSearchParams(window.location.search);
const COLUMN = Number(params.get("w") ?? 172);
const STATE = params.get("state") ?? "notice";
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;

applyThemeToDocument(THEME);

/**
 * The desktop bridge, installed at module scope.
 *
 * The composer reaches the bridge from a passive effect on mount (the platform
 * it renders the send chord for, and the native dialog behind attach), and the
 * renderer global the app's preload writes is absent on a plain page. A wrapper
 * component cannot supply it: React runs a CHILD's effects before its parent's,
 * so a stub installed by a frame around `MessageInput` arrives one commit too
 * late (measured in the story's own comment on this trap).
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

/**
 * The sentinel the story uses: the band's only question is whether anything is
 * painted above the composer, and `[]` would photograph the empty-chat greeting
 * over a conversation that has already started.
 */
const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

const CONVERSATION = "composer-alert-geometry";

/**
 * The failed send's own payload: what the return path puts back in the composer.
 *
 * ONE LINE deliberately. The box's own height moves with the draft it holds - a
 * two-line draft makes the textarea taller - and the invariant this page exists
 * to measure is about the NOTICE's contribution, so the draft is identical in all
 * three states and therefore cannot confound the comparison. A multi-line draft
 * would move the box's top on its own, which is the composer behaving correctly
 * and has nothing to do with the notice.
 */
const RETURNED_TEXT = normalizeSendText(
	"look at this screenshot - the message a failed send put back",
);

/**
 * What the box holds in the late-confirmation state: the user typed on while the
 * message was in flight, so the app cannot empty the box for them and says the
 * earlier message arrived instead.
 */
const EDITED_TEXT = normalizeSendText(
	"and here is the follow-up I typed after it",
);

/** The file the failed send carried, which comes back with the text. */
const RETURNED_CHIP = "/tmp/notes.png";

/**
 * The two budget sentences, from the code that writes them.
 *
 * `DESKTOP_REQUEST_TOO_LARGE_DETAIL` is the transport's backstop for a body that
 * reached the request layer, and `messageBudgetRefusal` is the renderer's own
 * pre-flight, which is the copy the user actually sees for a pasted document. The
 * design round found the set showing a SHORTER sentence than either (D3), so both
 * are imported here rather than written out: a frame can only be about the app's
 * copy if the app's copy is the input.
 */
const TOO_LARGE = DESKTOP_REQUEST_TOO_LARGE_DETAIL;
const TOO_LONG = messageBudgetRefusal(
	"x".repeat(DESKTOP_MESSAGE_MAX_CHARS + 1),
	[],
) as string;

const STATES: Record<
	string,
	{ sendError: ComposerSendError | undefined; draft?: string }
> = {
	idle: { sendError: undefined },
	notice: {
		sendError: {
			message: SEND_FAILURE_COPY.unconfirmed,
			retry: true,
			onRetry: () => {},
			onClear: () => {},
		},
	},
	muted: { sendError: { message: SEND_FAILURE_COPY.sendLock, muted: true } },
	/*
	 * Nothing answered: the same two controls, because the press is safe (the same
	 * id replays) and the sentence says the message may not have gone.
	 */
	unreachable: {
		sendError: {
			message: SEND_FAILURE_COPY.unreachable,
			retry: true,
			onRetry: () => {},
			onClear: () => {},
		},
	},
	/*
	 * The two size refusals, and neither offers Retry: the message cannot leave as
	 * it stands, so the only honest control is the way out.
	 */
	"too-large": {
		sendError: { message: TOO_LARGE, retry: false, onClear: () => {} },
	},
	"too-long": {
		sendError: { message: TOO_LONG, retry: false, onClear: () => {} },
	},
	/* The conversation is gone, so nothing can be pressed but Clear. */
	gone: {
		sendError: {
			message: SEND_FAILURE_COPY.gone,
			retry: false,
			onClear: () => {},
		},
	},
	/*
	 * THE LATE CONFIRMATION over the draft the user edited while it was in flight:
	 * muted, no controls, and the user's own words in the box - which is the state
	 * the muted register exists for (the box cannot be cleared for them, so the
	 * sentence says what happened instead).
	 */
	"edited-idle": { sendError: undefined, draft: EDITED_TEXT },
	delivered: {
		sendError: { message: SEND_FAILURE_COPY.lateDelivery, muted: true },
		draft: EDITED_TEXT,
	},
};

const state = STATES[STATE];
if (!state) throw new Error(`unknown state \`${STATE}\``);

/*
 * The draft, in the composer's OWN store, for every state.
 *
 * Written here rather than handed to the component, because the row is what the
 * box renders and what the next send carries: this is the store a failed send
 * writes through (`returnInFlight`), so a page that staged the draft any other
 * way would be measuring a composer the app cannot produce.
 *
 * `localStorage` is cleared first: the store persists, and every case in one
 * driver run shares this origin, so without the reset the previous case's chip
 * would still be in the row - and the row's extra tile makes the composer taller,
 * which moves the very border this page measures.
 */
useConversationInputStore.setState({ inputByConversation: {} });
useConversationInputStore.getState().addAttachment(CONVERSATION, {
	id: "returned-chip",
	path: RETURNED_CHIP,
});
useConversationInputStore
	.getState()
	.setCurrentInput(CONVERSATION, state.draft ?? RETURNED_TEXT);

const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const Harness = () => {
	const columnRef = useRef<HTMLDivElement>(null);
	const [isSmallView, setIsSmallView] = useState(false);

	// The app's rule, on the app's element: `chat-content.tsx` observes the chat
	// container and compacts below 550px.
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

	return (
		<div
			ref={columnRef}
			className="mx-auto"
			style={{ width: COLUMN }}
			data-lo-geometry-column={COLUMN}
		>
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId={CONVERSATION}
				isSmallView={isSmallView}
				onSendMessage={async () => true}
				sendError={state.sendError}
			/>
		</div>
	);
};

createRoot(document.getElementById("root") as HTMLElement).render(
	/* `getTheme` returns the Option, whose `theme` is the MUI theme — the same
	   pairing Storybook's decorator uses, so a component that reads MUI tokens
	   reads the palette this frame claims to be. */
	<MuiThemeProvider theme={getTheme(THEME).theme}>
		<CssBaseline />
		<QueryClientProvider client={client}>
			<MemoryRouter>
				{/* Bottom-anchored, like the app's own band: the notice sits above the
				    box, so the notice grows UPWARD into the transcript and the line the
				    user is typing does not move as it appears. That is the claim this
				    page exists to put a number on. */}
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
