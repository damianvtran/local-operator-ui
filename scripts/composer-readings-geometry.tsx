/**
 * Rendered-geometry harness: the composer row's readings strip against its
 * controls, at a chosen column width.
 *
 * See `composer-readings-geometry.html` for why this page exists rather than a
 * story or a live-app capture. What it mounts is the SHIPPED `MessageInput`, with
 * the app's own stylesheet, palette and font faces, in one of two states, at the
 * column width the driver names, with the readings cluster in one of four
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
 * The readings fixtures answer the second half of the derivation. The strip's
 * own comment states the threshold is the width at which the FULLEST state fits,
 * "not the plainest", and names that state: `estimate` beside the context reading
 * plus a four-digit spend. `plain` is the cheaper state, so measuring both is
 * what shows the widest state is the one the threshold has to be set from.
 * `issue` is the #788 repro and `reported` is the operator's own row from the
 * duration report; the fixture docblock below says what each one is for.
 *
 * THE SLOT STATES (composer button-slot change). `STATE` also names the rest of
 * the matrix the cluster is photographed in, each reached through the SHIPPED
 * composer rather than a prop that fakes it:
 *
 *   idle-text        a draft in the box
 *   running-text     a turn runs and the box holds text (Steer, not Stop)
 *   stopping         the Stop press has landed and the turn has not ended
 *   recording        the mic pressed against a synthetic microphone, so the real
 *                    recorder runs and the row draws its recording controls
 *   mic-off          no speech capability: the mic is drawn disabled
 *   sendrec-hang     recording, then Send recording pressed against a
 *                    transcription that never answers: slot B holds its busy face
 *   sendrec-ok       ... against one that answers: the words are sent
 *   sendrec-empty / sendrec-error
 *                    ... against an empty / failing one: NOTHING is sent
 *
 * The harness serves its own `window.api.desktop.media` (the transcription
 * request) and records what the composer hands `onSendMessage` in `__sent`, so
 * the probe can state what left the box. A scripted press is `element.click()`,
 * which carries `detail === 0` (a keyboard-like activation) and so passes the
 * 500 ms press guard; that guard is measured by its own unit test, not here.
 *
 * WHAT IS DELIBERATELY NOT HERE. The post-stop GRACE window's reserved slot
 * (deleted: Stop now stands in Send's own slot) was never mounted as a third state, and was not reachable
 * by a mount: the reservation opens on a TRANSITION (the Stop control leaving the
 * tree) and a freshly mounted composer holds nothing - the composer's own comment
 * on `StopSlotSettled` says exactly that, and the hold's fold fired
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
 *
 * `measure` IS AN OPTIONAL DRIVER PARAMETER, and it exists because the row's
 * width is not a function of the column alone: the composer box is capped at
 * `--lo-chat-measure` (810px shipped, `styles/index.css`), and the operator's
 * own report is at a widened measure. The operator's composer box measures
 * 918px, so their row is ~886px while the shipped default draws 778px at the
 * same 1024px column. The driver's `--measure=<px>` sets the same custom
 * property the app's own story sets (`chat-measure.stories.tsx`), on this
 * column, so the widened row is a measurement rather than arithmetic; absent,
 * the shipped 810px value stands and the case id carries no measure suffix.
 */

import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import type { DirectoryWritePath } from "@renderer/features/chat/components/directory-indicator";
import type { Message } from "@renderer/features/chat/types/message";
import { MessageInput } from "@renderer/shared/components/composer/message-input";
import { registerCatalogue, setLocale, t } from "@shared/i18n";
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
const DRAFT_TEXT = "Summarise the Q3 report and flag anything unusual";
const TRANSCRIPT_TEXT = "and email it to the team";
const TEXT_STATES = new Set([
	"stop-cleared",
	"stop-after-send",
	"idle-text",
	"running-text",
	"sendrec-ok",
	"sendrec-empty",
	"sendrec-error",
	"sendrec-hang",
	"sendrec-running",
]);
const RUNNING_STATES = new Set([
	"stop-cleared",
	"stop-after-send",
	"running",
	"running-text",
	"stopping",
	"sendrec-running",
]);
const RECORDING_STATES = new Set([
	"recording",
	"sendrec-running",
	"sendrec-ok",
	"sendrec-empty",
	"sendrec-error",
	"sendrec-hang",
]);
const sttMode = (): "ok" | "empty" | "error" | "hang" =>
	STATE === "sendrec-empty"
		? "empty"
		: STATE === "sendrec-error"
			? "error"
			: STATE === "sendrec-hang"
				? "hang"
				: "ok";
