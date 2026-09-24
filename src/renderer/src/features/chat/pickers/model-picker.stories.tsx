/**
 * `/model` — the desktop model picker, in every state its FEEDBACK can be in.
 *
 * Why this file exists: the operator reports "insufficient feedback on hover,
 * click, etc to indicate that the model selection change has happened". That is
 * a claim about pixels in states that are hard or impossible to reach live — a
 * backend that answers in 40ms, a catalogue that never comes back, a command
 * that is in flight while you look at the row you clicked. So this story drives
 * the PRODUCTION `ModelPicker` (not a story-shaped imitation of it) with the
 * desktop transport stubbed, which is the only part that cannot exist in a
 * browser: `window.api.desktop.request`.
 *
 * What that buys, and its limit. Everything under test is real: the real
 * component, its real `options` mapping from a real-shaped catalogue payload,
 * its real toolbar (the persist checkbox and the refresh button), the real
 * `PickerHost` rows, the real footer, and the real result strip. The stub
 * answers the two operations the picker issues — `models.catalogue` and
 * `sessions.command` — so the frames are evidence about the renderer, not about
 * the backend. Two consequences worth stating rather than hiding:
 *
 *   - `canonical.frontend.selected_model` is a fixture, standing in for the
 *     session frame the owner pushes after a switch. The real app gets it from
 *     the canonical session store.
 *   - The receipt text in `Result` is the wording from the operator's own
 *     screenshot. A live capture would confirm the exact string the owner
 *     returns.
 *
 * The states a reviewer cannot reach any other way, and what each one is for:
 *
 *   - `Loading` — first paint: the catalogue has not answered, so the list is a
 *     centred spinner while the search box is already focused and typeable.
 *   - `Populated` — the resting frame, with the in-force model's indicator.
 *   - `Hovered` / `KeyboardHighlight` — the pointer's mark and the selection,
 *     reached by pointer and by arrow key. Captured as a pair, because whether
 *     the two are distinguishable is the question — and after design D2 they are
 *     two different states, not one state reached two ways: the pointer marks a
 *     row without moving the selection, and its mark clears when it leaves.
 *   - `Busy` — a row has been picked and the command is in flight: the picked
 *     row carries the mark and its own structural edge, the footer says what is
 *     being done to the session (`Switching the model…`, not "waiting for the
 *     backend"), and the right-hand control reads `Close` rather than `Cancel`.
 *   - `Result` — the command answered; the strip is up and the indicator moved.
 *   - `RefreshPending` — `Refresh from providers` clicked: the button says
 *     `Refreshing…` and the rows it already had stay painted.
 *   - `RegistryOnlyOpus` / `ProviderListingOpus` — the same state twice: open,
 *     `opus` typed, one row set from the shipped registry alone and one with the
 *     row the PROVIDER lists that the registry does not hold. The pair is the
 *     operator's report, and the second half reaches it with no click.
 *   - `LiveListingFailed` — that automatic listing failing: the failure is a
 *     NOTE ABOVE rows that are still there, not a wall of error text where the
 *     list was (review round 1, R1-1 / UX U3).
 *   - `PersistChecked` — the checkbox that changes what the pick DOES, with the
 *     label that states the consequence.
 *   - `Empty` / `PartialError` — a query that matches nothing, and a catalogue
 *     that came back with a per-provider failure (which keeps its rows now).
 *   - `Narrow` — the toolbar at the width where its two controls compete.
 */

import type { Meta, StoryObj } from "@storybook/react";
import {
	expect,
	fireEvent,
	screen,
	userEvent,
	waitFor,
	within,
} from "@storybook/test";

const DEFAULT_MODEL_LABEL = /Set current model as default/;
const SAVE_DEFAULT_FAILED = /The default was not saved/;
const EFFORT_DEFAULT_FAILED = /The effort default was not saved/;
const EFFORT_DEFAULT_LABEL = /default effort for new sessions/i;
const EFFORT_DEFAULT_SUCCESS = /Default effort for new sessions: High/;
import type { FC } from "react";
import "../../../styles/index.css";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type {
	DesktopModelCatalogue,
	NativeDesktopAction,
} from "../../../../../shared/desktop-control-contract";
import type { SlashCommandMeta } from "../components/slash-commands";
import {
	EffortPicker,
	ModelPicker,
	type PickerContext,
} from "./destination-pickers";

const noop = () => {};

/** A real-time pause, for the plays that must wait out a layout effect. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MODEL_SPEC: SlashCommandMeta = {
	name: "model",
	description: "Choose the model for this session",
	aliases: [],
	arguments: "optional",
	echo: false,
	consumes_prompt: false,
	destination: "model",
	execution: "owner",
};

const EFFORT_SPEC: SlashCommandMeta = {
	...MODEL_SPEC,
	name: "effort",
	description: "Choose reasoning effort for this session",
	destination: "effort",
};

const MODEL_ACTION: NativeDesktopAction = {
	kind: "native_action",
	destination: "model",
	session_id: "sess",
	args: "",
	fields: [],
	data: {},
};

/* --------------------------------------------------------------- bridge */
/**
 * The desktop transport, stubbed.
 *
 * `desktop-api.desktopRequest` prefers `window.api.desktop.request` and falls
 * back to `fetch("/__desktop")` when it is absent. Storybook's dev server has no
 * such route, so without this every frame would photograph a transport error
 * (or a 30s deadline) instead of the picker. Installing a bridge is therefore
 * what makes the populated states reachable at all.
 */
type BridgeRequest = {
	op: string;
	live?: boolean;
	key?: string;
	value?: unknown;
	command?: string;
};

/** A promise that never settles: the frame is the state while it is pending. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => {});

/**
 * The canonical handle's optimistic paint, recorded for the plays.
 *
 * The band itself is not in this story (it lives in the composer, and
 * `chat-session-status-strip--model-switch-pending` is where its frames are),
 * but the picker's half of U1 IS: the paint must be made before the command is
 * awaited, so a play asserts the call happened while the receipt is still
 * pending. Silent no-ops would make that assertion impossible.
 */
