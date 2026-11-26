import "../components/story-electron-shim";
import { ConnectProviderDialog } from "@features/providers/connect-provider-dialog";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { defaultQueryOptions } from "@shared/api/query-client";
import { MessageInput } from "@shared/components/composer/message-input";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor, within } from "@storybook/test";
import {
	QueryClient,
	QueryClientProvider,
	useIsFetching,
	useQueryClient,
} from "@tanstack/react-query";
import { type FC, useRef, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { useSlashDispatch } from "../components/slash-dispatch";
import { pickerStoryFixture } from "./model-picker.stories";
import { PickerOutlet } from "./picker-registry";

const {
	CATALOGUE,
	MODEL_SPEC,
	EFFORT_SPEC,
	installBridge,
	row,
	catalogue,
	catalogueOnly,
	ok,
	receipt,
} = pickerStoryFixture;
const meta = {
	title: "chat-model-picker",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const TEST_LEVELS = ["low", "medium", "xhigh", "high"];
const EXACT_MODEL = "Claude Opus 5";
const EXTENDED_MODEL = row({
	provider: "anthropic",
	model_id: "claude-opus-5-extended",
	label: "Claude Opus 5 Extended",
});
const SCROLLED_CATALOGUE = catalogue({
	models: [...CATALOGUE, EXTENDED_MODEL],
});
type QuickStoryKind = "model" | "effort";

const SESSION = "11111111-1111-4111-8111-111111111111";
const noop = () => {};
const HAIKU_LABEL = "Anthropic: Claude Haiku 4.5";
const DIRECT_HAIKU = "anthropic/claude-haiku-4-5";
const ROUTED_HAIKU = `openrouter/${DIRECT_HAIKU}`;
const MODEL_DEFAULT = /default for new sessions/i;
const SET_DEFAULT = /Set current model as default/;
const REFRESH_MODELS = /Refresh from providers/i;
const DEFAULT_REFUSED = /The default was not saved: unexpected settings.edit/;
const CATALOGUE_UNAVAILABLE = "Catalogue unavailable";
const PARTIAL_CATALOGUE = /One provider did not answer/;
const HIGH = /^High\b/;
const SIGN_IN_MODEL = /GLM-5\.2/;
const SHOW_ALL = /Show all supported models/i;
const LONG_LABEL =
	"A model name long enough that the named default wraps at the narrow picker width";
const LONG_MODEL = row({
	provider: "openai",
	model_id: "fixed-layout-model",
	label: LONG_LABEL,
});

/** The composer, dispatcher, outlet and Connect modal are production components.
 * Only owner transport is synthetic; selecting a model publishes its next owner
 * frame so tests can distinguish a request from the resulting selection. */
const AnchoredFrame: FC<{
	scrolled?: boolean;
	acceptDefault?: boolean;
	holdDefaultWrite?: boolean;
	holdFirstModel?: boolean;
	recoverCatalogue?: boolean;
}> = ({
	scrolled = false,
	acceptDefault = false,
	holdDefaultWrite = false,
	holdFirstModel = false,
	recoverCatalogue = false,
}) => {
	const [selected, setSelected] = useState(
		scrolled ? EXTENDED_MODEL : acceptDefault ? LONG_MODEL : CATALOGUE[0],
	);
	const [effort, setEffort] = useState("medium");
	const [writes, setWrites] = useState<string[]>([]);
	const [delayedModel, setDelayedModel] = useState<
		"idle" | "pending" | "released" | "settled"
	>("idle");
	const releaseModel = useRef<(() => void) | null>(null);
	const [defaultWriteHeld, setDefaultWriteHeld] = useState(false);
	const releaseDefault = useRef<(() => void) | null>(null);
	const failedLiveListing = useRef(false);
	const commandsKey = desktopKeys.commandsFor(useI18nLocale());
	const fetchingCommands = useIsFetching({ queryKey: commandsKey });
	const queryClient = useQueryClient();
	const commandsReady =
		!fetchingCommands &&
		queryClient.getQueryState(commandsKey)?.status === "success";

	const listing = recoverCatalogue
		? catalogue({
				source: "live",
				errors: { openrouter: "listing unavailable" },
			})
		: scrolled
			? SCROLLED_CATALOGUE
			: acceptDefault
				? catalogue({ models: [...CATALOGUE, LONG_MODEL] })
				: catalogue();
	const frontend = {
		selected_model: {
			provider: selected.provider,
			model_id: selected.model_id,
			display_name: selected.label,
			reasoning: true,
			reasoning_effort: effort,
			reasoning_efforts: TEST_LEVELS,
		},
	} as CanonicalFrontendState;
	installBridge(async (request) => {
		if (request.op === "capabilities")
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: { commands: 1, catalogues: 1 },
			});
		if (request.op === "commands.list")
			return ok({ commands: [MODEL_SPEC, EFFORT_SPEC] });
		if (request.op === "providers.list") return ok({ providers: [] });
		if (request.op === "commands.entities")
			return ok({
				entities:
					request.command === "effort"
						? TEST_LEVELS.map((value) => ({ value, name: value }))
						: [],
				current: effort,
			});
		if (request.op === "settings.edit") {
			// Hold the real setting request rather than racing a mock timeout to
			// sample the pending layout. The test releases it for either outcome.
			if (holdDefaultWrite && request.key === "hosting") {
				await new Promise<void>((resolve) => {
					releaseDefault.current = resolve;
					setDefaultWriteHeld(true);
				});
			}
			if (acceptDefault) return ok({ key: request.key, value: request.value });
		}
		if (
			request.op === "sessions.command" &&
			(request.command === "model" || request.command === "effort")
		) {
			const command = request.command;
			if (!request.args) {
				if (holdFirstModel && command === "model" && delayedModel === "idle") {
					setDelayedModel("pending");
					await new Promise<void>((resolve) => {
						releaseModel.current = resolve;
					});
				}
				return ok({
					result: {
						kind: "native_action",
						destination: `session.${command}`,
						session_id: SESSION,
						args: "",
						fields: [],
						data: {},
					},
				});
			}
			const selectedRow = listing.models.find(
				({ selector }) => selector === request.args,
			);
			if (command === "model" && selectedRow) {
				setWrites((last) => [...last, `model ${selectedRow.selector}`]);
				setSelected(selectedRow);
				return ok({ result: receipt(selected.selector, selectedRow.selector) });
			}
			if (command === "effort" && TEST_LEVELS.includes(request.args)) {
				const next = request.args;
				setWrites((last) => [...last, `effort ${next}`]);
				setEffort(next);
				return ok({
					result: {
						kind: "notice",
						style: "info",
						text: "Effort set",
						data: {},
					},
				});
			}
		}
		// Neither the shipped registry nor the first provider pass has data.
		// Only a subsequent live refresh may recover with a partial catalogue.
		if (recoverCatalogue && request.op === "models.catalogue") {
			if (request.live && failedLiveListing.current) return ok(listing);
			if (request.live) failedLiveListing.current = true;
			return { status: 503, body: { detail: CATALOGUE_UNAVAILABLE } };
		}
		return catalogueOnly(listing)(request);
	});
	const canonical = {
		status: "unavailable",
		frontend,
		paintPendingModel: noop,
		clearPendingModel: noop,
	} as unknown as CanonicalSessionHandle;
	const { dispatchFromControl, picker } = useSlashDispatch({
		sessionId: SESSION,
		canonical,
		addMessage: noop,
		rebind: noop,
		moveSession: async () => {
			throw new Error("Move is outside the quick picker fixture");
		},
	});
	const runFromControl: typeof dispatchFromControl = async (
		invocation,
		anchor,
	) => {
		const outcome = await dispatchFromControl(invocation, anchor);
		if (holdFirstModel && invocation.name === "model")
			setDelayedModel((now) => (now === "released" ? "settled" : now));
		return outcome;
	};
	return (
		<div
			className="@container/chatcol flex min-h-dvh min-w-0 flex-col justify-end bg-canvas p-3"
			data-commands-ready={commandsReady || undefined}
			data-delayed-model={holdFirstModel ? delayedModel : undefined}
			data-owner-model={selected.selector}
			data-owner-effort={effort}
			data-picker-writes={JSON.stringify(writes)}
		>
			{holdDefaultWrite && (
				<button
					type="button"
					hidden
					data-release-default-write
					disabled={!defaultWriteHeld}
					onClick={() => {
						releaseDefault.current?.();
						setDefaultWriteHeld(false);
					}}
				>
					Release default write
				</button>
			)}
			{holdFirstModel && (
				<button
					type="button"
					disabled={delayedModel !== "pending"}
					onClick={() => {
						releaseModel.current?.();
						setDelayedModel("released");
					}}
				>
					Release model receipt
				</button>
			)}
			<MessageInput
				conversationId={SESSION}
				isLoading={false}
				messages={[]}
				onSendMessage={async () => false}
				onSlashCommand={runFromControl}
				sessionStatus={{
					frontend,
					effortEntities: TEST_LEVELS.map((value) => ({ value })),
					onCommand: runFromControl,
				}}
			/>
			{picker && <PickerOutlet context={picker} />}
			<ConnectProviderDialog />
		</div>
	);
};

