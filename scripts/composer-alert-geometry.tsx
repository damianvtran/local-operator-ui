/**
 * Rendered-geometry harness: the composer's alert region at a chosen column
 * width.
 *
 * See `composer-alert-geometry.html` for why this page exists rather than a
 * story or a live-app capture. What it mounts is the SHIPPED `MessageInput`,
 * with the app's own stylesheet, palette and font faces, in one of three
 * states, at the column width the driver names:
 *
 *   - `idle`       no failure at all: the baseline the composer's top border is
 *                  measured against, since the region's cap exists to keep that
 *                  border and the send control on screen.
 *   - `unreadable` the unreadable-attachment refusal alone, which is the
 *                  one-sentence state the cap was originally written for.
 *   - `split`      that same refusal with a SPLIT ADOPTION under it: the refused
 *                  text comes back into the box while the chip row already holds
 *                  the user's own file, so the muted split notice renders too.
 *                  That is the two-sentence state this delta added and the one
 *                  D12 is about.
 *
 * `isSmallView` is not passed in by the driver. This page runs the app's own
 * rule - a ResizeObserver on the column, `contentRect.width < 550`, copied from
 * `chat-content.tsx` - so the compaction the app applies at a narrow column
 * (the region's `px-2 pb-1`, the composer's tighter padding and gaps) is a
 * function of the measured column rather than a second copy of the threshold
 * here that could drift from it.
 */

import {
	type ComposerSendError,
	MessageInput,
} from "@renderer/features/chat/components/message-input";
import type { Message } from "@renderer/features/chat/types/message";
import { unreadableAttachmentRefusal } from "@renderer/features/chat/utils/attachment-read";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import {
	DEFAULT_THEME,
	applyThemeToDocument,
	getTheme,
} from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "./composer-alert-geometry.css";

const params = new URLSearchParams(window.location.search);
const COLUMN = Number(params.get("w") ?? 172);
const STATE = params.get("state") ?? "split";
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
 * The refused payload's own text: what the adoption writes back into the box.
 *
 * ONE LINE deliberately. The box's own height moves with the draft it holds -
 * a two-line draft makes the textarea taller, which lifts the composer's top
 * border - and the invariant D12's fix must not disturb is about the ALERT's
 * contribution: the composer's border stays where it is however much the region
 * above it holds, because the region is capped and the band is bottom-anchored.
 * A multi-line draft here would confound the two, and the captured frames of
 * the real app show the restored draft at one line anyway.
 */
const REFUSED_TEXT = "/usage - a refused message whose text came back";

/** The files the refused send carried. Under `split`, NONE of them come back. */
const REFUSED_FILES = ["/tmp/notes.png", "/tmp/screenshot.png"];

/** The file the user had already attached themselves, which keeps the chip row. */
const OWN_CHIP = "/tmp/mine.txt";

const unreadableMessage = (): string | undefined =>
	unreadableAttachmentRefusal(["/tmp/uxr5-missing.png"]) ?? undefined;

const STATES: Record<
	string,
	{
		sendError: ComposerSendError | undefined;
	}
> = {
	idle: { sendError: undefined },
	unreadable: {
		sendError: {
			message: unreadableMessage(),
			// What the refusal's own code withholds in the app
			// (`withholdsRetryHint`): the retry is refused for the same reason
			// until the chip is replaced or removed.
			withholdRetryHint: true,
		},
	},
	split: {
		sendError: {
			message: unreadableMessage(),
			withholdRetryHint: true,
			refusedText: REFUSED_TEXT,
			refusedAttachments: REFUSED_FILES,
		},
	},
};

const state = STATES[STATE];
if (!state) throw new Error(`unknown state \`${STATE}\``);

/*
 * A KNOWN chip row, every load.
 *
 * The store persists through `localStorage`, and every case in one driver run
 * shares an origin: without the reset, the chip seeded for the previous case is
 * still in the row when the next one loads, so the state this harness claims to
 * render - a row holding ONE file of the user's own - is true only for the first
 * case of a run, and the row's extra tile also makes the composer taller, which
 * moves the very border the border assertion measures.
 */
useConversationInputStore.setState({ inputByConversation: {} });

/*
 * The chip the user attached themselves, seeded BEFORE the first render so the
 * adoption's own effect sees the row it has to work around. Seeded through the
 * store's shipped action rather than by handing the composer a list, because
 * the row is what the adoption reads and what the next send carries.
 */
if (STATE === "split")
	useConversationInputStore
		.getState()
		.addAttachment(CONVERSATION, { id: "harness-chip", path: OWN_CHIP });

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
				{/* Bottom-anchored, like the app's own band: the alert sits above the
				    composer, so the region grows UPWARD into the transcript and the
				    composer's top border does not move as it fills. */}
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