const painted: string[] = [];
const cleared: number[] = [];

const ok = <T,>(result: T): DesktopResponse => ({
	status: 200,
	body: { result },
});

const refuse = (status: number, detail: string): DesktopResponse => ({
	status,
	body: { detail },
});

/** Install the transport a story needs. Called from `render`, before mount. */
const installBridge = (
	next: (request: BridgeRequest) => Promise<DesktopResponse | undefined>,
	commandResponse?: DesktopResponse,
) => {
	if (typeof window !== "undefined") {
		// The page's `window` is not the preload-shaped one here, so the two fields
		// this file adds are declared rather than poked at through `any`.
		const page = window as unknown as {
			api?: {
				desktop?: {
					request: (r: BridgeRequest) => Promise<DesktopResponse | undefined>;
				};
			};
			__pickerCatalogueCalls?: { total: number; live: number };
			__pickerSettingsWrites?: { key: string; value: unknown }[];
		};
		const api = page.api ?? {};
		page.api = api;
		/*
		 * Reset here, at install time, so a frame's count is ITS OWN.
		 *
		 * The field lives on `window`, which Storybook does not re-create between
		 * stories, so a counter that was only ever incremented accumulated every
		 * story's reads into the next one's number - and the numbers this file now
		 * quotes ("the picker asked twice, with no click") have to be about the
		 * frame they are printed under.
		 */
		page.__pickerCatalogueCalls = { total: 0, live: 0 };
		const frameBridge = next;
		api.desktop = {
			request: async (request: BridgeRequest) => {
				// Counted so a frame can state HOW MANY times the catalogue was asked
				// for: react-query refetches on window focus by default, and a
				// refetch re-derives the option list — which is worth knowing when a
				// captured row position does not survive the wait. The `live` half is
				// counted separately because the picker now starts the provider
				// listing BY ITSELF, so "how many catalogue reads happened with no
				// click" is a reading a frame has to be able to back with a number.
				const seen = page.__pickerCatalogueCalls ?? { total: 0, live: 0 };
				page.__pickerCatalogueCalls = seen;
				if (request.op === "models.catalogue") {
					seen.total += 1;
					if (request.live) seen.live += 1;
				}
				if (request.op === "settings.edit") {
					const writes = page.__pickerSettingsWrites ?? [];
					page.__pickerSettingsWrites = writes;
					writes.push({ key: request.key ?? "", value: request.value });
					return frameBridge(request);
				}
				if (
					request.op === "commands.entities" &&
					request.command === "effort" &&
					request.live
				) {
					const response = await frameBridge(request);
					if (response !== undefined) return response;
				}
				if (
					request.op === "commands.entities" &&
					request.command === "effort"
				) {
					return ok({
						entities: [
							{ value: "low", name: "low" },
							{ value: "medium", name: "medium" },
							{ value: "high", name: "high" },
						],
						current: "medium",
					});
				}
				if (request.op === "sessions.command") {
					// A story-specific receipt or pending promise is authoritative. Only an
					// explicit undefined opts into the frame-local ordinary receipt.
					return (
						(await frameBridge(request)) ??
						commandResponse ??
						ok({
							result: {
								kind: "notice",
								text: "Effort set",
								style: "info",
								data: {},
							},
						})
					);
				}
				return frameBridge(request);
			},
		};
	}
};

/* --------------------------------------------------------------- fixtures */

type Row = DesktopModelCatalogue["models"][number];

const row = (
	over: Partial<Row> & { provider: string; model_id: string },
): Row => ({
	selector: `${over.provider}/${over.model_id}`,
	label: over.model_id,
	connected: true,
	context_window: 200_000,
	input_price: 3,
	output_price: 15,
	default_context_window: null,
	max_context_window: null,
	aggregated: false,
	...over,
});

/**
 * A catalogue shaped like the owner's: one family with several siblings, an
 * aggregator row, a free row, a local row that needs no credential, and one
 * provider the credential store does not have.
 */
