import "../components/story-electron-shim";
import { MessageInput } from "@shared/components/composer/message-input";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { type FC, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { pickerStoryFixture } from "./model-picker.stories";
import { PickerOutlet } from "./picker-registry";

const { Frame, CURRENT, CATALOGUE, row, catalogue, catalogueOnly, ok } =
	pickerStoryFixture;
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

/** Render the actual nested composer and its trigger, then present via the same outlet as ChatPage. */
const AnchoredFrame: FC<{ scrolled?: boolean }> = ({ scrolled = false }) => {
	const [presentation, setPresentation] = useState<{
		kind: QuickStoryKind;
		anchor: HTMLElement;
	} | null>(null);
	const selected = scrolled ? EXTENDED_MODEL : CURRENT;
	const frontend = {
		selected_model: {
			provider: selected.provider,
			model_id: selected.model_id,
			display_name: scrolled ? EXTENDED_MODEL.label : EXACT_MODEL,
			reasoning: true,
			reasoning_effort: "medium",
			reasoning_efforts: TEST_LEVELS,
		},
	} as CanonicalFrontendState;
	return (
		<div className="@container/chatcol flex min-h-dvh min-w-0 flex-col justify-end bg-canvas p-3">
			<MessageInput
				conversationId="picker-story-session"
				isLoading={false}
				messages={[]}
				onSendMessage={async () => false}
				sessionStatus={{
					frontend,
					effortEntities: TEST_LEVELS.map((value) => ({ value })),
					onCommand: ({ name }, anchor) => {
						if (anchor && (name === "model" || name === "effort")) {
							setPresentation((last) =>
								last?.anchor === anchor ? null : { kind: name, anchor },
							);
						}
					},
				}}
			/>
			{presentation && (
				<Frame
					picker={presentation.kind}
					renderPicker={(context) => (
						<PickerOutlet
							context={{
								...context,
								action: {
									...context.action,
									destination:
										presentation.kind === "effort"
											? "session.effort"
											: "session.model",
								},
								quickPickerAnchor: presentation.anchor,
							}}
						/>
					)}
					selected={selected}
					frontend={frontend}
					onClose={() => setPresentation(null)}
					bridge={(request) => {
						if (
							request.op === "commands.entities" &&
							request.command === "effort"
						) {
							return Promise.resolve(
								ok({
									entities: TEST_LEVELS.map((value) => ({
										value,
										name: value,
									})),
									current: "medium",
								}),
							);
						}
						return catalogueOnly(scrolled ? SCROLLED_CATALOGUE : catalogue())(
							request,
						);
					}}
				/>
			)}
		</div>
	);
};

const openFromChip = async (kind: QuickStoryKind) => {
	const chip = await waitFor(() => {
		const node = document.querySelector<HTMLButtonElement>(
			`[data-composer-picker="${kind}"]`,
		);
		if (!node) throw new Error(`Missing ${kind} composer chip`);
		return node;
	});
	await userEvent.click(chip);
	const input = await screen.findByRole("combobox");
	await waitFor(() => expect(input).toHaveFocus());
	return { chip, input };
};

export const AnchoredModel: Story = {
	parameters: { layout: "fullscreen" },
	render: () => <AnchoredFrame />,
	play: async () => {
		await openFromChip("model");
		await screen.findByRole("listbox");
		expect(screen.getByRole("dialog")).toHaveAttribute(
			"data-picker-placement",
			"anchored",
		);
	},
};

export const AnchoredEffort: Story = {
	...AnchoredModel,
	play: async () => {
		await openFromChip("effort");
		await screen.findByRole("listbox");
		expect(screen.getByRole("dialog")).toHaveAttribute(
			"data-picker-placement",
			"anchored",
		);
	},
};

/** Geometry proof on a real scrollport: typing must reveal rank one without moving the composer. */
export const AnchoredModelRetarget: Story = {
	...AnchoredModel,
	render: () => <AnchoredFrame scrolled />,
	play: async () => {
		const { chip, input } = await openFromChip("model");
		const list = await screen.findByRole("listbox");
		const activeRow = () =>
			document.getElementById(
				input.getAttribute("aria-activedescendant") ?? "",
			);
		await waitFor(() => {
			expect(activeRow()).toHaveTextContent(EXTENDED_MODEL.label);
			expect(list.scrollTop).toBeGreaterThan(0);
		});
		const outerScroll = window.scrollY;
		const chipTop = chip.getBoundingClientRect().top;
		await userEvent.paste(EXACT_MODEL);
		await waitFor(() => {
			const row = activeRow();
			if (!row) throw new Error("Search did not expose an active row");
			const box = row.getBoundingClientRect();
			const port = list.getBoundingClientRect();
			expect(row.firstElementChild?.firstElementChild?.textContent).toBe(
				EXACT_MODEL,
			);
			expect(box.top).toBeGreaterThanOrEqual(port.top);
			expect(box.bottom).toBeLessThanOrEqual(port.bottom);
			expect(input).toHaveFocus();
			expect(window.scrollY).toBe(outerScroll);
			expect(chip.getBoundingClientRect().top).toBe(chipTop);
		});
	},
};
