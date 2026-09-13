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
 *   - `PersistChecked` — the checkbox that changes what the pick DOES, with the
 *     label that states the consequence.
 *   - `Empty` / `PartialError` — a query that matches nothing, and a catalogue
 *     that came back with a per-provider failure (which keeps its rows now).
 *   - `Narrow` — the toolbar at the width where its two controls compete.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, screen, userEvent, waitFor } from "@storybook/test";
import type { FC } from "react";
import "../../../styles/index.css";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type {
	DesktopModelCatalogue,
	NativeDesktopAction,
} from "../../../../../shared/desktop-control-contract";
import type { SlashCommandMeta } from "../components/slash-commands";
import { ModelPicker, type PickerContext } from "./destination-pickers";

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
type BridgeRequest = { op: string; live?: boolean };

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

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

/** Install the transport a story needs. Called from `render`, before mount. */
const installBridge = (
	next: (request: BridgeRequest) => Promise<DesktopResponse>,
) => {
	bridge = next;
};

if (typeof window !== "undefined") {
	// The page's `window` is not the preload-shaped one here, so the two fields
	// this file adds are declared rather than poked at through `any`.
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
		__pickerCatalogueCalls?: { total: number };
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) => {
			// Counted so a frame can state HOW MANY times the catalogue was asked
			// for: react-query refetches on window focus by default, and a
			// refetch re-derives the option list — which is worth knowing when a
			// captured row position does not survive the wait.
			const seen = page.__pickerCatalogueCalls ?? { total: 0 };
			page.__pickerCatalogueCalls = seen;
			if (request.op === "models.catalogue") seen.total += 1;
			return bridge
				? bridge(request)
				: Promise.reject(new Error("no bridge installed for this story"));
		},
	};
}

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
];

/** The model the session is on when the picker opens. */
const CURRENT = { provider: "anthropic", model_id: "claude-opus-5" };

const CURRENT_SELECTOR = `${CURRENT.provider}/${CURRENT.model_id}`;

/** The row the `Busy`/`Result` stories pick. */
const PICKED = {
	provider: "openrouter",
	model_id: "anthropic/claude-haiku-4-5",
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
	bridge: (request: BridgeRequest) => Promise<DesktopResponse>;
	/** The model the session is on (the session frame's stand-in). */
	selected?: { provider: string; model_id: string } | null;
};

/**
 * One frame: installs the transport, then renders the PRODUCTION `ModelPicker`.
 *
 * The `PickerContext` carries seven fields and the model picker reads three
 * (`sessionId`, `canonical`, `onClose`); the rest are the dispatcher's, so they
 * are filled here rather than pretended into meaningful values.
 */
const Frame: FC<FrameProps> = ({ bridge: storyBridge, selected = CURRENT }) => {
	installBridge(storyBridge);
	const ctx: PickerContext = {
		action: MODEL_ACTION,
		spec: MODEL_SPEC,
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
	return <ModelPicker {...ctx} />;
};

/** A bridge that answers the catalogue and refuses everything else. */
const catalogueOnly =
	(data: DesktopModelCatalogue, onLive?: () => Promise<DesktopResponse>) =>
	(request: BridgeRequest): Promise<DesktopResponse> => {
		if (request.op !== "models.catalogue") {
			return Promise.resolve(refuse(400, `unexpected ${request.op}`));
		}
		if (request.live) return onLive ? onLive() : pending();
		return Promise.resolve(ok(data));
	};

/** Type into the search box the way a user does (the input holds focus). */
const typeQuery = async (text: string) => {
	await screen.findAllByRole("option");
	const input = screen.getByRole("combobox");
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
 * with the `sunken` ground. The edge is not decoration: `accent-wash` collapses
 * onto `elevated` in obsidian (ΔE00 0.77), so the tint alone was no mark at all
 * in four of the twelve themes (design D12). The play asserts the separation
 * AND what UX U1 asks for in the same frame: with the pointer on a row that is
 * NOT the keyboard's, the footer still names the row Enter would pick.
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
			expect(screen.getByText(/Switching the model/)).toBeTruthy(),
		);
		// The control closes the dialog; it does not cancel the switch.
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Close" })).toBeTruthy(),
		);
		// U1's ordering: the paint is already on the band's side of the wire
		// while the command that will confirm it is still in flight.
		expect(painted).toEqual(["anthropic/claude-haiku-4-5"]);
		expect(cleared).toEqual([]);
	},
};

/**
 * The command answered. The strip quotes the owner verbatim, the footer's right
 * button becomes `Done`, and the in-force indicator has moved to the picked row.
 */
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
	render: () => <Frame bridge={catalogueOnly(catalogue(), () => pending())} />,
	play: async () => {
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