const CATALOGUE: Row[] = [
	row({
		provider: "anthropic",
		model_id: "claude-opus-5",
		label: "Claude Opus 5",
		input_price: 15,
		output_price: 75,
	}),
	row({
		provider: "anthropic",
		model_id: "claude-sonnet-5",
		label: "Claude Sonnet 5",
	}),
	row({
		provider: "anthropic",
		model_id: "claude-haiku-4-5",
		label: "Claude Haiku 4.5",
		input_price: 1,
		output_price: 5,
	}),
	row({
		provider: "openrouter",
		model_id: "anthropic/claude-haiku-4-5",
		label: "Anthropic: Claude Haiku 4.5",
		aggregated: true,
		context_window: 200_000,
	}),
	row({
		provider: "openai",
		model_id: "gpt-5.4",
		label: "GPT-5.4",
		context_window: 400_000,
		input_price: 1.25,
		output_price: 10,
	}),
	row({
		provider: "openrouter",
		model_id: "google/gemma-4-31b-it:free",
		label: "Google: Gemma 4 31B",
		aggregated: true,
		context_window: 131_072,
		input_price: 0,
		output_price: 0,
	}),
	row({
		provider: "ollama",
		model_id: "qwen3:8b",
		label: "Qwen3 8B",
		context_window: 32_768,
		input_price: 0,
		output_price: 0,
	}),
	row({
		provider: "zai",
		model_id: "glm-5.2",
		label: "GLM-5.2",
		connected: false,
		input_price: 0.6,
		output_price: 2.2,
	}),
	/*
	 * The rows the operator's report was about, carrying the words their OWN
	 * listing publishes — `Grok 4.7` and `GPT-6 Luna`, read out of the
	 * operator's cache (`~/.local-operator/cache/models-dev.listing.json`) — and
	 * not an invented `Vendor: Model` string. Both are AGGREGATOR rows, so the
	 * backend's naming rule degrades their `label` to the selector (a reseller's
	 * name describes the model, not the route, so it is never used for
	 * display — `model/naming.py`), and the listing's own words therefore reach
	 * the filter only through `listing_name`. The `HumanNameSearch` story types
	 * the operator's exact spelling against these.
	 */
	row({
		provider: "openrouter",
		model_id: "x-ai/grok-4.7",
		listing_name: "Grok 4.7",
		aggregated: true,
		context_window: 256_000,
	}),
	row({
		provider: "openrouter",
		model_id: "openai/gpt-6-luna",
		listing_name: "GPT-6 Luna",
		aggregated: true,
		context_window: 400_000,
	}),
	/*
	 * The 5.5 pair, for the spelling the report names second: `opus 5.5` needs a
	 * row the catalogue actually holds under that version. Real ids and real
	 * listing names again (`anthropic/claude-opus-5-5` and its openrouter route,
	 * both named `Claude Opus 5.5`), so the frame answers a query a user can type
	 * rather than the story's spelling of one. `claude-opus-5` above is the
	 * control: a minor bump must not be answered by its own major.
	 */
	row({
		provider: "anthropic",
		model_id: "claude-opus-5-5",
		label: "Claude Opus 5.5",
		listing_name: "Claude Opus 5.5",
		input_price: 15,
		output_price: 75,
	}),
	row({
		provider: "openrouter",
		model_id: "anthropic/claude-opus-5.5",
		listing_name: "Claude Opus 5.5",
		aggregated: true,
	}),
	/*
	 * The name-only row: an aggregator whose listing publishes `Nano Banana` for
	 * `google/gemini-2.5-flash-image` (the operator's cache again), so no word of
	 * the query appears in any id the row carries. This is the one case the
	 * normalisation alone cannot answer, and the reason `listing_name` is a match
	 * input at all.
	 */
	row({
		provider: "openrouter",
		model_id: "google/gemini-2.5-flash-image",
		listing_name: "Nano Banana",
		aggregated: true,
		context_window: 32_768,
	}),
];

/** The model the session is on when the picker opens. */
const CURRENT = { provider: "anthropic", model_id: "claude-opus-5" };

const CURRENT_SELECTOR = `${CURRENT.provider}/${CURRENT.model_id}`;

/** The row the `Busy`/`Result` stories pick. */
const PICKED = {
	provider: "openrouter",
	model_id: "anthropic/claude-haiku-4-5",
};

const EFFORT_ACTION: NativeDesktopAction = {
	...MODEL_ACTION,
	destination: "effort",
};

const catalogue = (
	over: Partial<DesktopModelCatalogue> = {},
): DesktopModelCatalogue => ({
	models: CATALOGUE,
	source: "initial",
	errors: {},
	credentials_known: true,
	...over,
});

/**
 * The operator's report, as the difference between two listings.
 *
 * One question — *which Opus models are there?* — has to be answerable from two
 * row sets, and the pair below is that difference and nothing else. The shipped
 * registry stops at `claude-opus-5` (it holds what the last lop build shipped),
 * while Anthropic's own listing also carries `Claude Opus 5.5`; the report is
 * that the second set existed and the picker could not reach it without a click.
 *
 * The two rows removed from `REGISTRY_ROWS` are the only difference, so a frame
 * showing the extra row is evidence about the LISTING rather than about a
 * longer fixture.
 */
const REGISTRY_ROWS = CATALOGUE.filter(
	(single) => !/opus-5[.-]5/.test(single.model_id),
);
const registryCatalogue = (): DesktopModelCatalogue =>
	catalogue({ models: REGISTRY_ROWS });
const liveCatalogue = (): DesktopModelCatalogue =>
	catalogue({ models: CATALOGUE, source: "live" });

/**
 * The owner's `/model` receipt, worded as the operator's screenshot shows it.
 * `tone` on the picker is derived from `style`/`kind` by `toResult`.
 */
const receipt = (from: string, to: string) => ({
	kind: "notice" as const,
	style: "info" as const,
	text: `model: ${from} → ${to} (this session)`,
	data: {},
});

/* ------------------------------------------------------------- harness */

type FrameProps = {
	/** What the stub answers, and how long it takes to answer it. */
	bridge: (request: BridgeRequest) => Promise<DesktopResponse | undefined>;
	/** Optional frame-local receipt for a command the story leaves unanswered. */
	commandResponse?: DesktopResponse;
	/** The model the session is on (the session frame's stand-in). */
	selected?: { provider: string; model_id: string } | null;
	picker?: "model" | "effort";
};

/**
 * One frame: installs the transport, then renders the PRODUCTION `ModelPicker`.
 *
 * The `PickerContext` carries seven fields and the model picker reads three
 * (`sessionId`, `canonical`, `onClose`); the rest are the dispatcher's, so they
 * are filled here rather than pretended into meaningful values.
 */
const Frame: FC<FrameProps> = ({
	bridge: storyBridge,
	commandResponse,
	selected = CURRENT,
	picker = "model",
}) => {
	installBridge(storyBridge, commandResponse);
	const isEffort = picker === "effort";
	const ctx: PickerContext = {
		action: isEffort ? EFFORT_ACTION : MODEL_ACTION,
		spec: isEffort ? EFFORT_SPEC : MODEL_SPEC,
		sessionId: "sess",
		canonical: {
			frontend: selected ? { selected_model: selected } : null,
			// U1's half that lives in the picker: paint before the await, drop it
			// when the owner refuses. Recorded so a play can assert the order.
			paintPendingModel: (model: { provider: string; model_id: string }) => {
				painted.push(`${model.provider}/${model.model_id}`);
			},
			clearPendingModel: () => {
				cleared.push(painted.length);
			},
		} as unknown as CanonicalSessionHandle,
		commands: [MODEL_SPEC],
		onClose: noop,
		note: noop,
		dispatch: noop,
		rebind: noop,
	};
	return isEffort ? <EffortPicker {...ctx} /> : <ModelPicker {...ctx} />;
};