const chipFor = (kind: QuickStoryKind) =>
	waitFor(() => {
		const chip = document.querySelector<HTMLButtonElement>(
			`[data-composer-picker="${kind}"]`,
		);
		if (!chip || !document.querySelector("[data-commands-ready]"))
			throw new Error(`Waiting for ${kind} composer chip and registry`);
		return chip;
	});
const quickDialog = (kind: QuickStoryKind) =>
	waitFor(() => {
		const dialog = document.querySelector<HTMLElement>(
			`[role="dialog"][data-quick-picker="${kind}"]`,
		);
		if (!dialog) throw new Error(`Missing ${kind} picker dialog`);
		return dialog;
	});
const openFromChip = async (kind: QuickStoryKind) => {
	const chip = await chipFor(kind);
	await userEvent.click(chip);
	const dialog = await quickDialog(kind);
	const input = await within(dialog).findByRole(
		kind === "model" ? "combobox" : "listbox",
	);
	await waitFor(() => expect(input).toHaveFocus());
	return { chip, dialog, input };
};
const box = (node: Element) => node.getBoundingClientRect();

function expectComposerPickerPaint(dialog: HTMLElement, list: HTMLElement) {
	const rows = within(list).getAllByRole("option");
	const adjacent = rows.slice(1).flatMap((row, index) => {
		const previous = rows[index];
		return previous.parentElement === row.parentElement
			? [box(row).top - box(previous).bottom]
			: [];
	});
	expect(adjacent.length).toBeGreaterThan(0);
	for (const gap of adjacent) expect(gap).toBeCloseTo(2, 1);
	const active = within(list).getByRole("option", { selected: true });
	expect(getComputedStyle(active, "::before").content).toBe("none");
	const current = list.querySelector('[data-current="true"]');
	expect(current).not.toBeNull();
	expect(current?.querySelector("svg[aria-label]")).not.toBeNull();

	// Normalize the authored role through the browser, not a hex or a palette
	// name: this assertion must hold on whichever theme the gallery is using.
	const swatch = document.createElement("span");
	swatch.style.backgroundColor = "var(--lo-elevated)";
	dialog.append(swatch);
	try {
		expect(getComputedStyle(dialog).backgroundColor).toBe(
			getComputedStyle(swatch).backgroundColor,
		);
	} finally {
		swatch.remove();
	}
}
const anchorGap = (chip: Element, dialog: Element) =>
	box(chip).top - box(dialog).bottom;
