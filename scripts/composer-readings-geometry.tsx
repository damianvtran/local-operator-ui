/**
 * Rendered-geometry harness: the composer row's readings strip against its
 * controls, at a chosen column width.
 *
 * See `composer-readings-geometry.html` for why this page exists rather than a
 * story or a live-app capture. What it mounts is the SHIPPED `MessageInput`, with
 * the app's own stylesheet, palette and font faces, in one of two states, at the
 * column width the driver names, with the readings cluster in one of two
 * fixtures:
 *
 *   - `idle`     the settled row between turns on a backend that has negotiated
 *                `session_interrupt`: mic + Send (two 32px boxes) beside the
 *                readings. This is the state the existing shed band
 *                (`@min-[750px]/chatcol:@max-[860px]/chatcol:hidden`) was derived
 *                for.
 *   - `running`  the same row while a turn is in flight, where `canonicalStop`
 *                is active and the third danger Square is drawn: mic + Stop +
 *                Send (three boxes). Issue #788 is that the existing band was
 *                derived against the two-box row, so above 860px the duration
 *                reading returns and overruns the controls.
 *
 * The two readings fixtures answer the second half of the derivation. The strip's
 * own comment states the threshold is the width at which the FULLEST state fits,
 * "not the plainest", and names that state: `estimate` beside the context reading
 * plus a four-digit spend. `plain` is the cheaper state, so measuring both is
 * what shows the widest state is the one the threshold has to be set from.
 *
 * WHAT IS DELIBERATELY NOT HERE. The post-stop GRACE window's reserved slot
 * (`data-interrupt-slot`) is not mounted as a third state, and it is not reachable
 * by a mount: the reservation opens on a TRANSITION (the Stop control leaving the
 * tree) and a freshly mounted composer holds nothing - the composer's own comment
 * on `StopSlotSettled` says exactly that, and `useInterruptSlotHold`'s fold fires
 * on the edge rather than on the render. The window's geometry is the SAME third
 * 32px box as `running`'s (`visibility: hidden` keeps layout, which is the whole
 * point of rendering the Stop's own markup invisible), so the running row is the
 * measurement and the grace window is the same measurement one edge later. The
 * recording state (`isRecording` swaps the mic for a confirm/cancel pair) is the
 * third composition that also draws three boxes; it is not mounted here because
 * forcing a live recorder needs the Radient credential path this harness does not
 * arm, and the shed predicate the fix threads is computed from the same terms the
 * row draws the third box from, so the recording case is covered by the predicate
 * rather than by a third frame.
 *
 * `isSmallView` is not passed in by the driver. This page runs the app's own rule -
 * a ResizeObserver on the column, `contentRect.width < 550`, copied from
 * `chat-content.tsx` - so the compaction the app applies at a narrow column is a
 * function of the measured column rather than a second copy of the threshold here
 * that could drift from it.
 */

import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import type { DirectoryWritePath } from "@renderer/features/chat/components/directory-indicator";
import type { Message } from "@renderer/features/chat/types/message";
import { MessageInput } from "@renderer/shared/components/composer/message-input";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { DEFAULT_THEME, applyThemeToDocument, getTheme } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { CanonicalFrontendState } from "../src/shared/desktop-session-contract";
import "./composer-readings-geometry.css";
import "@renderer/features/chat/components/story-electron-shim";

const params = new URLSearchParams(window.location.search);
const COLUMN = Number(params.get("w") ?? 1024);
const STATE = params.get("state") ?? "running";
const READINGS = params.get("readings") ?? "plain";
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;

applyThemeToDocument(THEME);

/**
 * The sentinel the composer's own stories use: the row's only question here is
 * whether a conversation exists, and `[]` would paint the empty-chat greeting
 * over a band that is not empty.
 */
const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

const CONVERSATION = "composer-readings-geometry";

/**
 * The cwd chip, writable, so the row carries the chip group the strip's threshold
 * arithmetic budgets for ("the chip group (304)"). A read-only chip is a
 * different, shorter box, and the row this measures is the one with the editable
 * chip - the same one `CwdChipEditableWithReadings` frames.
 */
const MOVING_CWD: DirectoryWritePath = {
	kind: "move",
	commit: async () => ({
		kind: "settled",
		receipt: {
			cwd: "/Users/you/Downloads",
			label: "~/Downloads",
			outcome: "cold",
			will_wait: false,
		},
		sentence: "moved to ~/Downloads",
	}),
};