/**
 * A bridge that answers the catalogue and refuses everything else.
 *
 * The LIVE half answers with `data` by default, and that default is the change
 * the picker made: it now starts the provider listing by itself on open, so a
 * bridge that HELD the live answer pending would leave every story below
 * photographing a listing that is still in flight and a button reading
 * `Refreshing…`. A story that wants that state asks for it explicitly
 * (`RegistryOnlyOpus`, `RefreshPending`), which is also what keeps the two
 * frames of the opus pair a difference between listings rather than between
 * timings.
 */
const catalogueOnly =
	(data: DesktopModelCatalogue, onLive?: () => Promise<DesktopResponse>) =>
	(request: BridgeRequest): Promise<DesktopResponse | undefined> => {
		if (request.op === "sessions.command") return Promise.resolve(undefined);
		if (request.op !== "models.catalogue") {
			return Promise.resolve(refuse(400, `unexpected ${request.op}`));
		}
		if (request.live) return onLive ? onLive() : Promise.resolve(ok(data));
		return Promise.resolve(ok(data));
	};

/**
 * A live answer that settles ONCE and is then held pending.
 *
 * The picker's own listing now runs on mount, so a story whose subject is a
 * MANUAL refresh in flight has to let that first read finish: the automatic
 * call answers, the one the button started never does. Without this the two are
 * the same frame and the story photographs the automatic listing under a
 * caption about the button.
 */
const liveOnce = (data: DesktopModelCatalogue) => {
	let calls = 0;
	return () =>
		++calls === 1 ? Promise.resolve(ok(data)) : pending<DesktopResponse>();
};

/** Type into the search box the way a user does (the input holds focus). */
const typeQuery = async (text: string) => {
	await screen.findAllByRole("option");
	const input = screen.getByRole("combobox");
	await userEvent.click(input);
	await userEvent.keyboard(text);
};

/**
 * A wait long enough to survive the machine these two stories are captured on.
 *
 * The default is one second, which is a correct budget for a play a developer
 * runs on an idle laptop and is NOT one for `scripts/capture-evidence.mjs`,
 * which drives this file over CDP on a host running a fleet: the opus pair's
 * first capture died on its second theme with `Unable to find role="option"`
 * because the story had not finished preparing inside a second. The frames are
 * the evidence, so a wait that only fits an idle machine is a flake in the
 * evidence rather than a finding about the picker. The assertions themselves are
 * unchanged - only how long they are willing to wait for the state they claim.
 */
const SLOW = { timeout: 30_000 };

/** `typeQuery` with that budget, for the two frames whose waits are the point. */
const typeQuerySlowly = async (text: string) => {
	const input = await screen.findByRole("combobox", undefined, SLOW);
	await userEvent.click(input);
	await userEvent.keyboard(text);
};

/**
 * Wait for the catalogue to paint before touching the list.
 *
 * A `play` starts as soon as the story mounts, and the picker's rows arrive one
 * react-query tick later — so a `getByRole("option")` at that instant throws and
 * the whole play aborts, leaving a frame that silently photographs the untouched
 * resting state. That is how the first `hovered` capture came back
 * byte-identical to `populated`: not because the highlight is invisible (it is,
 * but that is a separate fact) but because no hover had happened at all. Every
 * play below therefore WAITS for the row it is about, and asserts the state it
 * claims to photograph — a play that silently does nothing produces a frame that
 * looks like evidence and is not.
 */
const rowFor = (name: RegExp) => screen.findByRole("option", { name });

/**
 * The catalogue reads this frame has seen, and how many of them asked the
 * PROVIDERS (`live: true`).
 *
 * The pair is the reading a frame about the automatic listing has to be able to
 * state: `live` above zero with no click anywhere in the play is what "it lists
 * the providers without being asked" means as a number, and `total` is how many
 * reads paid for it.
 */
const catalogueCalls = (): { total: number; live: number } => {
	const page = window as unknown as {
		__pickerCatalogueCalls?: { total: number; live: number };
	};
	return page.__pickerCatalogueCalls ?? { total: 0, live: 0 };
};

/** The option the list currently marks active, or null when none does. */
const activeLabel = (): string | null => {
	const active = [...document.querySelectorAll('[role="option"]')].find(
		(option) => option.getAttribute("aria-selected") === "true",
	);
	return active ? (active.textContent ?? "").trim().slice(0, 30) : null;
};

/**
 * Put the pointer on a row WITHOUT picking it.
 *
 * The pointer and the keyboard own different things now (design D2): hovering
 * marks the row for the pointer and does NOT move the selection, so this waits
 * for `data-hovered` rather than for `aria-selected` — and then asserts the
 * selection did NOT move, which is the property that separates the two states.
 * `userEvent.hover` moves the virtual pointer and dispatches
 * `pointerover`/`mouseover`/`mouseenter`, which is what the row listens on.
 */
const hoverRow = async (name: RegExp) => {
	const option = await rowFor(name);
	const before = activeLabel();
	await userEvent.hover(option);
	await waitFor(() => expect(option.getAttribute("data-hovered")).toBe("true"));
	expect(activeLabel()).toBe(before);
};