const assertWrites = async (
	model: string,
	effort: string,
	writes: string[],
) => {
	await waitFor(() => {
		const owner = document.querySelector("[data-owner-model]");
		expect(owner).toHaveAttribute("data-owner-model", model);
		expect(owner).toHaveAttribute("data-owner-effort", effort);
		expect(
			JSON.parse(owner?.getAttribute("data-picker-writes") ?? "[]"),
		).toEqual(writes);
	});
};

export const AnchoredModel: Story = {
	render: () => <AnchoredFrame />,
	play: async () => {
		const { chip, dialog, input } = await openFromChip("model");
		const list = await within(dialog).findByRole("listbox");
		expect(dialog).toHaveAttribute("data-picker-placement", "anchored");
		expect(anchorGap(chip, dialog)).toBeCloseTo(6, 0);
		expectComposerPickerPaint(dialog, list);
		const checks = within(dialog).getAllByRole<HTMLButtonElement>("checkbox");
		const [persist, showAll] = checks.map((check) => check.labels?.[0]);
		expect(persist).toBeDefined();
		expect(showAll).toBeDefined();
		if (persist && showAll) {
			expect(box(persist).height).toBeGreaterThanOrEqual(24);
			expect(box(showAll).height).toBeGreaterThanOrEqual(24);
			expect(box(showAll).left).toBeCloseTo(box(persist).left, 1);
			expect(box(showAll).top - box(persist).bottom).toBeCloseTo(2, 1);
		}
		const resting = [box(input).top, box(list).top];
		for (const next of ["g", "p", "t", "-", "6", "-luna"]) {
			await userEvent.keyboard(next);
			expect(box(input).top).toBeCloseTo(resting[0], 0);
			expect(box(list).top).toBeCloseTo(resting[1], 0);
			expect(input).toHaveFocus();
		}
		await userEvent.clear(input);
		expect(box(input).top).toBeCloseTo(resting[0], 0);
		expect(box(list).top).toBeCloseTo(resting[1], 0);
		expect(input).toHaveFocus();
	},
};