/**
 * The model spec, in the app's own shape.
 *
 * TWO OF THEM, because the model reading is the one item that yields and its width
 * is what the shed threshold trades against. `MODEL_SHORT` renders a short
 * aggregator selector at its natural width; `MODEL_LONG` renders a `claude-*`
 * selector, which truncates to the reading's `min-w-14` floor (56px) - the state
 * issue #788 was reported in ("the model chip sits at its `min-w-14` floor showing
 * `Claud…`"), and therefore the state the threshold has to be derived against.
 */
const MODEL_SHORT = {
	provider: "openrouter",
	model_id: "openai/gpt-5-mini",
	display_name: "OpenAI: GPT-5 mini",
	reasoning: true,
	reasoning_effort: "medium",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

const MODEL_LONG = {
	provider: "openrouter",
	model_id: "anthropic/claude-sonnet-4-5",
	display_name: "Anthropic: Claude Sonnet 4.5",
	reasoning: true,
	reasoning_effort: "high",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

/**
 * The three readings fixtures, and each answers a different question.
 *
 * `plain`   a short model name, a three-digit spend, a measured context reading
 *           and a six-minute duration - the cheap end of the cluster.
 * `issue`   THE REPORTER'S OWN STATE, from issue #788's repro: a `claude-*`
 *           selector (so the name truncates to its 56px floor), a `$190.85`
 *           spend and a 20h active time. It is the state the defect is
 *           reproduced in, and the only one whose claim is "the app really paints
 *           this".
 * `fullest` `issue` PLUS the `estimate` word beside the context reading, which
 *           the strip's own comment names as the widest state and the one the
 *           threshold has to be derived from ("the state that sets it is
 *           `estimate` plus a four-digit cost"). It is a superset of `issue`, so a
 *           threshold that fits `fullest` fits the reporter's state too.
 *
 * The banked duration is non-zero in every fixture, because the reading has to
 * EXIST for the shed to be observable at all; a fixture with no duration would
 * photograph a row with nothing to shed. `estimate` is the one field where
 * `fullest` differs from `issue` in the CLUSTER's width, and `active_duration_s`
 * differs between `plain` and `issue` only in the glyph count of the duration
 * reading itself.
 */
const READINGS_FIXTURES: Record<string, CanonicalFrontendState> = {
	plain: {
		context_tokens: 41_000,
		context_window: 400_000,
		context_is_estimate: false,
		cumulative_parent_cost: 2.41,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "floor",
		selected_model: MODEL_SHORT,
		effective_model: MODEL_SHORT,
		active_duration_s: 372,
		activity_started_at: null,
	} as CanonicalFrontendState,
	issue: {
		context_tokens: 264_000,
		context_window: 400_000,
		context_is_estimate: false,
		cumulative_parent_cost: 190.85,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "exact",
		selected_model: MODEL_LONG,
		effective_model: MODEL_LONG,
		active_duration_s: 72_000,
		activity_started_at: null,
	} as CanonicalFrontendState,
	fullest: {
		context_tokens: 264_000,
		context_window: 400_000,
		context_is_estimate: true,
		cumulative_parent_cost: 190.85,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "exact",
		selected_model: MODEL_LONG,
		effective_model: MODEL_LONG,
		active_duration_s: 72_000,
		activity_started_at: null,
	} as CanonicalFrontendState,
};

const frontend = READINGS_FIXTURES[READINGS];
if (!frontend) throw new Error(`unknown readings fixture \`${READINGS}\``);

const sessionStatus = { frontend };

/*
 * The composer's own store, cleared first: it persists to `localStorage` and
 * every case in one driver run shares this origin, so a previous case's draft
 * would otherwise still be in the row.
 */
useConversationInputStore.setState({ inputByConversation: {} });

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

	/*
	 * `awaitingReply` is what the app pairs the Stop control with (design round 1,
	 * N1): the control exists only while a turn is in flight, and `busy` is the
	 * same fact that paints the wait line. Photographed without it the row would
	 * read "Ask me for help" - the idle string - under a running Stop.
	 */
	const running = STATE === "running";

	return (
		<div
			ref={columnRef}
			className="@container/chatcol mx-auto"
			style={{ width: COLUMN }}
			data-lo-geometry-column={COLUMN}
		>
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId={CONVERSATION}
				isSmallView={isSmallView}
				cwd="/Users/you"
				cwdWritePath={MOVING_CWD}
				sessionStatus={sessionStatus}
				awaitingReply={running}
				canonicalStopAvailable={true}
				canonicalStop={running ? { active: true, onStop: () => {} } : undefined}
				onSendMessage={async () => true}
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
				{/* Bottom-anchored, like the app's own band: the row sits at the bottom
				    edge of the pane, which is the geometry the app draws. */}
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