/**
 * Move the active row with the ARROW KEYS, the other way into the same state.
 *
 * `fireEvent.keyDown` rather than `userEvent.keyboard`: the handler is the
 * component's own `onKeyDown`, and driving it directly is deterministic.
 *
 * The settle before the presses is load-bearing, and it is a finding rather than
 * a test artefact. `PickerHost` re-places the active row on the current model in
 * an effect keyed on the FILTERED OPTION LIST — a derived value whose identity
 * changes whenever the catalogue is re-derived. So that effect runs a second
 * time when the catalogue answer lands, and a keypress delivered before that run
 * is silently undone: probed on this story, four ArrowDowns left `aria-selected`
 * back on row 0, and sampling `aria-selected` every 200ms showed index 4 never
 * survived. The pair of assertions below (before and after a beat) is what makes
 * the frame trustworthy — a highlight that moves after the shutter is not
 * evidence of anything.
 */
const arrowTo = async (index: number) => {
	await screen.findAllByRole("option");
	const input = screen.getByRole("combobox");
	await sleep(600); // let the catalogue-arrival pass of that effect settle
	for (let step = 0; step < index; step += 1) {
		fireEvent.keyDown(input, { key: "ArrowDown" });
	}
	const selected = () =>
		[...document.querySelectorAll('[role="option"]')][index]?.getAttribute(
			"aria-selected",
		);
	await waitFor(() => expect(selected()).toBe("true"));
	await sleep(600);
	await waitFor(() => expect(selected()).toBe("true"));
};

/** Pick a row: the row's handler is on `mousedown`, not `click`. */
const pickRow = async (name: RegExp) => {
	const option = await rowFor(name);
	await userEvent.hover(option);
	await userEvent.click(option);
};

const meta: Meta<typeof ModelPicker> = {
	title: "chat-model-picker",
	component: ModelPicker,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof ModelPicker>;

/* ------------------------------------------------------------- states */

/**
 * First paint. The catalogue has not come back, so `loading` is true and the
 * list is a centred spinner — while the search input is already focused and
 * accepts keystrokes that filter nothing yet.
 */
export const Loading: Story = {
	render: () => <Frame bridge={() => pending()} />,
};

/**
 * The resting frame. The in-force model carries the accent check, and — because
 * an empty query starts the active row there so Enter alone is a no-op — it is
 * ALSO the selected row.
 */
export const Populated: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
};

/**
 * The pointer resting on a row that is NOT the current one.
 *
 * The pair with `KeyboardHighlight` is the measurement, and after D2 the two
 * frames are DIFFERENT states: this one marks the pointer's row with the
 * accent-wash tint PLUS a 1px `outline-control` edge and leaves the selection
 * where it was, where the keyboard's frame moves the selection and paints it
 * with the `sunken` ground. The edge is not decoration: `accent-wash`
 * collapses onto `elevated` in obsidian (ΔE00 0.77), so the tint alone was no
 * mark at all where it does not clear the field floor: over every palette
 * `accent-wash` on `elevated` runs from ΔE00 0.77 (obsidian) to 24.73
 * (cyberpunk), and sits under ΔE00 4 in thirteen of the fifty-nine (design
 * D12). The play asserts the separation AND what UX U1 asks for in the same
 * frame: with the pointer on a row that is NOT the keyboard's, the footer
 * still names the row Enter would pick.
 */
export const Hovered: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await hoverRow(/GPT-5\.4/);
		// U1: the pointer's row is not the pick target, and the footer says which
		// row is (`aria-selected` confirms the keyboard did not move).
		await waitFor(() =>
			expect(screen.getByText(/Enter picks Claude Opus 5/)).toBeTruthy(),
		);
		expect(
			document
				.querySelector('[role="option"][data-hovered="true"]')
				?.getAttribute("aria-selected"),
		).toBe("false");
	},
};

/** The same state by arrow key: no pointer involved at all. */
export const KeyboardHighlight: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await arrowTo(4);
	},
};

/**
 * A connected row has been picked and the command is in flight. The row is
 * still only elevated, and the footer's left slot is the single place that says
 * anything is happening.
 */
export const Busy: Story = {
	render: () => (
		<Frame
			bridge={(request) =>
				request.op === "models.catalogue"
					? catalogueOnly(catalogue())(request)
					: pending()
			}
		/>
	),
	play: async () => {
		painted.length = 0;
		cleared.length = 0;
		await pickRow(/Anthropic: Claude Haiku 4\.5/);
		// The picked row is MARKED, and the mark is in the meta slot the machine
		// detail used to occupy, so the row cannot change height while the answer
		// is pending.
		await waitFor(() =>
			expect(
				document.querySelector('[role="option"][data-picked="true"]')
					?.textContent,
			).toContain("Claude Haiku 4.5"),
		);
		// The footer names the change, in the user's terms: "the backend" is the
		// implementation's noun for the session the pick changes (D14).
		await waitFor(() =>
			expect(
				screen.getByText("Switching the model…", { exact: true }),
			).toBeTruthy(),
		);
		// Find the row attached to the visible busy hint rather than the whole
		// dialog: DialogContent's icon-only dismiss button intentionally shares
		// the accessible name, but it is not the footer action this play tests.
		const busyHint = screen.getByText("Switching the model…", { exact: true });
		const footer = busyHint.closest<HTMLElement>("[data-picker-footer]");
		if (!footer) throw new Error("Picker footer was not rendered");
		await waitFor(() =>
			expect(
				within(footer).getByRole("button", { name: "Close" }),
			).toBeTruthy(),
		);
		// U1's ordering: the paint is already on the band's side of the wire
		// while the command that will confirm it is still in flight.
		expect(painted).toEqual(["openrouter/anthropic/claude-haiku-4-5"]);
		expect(cleared).toEqual([]);
	},
};

/**
 * The command answered. The strip quotes the owner verbatim, the footer's right
 * button becomes `Done`, and the in-force indicator has moved to the picked row.
 */