export const AnchoredEffort: Story = {
	render: () => <AnchoredFrame />,
	play: async () => {
		const { chip, dialog, input: list } = await openFromChip("effort");
		expect(within(dialog).queryByRole("combobox")).toBeNull();
		expectComposerPickerPaint(dialog, list);
		expect(
			within(list).getByRole("option", { selected: true }),
		).toHaveTextContent("Medium");
		// The pointer and keyboard can mark adjacent rows at the same time.
		// Read their actual boxes and fills, not just the state attributes.
		if (matchMedia("(hover: hover)").matches) {
			const active = within(list).getByRole("option", { selected: true });
			const neighbor = within(list).getByRole("option", { name: "Low" });
			await userEvent.hover(neighbor);
			expect(neighbor).toHaveAttribute("data-hovered", "true");
			expect(getComputedStyle(neighbor).backgroundColor).not.toBe(
				getComputedStyle(active).backgroundColor,
			);
			expect(getComputedStyle(neighbor).backgroundColor).not.toBe(
				"rgba(0, 0, 0, 0)",
			);
			expect(box(active).top - box(neighbor).bottom).toBeCloseTo(2, 1);
			await userEvent.unhover(neighbor);
		}
		await userEvent.keyboard("{ArrowDown}{ArrowDown}");
		expect(
			within(list).getByRole("option", { selected: true }),
		).toHaveTextContent(HIGH);
		await userEvent.keyboard("{Enter}");
		await assertWrites(CATALOGUE[0].selector, "high", ["effort high"]);
		await within(list).findByRole("option", { name: "High Current" });
		expect(dialog).toHaveAttribute("data-picker-placement", "anchored");
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(chip).toHaveFocus());
	},
};

export const AnchoredModelRetarget: Story = {
	render: () => <AnchoredFrame scrolled />,
	play: async () => {
		const { chip, dialog, input } = await openFromChip("model");
		const list = await within(dialog).findByRole("listbox");
		const initiallyActive = await within(list).findByRole("option", {
			selected: true,
		});
		expect(initiallyActive).toHaveTextContent(EXTENDED_MODEL.label);
		const y = box(chip).top;
		await userEvent.keyboard(EXACT_MODEL);
		const next = within(list).getByRole("option", { selected: true });
		expect(next).not.toHaveTextContent(EXTENDED_MODEL.label);
		expect(next).toHaveTextContent(EXACT_MODEL);
		expect(box(next).top).toBeGreaterThanOrEqual(box(list).top);
		expect(box(next).bottom).toBeLessThanOrEqual(box(list).bottom);
		expect(box(chip).top).toBe(y);
		expect(input).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await assertWrites(CATALOGUE[0].selector, "medium", [
			`model ${CATALOGUE[0].selector}`,
		]);
		await within(dialog).findByText(
			receipt(EXTENDED_MODEL.selector, CATALOGUE[0].selector).text,
		);
	},
};

export const AnchoredModelExactProvider: Story = {
	render: () => <AnchoredFrame />,
	play: async () => {
		const { dialog, input } = await openFromChip("model");
		const list = await within(dialog).findByRole("listbox");
		await userEvent.keyboard(HAIKU_LABEL);
		expect(within(list).getAllByRole("option")).toHaveLength(2);
		expect(
			within(list).getByRole("option", { selected: true }),
		).toHaveTextContent(HAIKU_LABEL);
		await userEvent.keyboard("{Enter}");
		await assertWrites(ROUTED_HAIKU, "medium", [`model ${ROUTED_HAIKU}`]);
		await within(dialog).findByText(
			receipt(CATALOGUE[0].selector, ROUTED_HAIKU).text,
		);
		await userEvent.clear(input);
		await userEvent.keyboard(DIRECT_HAIKU);
		expect(
			within(list).getByRole("option", { selected: true }),
		).not.toHaveTextContent(HAIKU_LABEL);
		await userEvent.keyboard("{Enter}");
		await assertWrites(DIRECT_HAIKU, "medium", [
			`model ${ROUTED_HAIKU}`,
			`model ${DIRECT_HAIKU}`,
		]);
		await within(dialog).findByText(receipt(ROUTED_HAIKU, DIRECT_HAIKU).text);
	},
};