type HarnessWindow = Window & {
	__sent?: { content: string; attachments: string[] }[];
	__transcriptionCalls?: number;
	/** Slot B's accessible name sampled every 10 ms from the press of Send recording on. */
	__bTimeline?: string[];
};

/*
 * The transcription request, served by the page. `desktopMedia` prefers
 * `window.api.desktop.media` when it exists, so this is the seam the real
 * composer already uses; nothing in the composer is stubbed.
 */
(window as HarnessWindow).__sent = [];
(window as HarnessWindow).__transcriptionCalls = 0;
(window as unknown as { api: unknown }).api = {
	desktop: {
		media: async () => {
			(window as HarnessWindow).__transcriptionCalls =
				((window as HarnessWindow).__transcriptionCalls ?? 0) + 1;
			const mode = sttMode();
			if (mode === "hang") return new Promise(() => {});
			await new Promise((r) => setTimeout(r, 120));
			if (mode === "error")
				return { status: 402, kind: "error", detail: "Out of credits" };
			return {
				status: 200,
				kind: "json",
				body: { result: { text: mode === "empty" ? "" : TRANSCRIPT_TEXT } },
			};
		},
	},
};

/* A synthetic microphone: the composer's real MediaRecorder runs against it. */
if (navigator.mediaDevices) {
	const keep: AudioContext[] = [];
	navigator.mediaDevices.getUserMedia = async () => {
		// `preparing` is the window BEFORE the recorder exists: hold it open.
		if (STATE === "preparing") return new Promise<MediaStream>(() => {});
		const context = new AudioContext();
		keep.push(context);
		const oscillator = context.createOscillator();
		const destination = context.createMediaStreamDestination();
		oscillator.connect(destination);
		oscillator.start();
		return destination.stream;
	};
}
const READINGS = params.get("readings") ?? "plain";
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;
/*
 * `null` means "the shipped measure". A number is an override in px, and the
 * driver only names it when it wants the widened operator row; see the header.
 */
const MEASURE_PARAM = Number(params.get("measure") ?? 0);
const MEASURE = MEASURE_PARAM > 0 ? MEASURE_PARAM : null;
/*
 * THE ROW'S DIRECTION. `ur` is a shipped locale and `dir="rtl"` mirrors the
 * composer row, so a fit rule that only reads physical edges passes every LTR
 * frame and hides the reading in that locale. This is the driver's hook for
 * photographing that case: `--dir=rtl` sets the document's direction on the
 * harness's own wrapper, and the strip resolves it with `getComputedStyle`.
 */
const DIR = params.get("dir") === "rtl" ? "rtl" : "ltr";
/*
 * THE HOST'S ANCHOR. The chat band is bottom-anchored (the card grows UP), but
 * some hosts mount the composer from the top of their pane (`--anchor=top`: the
 * card grows DOWN, so a state that adds a row under the field moves the controls
 * by the card's growth). The vertical numbers in \`composer-slots-proof.mjs\` are
 * only meaningful against the anchor they were taken with.
 */
const ANCHOR = params.get("anchor") === "top" ? "top" : "bottom";

/*
 * THE COPY'S LANGUAGE (`--locale=fr`): the longest shipped strings are what the
 * recording hint line and the caption row have to fit, and `en` is the shortest
 * case. Only the composer's own two namespaces are registered; everything else
 * falls through to the bundled en map, per key.
 */
const LOCALE = params.get("locale");
if (LOCALE) {
	const catalogues = {
		...(import.meta.glob("../src/i18n/catalogues/*/ui.chat.composer.json", {
			eager: true,
			import: "default",
		}) as Record<string, Record<string, string>>),
		...(import.meta.glob(
			"../src/i18n/catalogues/*/ui.chat.composer_media.json",
			{ eager: true, import: "default" },
		) as Record<string, Record<string, string>>),
	};
	for (const [path, messages] of Object.entries(catalogues)) {
		if (path.includes(`/catalogues/${LOCALE}/`))
			registerCatalogue(LOCALE, messages);
	}
	setLocale(LOCALE);
}

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

/*
 * The operator's model, in the app's own shape.
 *
 * `deepseek` is a DIRECT provider (not in `AGGREGATOR_PROVIDERS`), so the chip
 * prints the listing name rather than refusing it: `DeepSeek Flash` is exactly
 * what the reporting row shows, and it is SHORTER than the `claude-*` id
 * `issue` truncates to its 56px floor. That difference is why this fixture is
 * kept beside `issue` - the row being fixed has to fit a name drawn at its
 * natural width, not at its narrowest.
 *
 * `reasoning_effort: "max"` is the load-bearing field: it is the `Max` the row
 * reports. The rung list is carried so the reading is the ordinary adjustable
 * chip rather than a plain label; its exact contents are not what this harness
 * measures.
 */