export const SetCurrentAsDefault: Story = {
	render: () => (
		<Frame
			bridge={(request) =>
				request.op === "models.catalogue"
					? catalogueOnly(catalogue())(request)
					: Promise.resolve(ok({ key: request.key, value: request.value }))
			}
		/>
	),
	play: async () => {
		const page = window as unknown as {
			__pickerSettingsWrites?: { key: string; value: unknown }[];
		};
		page.__pickerSettingsWrites = [];
		await userEvent.click(
			await screen.findByRole("button", { name: DEFAULT_MODEL_LABEL }),
		);
		await waitFor(() =>
			expect(page.__pickerSettingsWrites).toEqual([
				{ key: "hosting", value: CURRENT.provider },
				{ key: "model_name", value: CURRENT.model_id },
			]),
		);
		await waitFor(() =>
			expect(
				screen.getByText(`Default for new sessions: ${CURRENT_SELECTOR}`),
			).toBeTruthy(),
		);
	},
};

/** Accepted session effort may be saved as the machine default by explicit opt-in. */
export const EffortSetAsDefault: Story = {
	render: () => (
		<Frame
			picker="effort"
			commandResponse={ok({
				result: {
					kind: "notice",
					text: "Effort set",
					style: "info",
					data: {},
				},
			})}
			bridge={(request) => {
				if (request.op === "commands.entities")
					return Promise.resolve(
						ok({
							entities: [
								{ value: "low", name: "low" },
								{ value: "medium", name: "medium" },
								{ value: "high", name: "high" },
							],
							current: "medium",
						}),
					);
				if (request.op === "settings.edit")
					return Promise.resolve(
						ok({ key: request.key, value: request.value }),
					);
				if (request.op === "sessions.command")
					return sleep(100).then(() => undefined);
				return Promise.resolve(ok({}));
			}}
		/>
	),
	play: async () => {
		const page = window as unknown as {
			__pickerSettingsWrites?: { key: string; value: unknown }[];
		};
		page.__pickerSettingsWrites = [];
		await userEvent.click(
			await screen.findByRole("checkbox", { name: EFFORT_DEFAULT_LABEL }),
		);
		const pendingCommand = await screen.findByRole("option", { name: "High" });
		await userEvent.click(pendingCommand);
		await waitFor(() =>
			expect(screen.getByText("Switching the effort…")).toBeTruthy(),
		);
		await waitFor(() =>
			expect(page.__pickerSettingsWrites).toEqual([
				{ key: "model_effort", value: "high" },
			]),
		);
		await waitFor(() =>
			expect(screen.getByText(EFFORT_DEFAULT_SUCCESS)).toBeTruthy(),
		);
		await waitFor(() =>
			expect(
				screen.getByText(
					(_, element) =>
						element?.tagName === "P" &&
						element.textContent?.replace(/\s+/g, " ").trim() ===
							"Effort set Default effort for new sessions: High.",
				),
			).toBeTruthy(),
		);
	},
};

export const EffortRefusedDoesNotSaveDefault: Story = {
	render: () => (
		<Frame
			picker="effort"
			commandResponse={ok({
				result: {
					kind: "notice",
					text: "Refused",
					style: "warning",
					data: {},
				},
			})}
			bridge={(request) =>
				request.op === "commands.entities"
					? Promise.resolve(
							ok({
								entities: [{ value: "low" }, { value: "high" }],
								current: "low",
							}),
						)
					: Promise.resolve(undefined)
			}
		/>
	),
	play: async () => {
		const page = window as unknown as {
			__pickerSettingsWrites?: { key: string; value: unknown }[];
		};
		page.__pickerSettingsWrites = [];
		await userEvent.click(
			await screen.findByRole("checkbox", { name: EFFORT_DEFAULT_LABEL }),
		);
		await userEvent.click(await screen.findByRole("option", { name: "High" }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		await waitFor(() => expect(page.__pickerSettingsWrites).toEqual([]));
		await waitFor(() =>
			expect(screen.getByText(EFFORT_DEFAULT_FAILED)).toBeTruthy(),
		);
	},
};

export const SetCurrentAsDefaultRefused: Story = {
	render: () => (
		<Frame
			bridge={(request) =>
				request.op === "models.catalogue"
					? catalogueOnly(catalogue())(request)
					: Promise.resolve(refuse(400, "settings refused"))
			}
		/>
	),
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: DEFAULT_MODEL_LABEL }),
		);
		await waitFor(() =>
			expect(screen.getByText(SAVE_DEFAULT_FAILED)).toBeTruthy(),
		);
	},
};

export const Result: Story = {
	render: () => (
		<Frame
			selected={PICKED}
			bridge={(request) =>
				request.op === "models.catalogue"
					? catalogueOnly(catalogue())(request)
					: Promise.resolve(
							ok({
								result: receipt(
									CURRENT_SELECTOR,
									`${PICKED.provider}/${PICKED.model_id}`,
								),
							}),
						)
			}
		/>
	),
	play: async () => {
		await pickRow(/Anthropic: Claude Haiku 4\.5/);
		await waitFor(() =>
			expect(
				screen.getByText(/model: anthropic\/claude-opus-5 →/),
			).toBeTruthy(),
		);
	},
};

/**
 * `Refresh from providers` clicked and the live listing still pending. The
 * button says so — `Refreshing…`, the state it is in, not `Refresh` the action
 * it is not currently offering — while the rows it already had stay painted
 * (`keepPreviousData`), because a 2.33 s re-list must not read as "the
 * catalogue disappeared".
 */
export const RefreshPending: Story = {
	render: () => (
		<Frame bridge={catalogueOnly(catalogue(), liveOnce(catalogue()))} />
	),
	play: async () => {
		/*
		 * The picker starts its own provider listing on mount, so the button the
		 * user presses is the SECOND live read, and the first has to settle before
		 * there is a button to press at all. `liveOnce` is that split: the
		 * automatic read answers, the clicked one is held pending.
		 */
		await waitFor(() =>
			expect(screen.getAllByRole("option").length).toBeGreaterThan(0),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Refresh from providers" }),
		);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Refreshing…" })).toBeTruthy(),
		);
		// The pending button is disabled AND the list is still there.
		expect(
			screen
				.getByRole("button", { name: "Refreshing…" })
				.hasAttribute("disabled"),
		).toBe(true);
		await waitFor(() =>
			expect(screen.getAllByRole("option").length).toBeGreaterThan(0),
		);
		expect(catalogueCalls().live).toBe(2);
	},
};