const defaultGeometry = async (accept: boolean, untick = false) => {
	const { chip, dialog, input } = await openFromChip("model");
	const list = await within(dialog).findByRole("listbox");
	await waitFor(() => expect(anchorGap(chip, dialog)).toBeCloseTo(6, 0));
	const check = within(dialog).getByRole("checkbox", { name: MODEL_DEFAULT });
	const scope = within(dialog).getByRole("checkbox", { name: SHOW_ALL });
	const labelFor = (control: HTMLElement) => {
		const label = dialog.querySelector<HTMLLabelElement>(
			`label[for="${control.id}"]`,
		);
		if (!label) throw new Error(`Missing label for ${control.id}`);
		return label;
	};
	const label = labelFor(check);
	const scopeLabel = labelFor(scope);
	const setDefault = within(dialog).getByRole("button", { name: SET_DEFAULT });
	const refresh = within(dialog).getByRole("button", { name: REFRESH_MODELS });
	const row = within(list).getAllByRole("option")[0];
	// A wrapped toolbar can leave room for two lines of checkbox copy and one
	// control gap, but must not put a third (empty) line between the controls.
	const compactCheckboxes = () => {
		const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
		expect(box(scope).top - box(check).top).toBeLessThanOrEqual(
			2 * lineHeight + 4.5,
		);
	};
	compactCheckboxes();
	const targets = [
		input,
		list,
		row,
		check,
		label,
		scope,
		scopeLabel,
		setDefault,
		refresh,
	];
	const boxes = () =>
		targets.map((element) => [
			box(element).x,
			box(element).y,
			box(element).width,
			box(element).height,
		]);
	const before = boxes();
	const expectUnmoved = () => {
		const after = boxes();
		for (const [i, target] of before.entries()) {
			for (const [axis, value] of target.entries())
				expect(after[i][axis]).toBeCloseTo(value, 0);
		}
		compactCheckboxes();
	};
	expect(check).not.toBeChecked();
	// The adjacent label is part of the effective hit target at this density.
	await userEvent.click(label);
	const release = await waitFor(() => {
		const button = document.querySelector<HTMLButtonElement>(
			"[data-release-default-write]:enabled",
		);
		if (!button) throw new Error("Waiting for the default write to be held");
		return button;
	});
	expect(check).toBeChecked();
	expect(check).toHaveAccessibleName(
		"Picks here also set the default for new sessions",
	);
	expect(setDefault).toBeDisabled();
	expectUnmoved();
	release.click();
	if (accept) {
		const saved = `Default for new sessions: ${LONG_LABEL}. Picks here update it too.`;
		await waitFor(() => expect(check).toHaveAccessibleName(saved));
		expect(check).toBeChecked();
		expect(within(label).getByText(saved)).toHaveAttribute("title", saved);
	} else {
		await within(dialog).findByText(DEFAULT_REFUSED);
		expect(check).not.toBeChecked();
	}
	expectUnmoved();
	if (untick) {
		await userEvent.click(check);
		expect(check).not.toBeChecked();
		expect(check).toHaveAccessibleName(
			"Also make this the default for new sessions",
		);
		expectUnmoved();
	}
	for (const target of [check, scope, setDefault, refresh]) {
		const rect = box(target);
		const hit = document.elementFromPoint(
			rect.x + rect.width / 2,
			rect.y + rect.height / 2,
		);
		expect(target.contains(hit)).toBe(true);
	}
};

export const AnchoredModelDefaultRefusal: Story = {
	render: () => <AnchoredFrame holdDefaultWrite />,
	play: () => defaultGeometry(false),
};

export const AnchoredModelDefaultLongLabel: Story = {
	render: () => <AnchoredFrame acceptDefault holdDefaultWrite />,
	play: () => defaultGeometry(true, true),
};

const narrowViewport = {
	defaultViewport: "pickerNarrow",
	viewports: {
		pickerNarrow: {
			name: "Narrow picker",
			styles: { width: "390px", height: "600px" },
			type: "mobile",
		},
	},
};
export const AnchoredModelDefaultRefusalNarrow: Story = {
	...AnchoredModelDefaultRefusal,
	parameters: { viewport: narrowViewport },
};