const MODEL_REPORTED = {
	provider: "deepseek",
	model_id: "deepseek-flash",
	display_name: "DeepSeek Flash",
	reasoning: true,
	reasoning_effort: "max",
	reasoning_efforts: ["minimal", "low", "medium", "high", "max"],
	reasoning_default_effort: null,
	context_window: 1_000_000,
	max_context_window: null,
};

/**
 * The four readings fixtures, and each answers a different question.
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
 * `reported` THE OPERATOR'S OWN ROW, from the report that opened this change:
 *           display name `DeepSeek Flash`, effort `Max`, a MEASURED
 *           `13.1%/1M` context reading, `$0.346` of spend and 20m25s banked.
 *           It is the state the missing duration was reported in, and unlike
 *           `issue` its model name is short enough not to sit at the chip's
 *           floor - so it is the row a fix has to fit with the name drawn at
 *           its natural width, not at its narrowest.
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
	/*
	 * THE OPERATOR'S OWN ROW, `DeepSeek Flash · Max · 13.1%/1M · $0.346` while a
	 * turn runs. 131,000 tokens is the measured figure behind 13.1% of a 1M
	 * window, and `context_is_estimate` is false because that is the provider's
	 * receipt rather than the harness's estimate - the `estimate` word is
	 * `fullest`'s job. 1,225 seconds is the 20m25s the row shows, and
	 * `activity_started_at` is null so the reading is the banked number rather
	 * than a live-ticking one (every case here must photograph a stable frame).
	 */
	reported: {
		context_tokens: 131_000,
		context_window: 1_000_000,
		context_is_estimate: false,
		cumulative_parent_cost: 0.346,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "exact",
		selected_model: MODEL_REPORTED,
		effective_model: MODEL_REPORTED,
		active_duration_s: 1225,
		activity_started_at: null,
	} as CanonicalFrontendState,
};

/*
 * `borrowed` is `fullest` on a REMOTE session running on healthy borrowed
 * access (PR #1871): the strip then carries the `i` access readout after the
 * effort chip, an in-flow box the ladder has to account for. It is a superset
 * of `fullest`, so the rungs measured on it are the ones the access state's
 * half of each shed class is set from. Synthetic owner, no key material.
 */
READINGS_FIXTURES.borrowed = {
	...READINGS_FIXTURES.fullest,
	model_access: {
		state: "ok",
		effective_state: "effective_borrow",
		provider: "openrouter",
		label: "OpenRouter",
		owner_device: "synthetic-owner",
		owner_label: "Work laptop",
		observed_at: 1700000000,
		last_grant_at: 1699999900,
		last_grant_expires_at: 1699999950,
	},
} as CanonicalFrontendState;

const frontend = READINGS_FIXTURES[READINGS];
if (!frontend) throw new Error(`unknown readings fixture \`${READINGS}\``);

const sessionStatus = { frontend };

/*
 * The composer's own store, cleared first: it persists to `localStorage` and
 * every case in one driver run shares this origin, so a previous case's draft
 * would otherwise still be in the row.
 */