/**
 * The registry's own answer to `opus`, with the provider listing STILL OUT.
 *
 * This is the `before` half of the pair below and the state the operator's
 * report was photographed in: the shipped registry stops at `claude-opus-5`, so
 * one row answers the query, and the model their provider publishes is simply
 * not there. The play asserts the ABSENCE — which is the only half of a before
 * frame that can be asserted — and it is written to hold on both trees, so the
 * ROW SET is the same state before and after the change: on the released build
 * nothing has asked the providers (there was no automatic listing), and on this
 * branch the listing is out and has not answered yet.
 *
 * THE FRAME is not the same picture, and a reader comparing the two stills
 * should know it before reading the difference as a regression: on the released
 * build the refresh control sits settled at `Refresh from providers`, while on
 * this branch it is disabled and says the listing is in flight — which is the
 * whole of what the change did, stated in one control (review round 1, nit 2).
 */
export const RegistryOnlyOpus: Story = {
	render: () => (
		<Frame bridge={catalogueOnly(registryCatalogue(), () => pending())} />
	),
	play: async () => {
		await typeQuerySlowly("opus");
		await waitFor(
			() => expect(screen.getAllByRole("option").length).toBe(1),
			SLOW,
		);
		/*
		 * The assertion is the ABSENCE, which is the only half of a before frame that
		 * can be asserted, plus the one row that is there. It is read off the row's
		 * text rather than off its accessible name: the name carries the price and
		 * window detail beside the label, so an anchored `/Claude Opus 5$/` would
		 * fail on a row that is present.
		 */
		const rows = screen
			.getAllByRole("option")
			.map((option) => option.textContent ?? "");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toContain("Claude Opus 5");
		expect(screen.queryByRole("option", { name: /Opus 5\.5/ })).toBeNull();
	},
};

/**
 * The same query, the same keystrokes, and the provider's listing arrives on its
 * own — the `after` half of the pair.
 *
 * Nothing is clicked. The play types `opus` exactly as the before half does and
 * then waits for a row that is in Anthropic's listing and NOT in the registry
 * (`Claude Opus 5.5`), so the frame proves the automatic listing rather than the
 * click: `catalogueCalls().live` is the request count that paid for it, and the
 * play asserts it reached two reads without a click being dispatched anywhere.
 * The second read is the live one because the picker paints the registry first
 * and promotes itself once the registry read settles — the same
 * stale-then-update the TUI picker does.
 */
export const ProviderListingOpus: Story = {
	render: () => (
		<Frame
			bridge={catalogueOnly(registryCatalogue(), () =>
				Promise.resolve(ok(liveCatalogue())),
			)}
		/>
	),
	play: async () => {
		await typeQuerySlowly("opus");
		/*
		 * The arrival itself: a row that is in Anthropic's listing and NOT in the
		 * registry, with nothing clicked. The ORDER of the two paints - registry
		 * rows first, live rows replacing them - is not asserted here, because the
		 * stub answers the live read immediately and the in-between state lasts a
		 * microtask; it is asserted by the sibling frame, `after-registry-only-opus`,
		 * where the live answer is withheld and the frame is the registry paint with
		 * the listing out.
		 */
		await waitFor(
			() =>
				expect(
					screen.getByRole("option", { name: /Claude Opus 5\.5/ }),
				).toBeTruthy(),
			SLOW,
		);
		await waitFor(
			() => expect(screen.getAllByRole("option").length).toBe(3),
			SLOW,
		);
		/*
		 * An EXACT equality, which is the assertion's own intent: the two reads are
		 * one per key and there is no third, so a change that re-listed on a render,
		 * on a hover or on a focus event would fail here rather than pass quietly.
		 * (An earlier revision of this play carried a paragraph arguing for a floor
		 * while the code beside it asserted equality; review round 1, R1-2 - the
		 * comment lost, because the count is the claim the frame makes.)
		 */
		expect(catalogueCalls()).toEqual({ total: 2, live: 1 });
	},
};

/**
 * The automatic listing FAILS, and the rows the dialog opened on stay.
 *
 * The state review round 1 filed as R1-1 (UX U3 is the same defect from the
 * user's side), and the reason it became a defect in this change: the live read
 * used to run only when the user pressed the button, so a failure replaced rows
 * the user had asked to refresh; now it runs on its own, and a failure that
 * erased the list would be a read nobody asked for destroying rows they already
 * had. `keepPreviousData` cannot carry those rows here - a query that settles as
 * `error` has no data of its own - so the picker draws the REGISTRY document
 * under the failure and the failure becomes a note above the rows.
 *
 * The play asserts both halves: the note names the failure in the user's terms,
 * and the row the registry answered with is still on screen. A play that only
 * checked the note would pass on a frame with the note and no list, which is the
 * defect rather than the fix.
 */