export const AnchoredModelDefaultLongLabelNarrow: Story = {
	...AnchoredModelDefaultLongLabel,
	parameters: { viewport: narrowViewport },
	play: () => defaultGeometry(true),
};

const CatalogueRecoveryFrame = () => {
	const [client] = useState(() => {
		// Rerun remounts the frame but retains the preview's cache. Give each
		// play a fresh catalogue and let only the manual refresh advance it.
		const fresh = new QueryClient({ defaultOptions: defaultQueryOptions });
		fresh.setQueryDefaults(desktopKeys.catalogue, { retry: false });
		return fresh;
	});
	return (
		<QueryClientProvider client={client}>
			<AnchoredFrame recoverCatalogue />
		</QueryClientProvider>
	);
};

export const AnchoredModelCatalogueRecovery: Story = {
	parameters: { viewport: narrowViewport },
	render: () => <CatalogueRecoveryFrame />,
	play: async () => {
		const { dialog, input } = await openFromChip("model");
		const picker = within(dialog);
		await picker.findByText(CATALOGUE_UNAVAILABLE, { exact: false });
		const refresh = await picker.findByRole("button", {
			name: "Refresh from providers",
		});
		await waitFor(() => expect(refresh).toBeEnabled());
		await userEvent.keyboard("haiku");
		expect(picker.queryByRole("listbox")).toBeNull();
		await userEvent.click(refresh);
		await picker.findByText(PARTIAL_CATALOGUE);
		const list = await picker.findByRole("listbox");
		await waitFor(() => {
			const active = within(list).getByRole("option", { selected: true });
			expect(input).toHaveValue("haiku");
			expect(input).toHaveAttribute("aria-activedescendant", active.id);
			expect(active).toHaveTextContent("Claude Haiku 4.5");
			expect(box(active).top).toBeGreaterThanOrEqual(box(list).top);
			expect(box(active).bottom).toBeLessThanOrEqual(box(list).bottom);
		});
		await userEvent.click(input);
		await userEvent.keyboard("{Enter}");
		await assertWrites(DIRECT_HAIKU, "medium", [`model ${DIRECT_HAIKU}`]);
	},
};

export const ComposerSlashAndConnect: Story = {
	render: () => <AnchoredFrame />,
	play: async () => {
		await chipFor("model");
		const composer = screen.getByLabelText("Message");
		await userEvent.click(composer);
		await userEvent.keyboard("/model");
		await within(composer.closest("form") ?? document.body).findByText(
			"Enter runs /model.",
		);
		await userEvent.keyboard("{Enter}");
		const model = await quickDialog("model");
		expect(model).toHaveAttribute("data-picker-placement", "fallback");
		const search = within(model).getByRole("combobox");
		await waitFor(() => expect(search).toHaveFocus());
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(composer).toHaveFocus());
		await userEvent.keyboard("/effort{Enter}");
		const effort = await quickDialog("effort");
		expect(effort).toHaveAttribute("data-picker-placement", "fallback");
		await waitFor(() =>
			expect(within(effort).getByRole("listbox")).toHaveFocus(),
		);
		await userEvent.keyboard("{Escape}");
		await openFromChip("effort");
		await userEvent.click(await chipFor("model"));
		const adjacent = await quickDialog("model");
		expect(adjacent).toHaveAttribute("data-picker-placement", "anchored");
		const scope = within(adjacent).queryByRole("checkbox", { name: SHOW_ALL });
		if (scope) await userEvent.click(scope);
		const unconnected = await within(adjacent).findByRole("option", {
			name: SIGN_IN_MODEL,
		});
		await userEvent.click(unconnected);
		await screen.findByRole("dialog", { name: "Connect a model provider" });
		await assertWrites(CATALOGUE[0].selector, "medium", []);
	},
};

/** An older owner's reply completes, but it cannot take back the presentation slot. */
export const SupersededModelReceipt: Story = {
	render: () => <AnchoredFrame holdFirstModel />,
	play: async () => {
		await userEvent.click(await chipFor("model"));
		const release = screen.getByRole("button", {
			name: "Release model receipt",
		});
		await waitFor(() => expect(release).toBeEnabled());
		const { chip } = await openFromChip("effort");
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(chip).toHaveFocus());
		await userEvent.click(release);
		await waitFor(() =>
			expect(
				document.querySelector('[data-delayed-model="settled"]'),
			).not.toBeNull(),
		);
		expect(document.querySelector("[data-quick-picker]")).toBeNull();
		const { input } = await openFromChip("model");
		expect(input).toHaveFocus();
	},
};