useConversationInputStore.setState({ inputByConversation: {} });
if (TEXT_STATES.has(STATE)) {
	useConversationInputStore
		.getState()
		.setCurrentInput(CONVERSATION, DRAFT_TEXT);
}

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
	const running = RUNNING_STATES.has(STATE);
	const stopping = STATE === "stopping";
	const recordingProbe =
		STATE === "mic-off"
			? undefined
			: { canUseRadientSpeech: true, speechBlock: "checking" as const };

	/*
	 * The scripted presses that bring the shipped composer to a recording state.
	 * Marks the document ready when the script is done so the driver measures a
	 * settled frame and never a half-way one.
	 */
	useEffect(() => {
		const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
		// The controls are found by accessible name, and that name is the shipped
		// copy in whatever locale `--locale` registered: the scripted presses read
		// it through `t()`, so a French run clicks the French controls.
		const NAMES: Record<string, string> = {
			"Start recording": t("ui.chat.composer.start_recording"),
			"Send recording": t("ui.chat.composer.send_recording"),
			"Insert transcript": t("ui.chat.composer.insert_transcript"),
			"Send message": t("ui.chat.composer.send_message"),
			Stop: t("ui.chat.composer.stop"),
		};
		const button = (key: string) => {
			const label = NAMES[key] ?? key;
			return document.querySelector<HTMLButtonElement>(
				`[data-lo-composer-controls] button[aria-label="${label}"]`,
			);
		};
		const until = async (label: string) => {
			for (let i = 0; i < 40 && !button(label); i += 1) await wait(50);
			const found = button(label);
			if (!found) throw new Error(`no control named ${label}`);
			return found;
		};
		let cancelled = false;
		(async () => {
			await wait(250);
			if (STATE === "preparing") {
				(await until("Start recording")).click();
				await wait(500);
			}
			/*
			 * STOP ARRIVAL, two ways. `stop-cleared`: the box is emptied while a turn
			 * runs, so Steer becomes Stop with no press on this slot - the guard must
			 * stay OPEN (opacity 1). `stop-after-send`: Send is pressed with the turn
			 * running, the slot passes through its held face and lands on Stop - the
			 * guard is ARMED, and the frame is taken inside the window (opacity ramp).
			 */
			if (STATE === "stop-cleared") {
				// Through the DOM, as a person clearing the box does: the composer owns
				// its text, and the store write alone leaves the textarea as it was.
				const area = document.querySelector("textarea");
				if (area) {
					const set = Object.getOwnPropertyDescriptor(
						HTMLTextAreaElement.prototype,
						"value",
					)?.set;
					set?.call(area, "");
					area.dispatchEvent(new Event("input", { bubbles: true }));
				}
				await wait(60);
			}
			if (STATE === "stop-after-send") {
				const timeline: string[] = [];
				(window as HarnessWindow).__bTimeline = timeline;
				const sampler = setInterval(() => {
					const b = document.querySelector(
						'[data-lo-composer-controls] [data-composer-slot="b"]',
					);
					const label = `${b?.getAttribute("aria-label") ?? "(none)"}@${getComputedStyle(b ?? document.body).opacity}`;
					if (timeline[timeline.length - 1] !== label) timeline.push(label);
				}, 5);
				setTimeout(() => clearInterval(sampler), 3000);
				(await until("Send message")).click();
				for (let i = 0; i < 100 && !button("Stop"); i += 1) await wait(10);
				await wait(60);
			}
			if (RECORDING_STATES.has(STATE)) {
				(await until("Start recording")).click();
				// Past the composer's 250 ms minimum take, so Confirm keeps it.
				// "Confirm recording" is the base tree's name for the same moment.
				await until("Send recording").catch(() => until("Confirm recording"));
				await wait(450);
				if (STATE.startsWith("sendrec")) {
					const send = button("Send recording");
					const timeline: string[] = [];
					(window as HarnessWindow).__bTimeline = timeline;
					const sampler = setInterval(() => {
						const label =
							document
								.querySelector(
									'[data-lo-composer-controls] [data-composer-slot="b"]',
								)
								?.getAttribute("aria-label") ?? "(none)";
						if (timeline[timeline.length - 1] !== label) timeline.push(label);
					}, 10);
					if (send) send.click();
					setTimeout(
						() => clearInterval(sampler),
						STATE === "sendrec-hang" ? 400 : 1200,
					);
					await wait(STATE === "sendrec-hang" ? 400 : 1200);
				}
			}
			if (!cancelled) document.documentElement.dataset.loReady = "1";
		})().catch((error) => {
			document.documentElement.dataset.loReady = `error: ${error.message}`;
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div
			ref={columnRef}
			className="@container/chatcol mx-auto"
			style={{
				width: COLUMN,
				...(MEASURE === null
					? {}
					: { ["--lo-chat-measure" as string]: `${MEASURE}px` }),
			}}
			data-lo-geometry-column={COLUMN}
			data-lo-geometry-measure={MEASURE ?? "shipped"}
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
				recordingProbe={recordingProbe}
				canonicalStop={
					running ? { active: true, stopping, onStop: () => {} } : undefined
				}
				onSendMessage={async (content, attachments, onEchoPainted) => {
					(window as HarnessWindow).__sent?.push({ content, attachments });
					// The app empties the box when the echo is painted, while the send is
					// still in flight: that is the window the held face exists for.
					onEchoPainted?.();
					// A real send is in flight for a while (the pane's send lock); an
					// instant answer would skip the held face the guard is armed from.
					if (STATE === "stop-after-send")
						await new Promise((resolve) => setTimeout(resolve, 250));
					return true;
				}}
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
					dir={DIR}
					style={{ height: "100vh", display: "flex", flexDirection: "column" }}
					className={`${ANCHOR === "top" ? "justify-start" : "justify-end"} bg-canvas`}
					data-lo-geometry-dir={DIR}
				>
					<Harness />
				</div>
			</MemoryRouter>
		</QueryClientProvider>
	</MuiThemeProvider>,
);