export const LiveListingFailed: Story = {
	render: () => (
		<Frame
			bridge={catalogueOnly(registryCatalogue(), () =>
				Promise.resolve(refuse(500, "Provider listing is unavailable.")),
			)}
		/>
	),
	play: async () => {
		await typeQuerySlowly("opus");
		await waitFor(
			() =>
				expect(screen.getByText(/The provider listing failed/)).toBeTruthy(),
			SLOW,
		);
		/*
		 * AND IT WAITS FOR THE RETRY TO SETTLE, which is what makes this frame a
		 * picture of the state it claims (review round 2, the frame's own re-capture).
		 * The refusal above is answered once and asked AGAIN a second later, because
		 * this query inherits the application's default `retry: 1`
		 * (`src/renderer/src/shared/api/query-client.ts`) - and while that retry is out
		 * the control reads `Checking…` and no note is drawn. The note's first
		 * appearance therefore precedes the settled state by about a second, which is
		 * exactly the window a shutter fired off the earlier assertion landed in: a
		 * re-capture of this story produced a `Checking…` frame filed under the name of
		 * the FAILED state. Waiting for the pass to be out of flight pins the frame to
		 * the state the file names, without touching the retry policy the app ships.
		 */
		await waitFor(
			() => expect(screen.queryByText(/Checking…/)).toBeNull(),
			SLOW,
		);
		await waitFor(
			() => expect(screen.getAllByRole("option").length).toBe(1),
			SLOW,
		);
		expect(screen.getByRole("option").textContent).toContain("Claude Opus 5");
		/*
		 * And the developer-facing sentence is NOT the body: it travels in the
		 * notice's own detail (the tooltip), which is where a message about a
		 * transport belongs when the user has rows to work with.
		 */
		expect(screen.queryByText(/Provider listing is unavailable\./)).toBeNull();
	},
};

/** The persist checkbox, checked. Nothing else on the surface changes. */
export const PersistChecked: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("checkbox", { name: /default for new sessions/ }),
		);
		await waitFor(() =>
			expect(
				screen
					.getByRole("checkbox", { name: /default for new sessions/ })
					.getAttribute("data-state"),
			).toBe("checked"),
		);
	},
};

/** The Grok row's accessible name: its displayed label is the degraded selector. */
const GROK_OPTION_NAME = /x-ai\/grok-4\.7/;

/** The name-only row's accessible name, for the same reason. */
const NANO_OPTION_NAME = /gemini-2\.5-flash-image/;

/** A query that matches nothing: the list is replaced by one dim line. */
export const Empty: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await typeQuery("zzz");
		await waitFor(() =>
			expect(screen.getByText("Nothing matches.")).toBeTruthy(),
		);
	},
};

/**
 * The operator's exact spelling resolves a row whose HUMAN name is the match.
 *
 * This is the frame the fix exists for: `grok 4.7` used to answer
 * `Nothing matches.` because the reseller row's `label` degrades to its selector
 * and the picker never read `listing_name`. Both halves of the fix are visible
 * here -- the name is in the haystack AND the query's space is normalised -- so
 * the same query also resolves with a hyphen, a dot, or a capital. That an
 * AGGREGATOR row is the one that resolves, while a direct provider's row sits
 * above it in the resting list, is the ordering half: adding the name as a match
 * target keeps the tiers, it does not promote the aggregator.
 */
export const HumanNameSearch: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await typeQuery("grok 4.7");
		/*
		 * The row's ACCESSIBLE NAME is its displayed label, and for a reseller row
		 * that label degrades to the selector (`openrouter/x-ai/grok-4.7`) -- the
		 * human name is a match INPUT, never painted. So the assertion is on the
		 * selector: the query that used to answer `Nothing matches.` now resolves
		 * the row, which is the whole fix.
		 */
		await waitFor(() =>
			expect(
				screen.getByRole("option", { name: GROK_OPTION_NAME }),
			).toBeTruthy(),
		);
		expect(screen.queryByText("Nothing matches.")).toBeNull();
	},
};

/**
 * The report's second spelling: `opus 5.5`, against a catalogue that holds it.
 *
 * The first spelling (`grok 4.7`) is answered by normalising the query against
 * the ID's own words; this one is answered by the same rule against a listing's
 * `Claude Opus 5.5`. Both resolve the ROW the words name and neither promotes
 * it: `claude-opus-5` sits above the 5.5 rows in the resting list, because this
 * is a filter and never a ranker. A minor version also does not answer with its
 * own major — `opus 5.5` does not count `Claude Opus 5` as a hit of the same
 * spelling, it simply matches it as the shorter word sequence it contains.
 */
export const OpusMinorSearch: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await typeQuery("opus 5.5");
		await waitFor(() =>
			expect(
				screen.getAllByRole("option").map((row) => row.textContent),
			).toEqual(
				expect.arrayContaining([expect.stringContaining("Claude Opus 5.5")]),
			),
		);
		expect(screen.queryByText("Nothing matches.")).toBeNull();
	},
};

/**
 * The name-only query: `nano banana`, which appears in no id at all.
 *
 * The aggregator row for `google/gemini-2.5-flash-image` publishes that name in
 * its listing, and its `label` is the degraded selector — so before the name
 * joined the haystack this query could not answer the row it names, whatever
 * the normalisation did. It is the half of the fix the `grok 4.7` frame cannot
 * show, and the reason the name is a match input rather than a nicety.
 */
export const ListingNameOnlySearch: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
	play: async () => {
		await typeQuery("nano banana");
		await waitFor(() =>
			expect(
				screen.getByRole("option", {
					name: NANO_OPTION_NAME,
				}),
			).toBeTruthy(),
		);
		expect(screen.queryByText("Nothing matches.")).toBeNull();
	},
};

/**
 * The catalogue came back with a per-provider listing failure. The rows the
 * other providers answered with are STILL LISTED, and the note sits above them:
 * the defect this replaces replaced 1450 usable rows with 21 provider names.
 */
export const PartialError: Story = {
	render: () => (
		<Frame
			bridge={catalogueOnly(
				catalogue({ errors: { openrouter: "no credential for the listing" } }),
			)}
		/>
	),
	play: async () => {
		await waitFor(() =>
			expect(screen.getByText(/Some providers did not answer/)).toBeTruthy(),
		);
		expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
	},
};

/** The same picker at the width where the toolbar's two controls compete. */
export const Narrow: Story = {
	render: () => <Frame bridge={catalogueOnly(catalogue())} />,
};
