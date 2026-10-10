import "../../../styles/index.css";

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, screen, userEvent, waitFor } from "@storybook/test";
import { type FC, useEffect, useLayoutEffect } from "react";
import { KeyboardShortcutsSection } from "./keyboard-shortcuts-section";

/**
 * The Keyboard shortcuts group (#928) as a surface of its own: the six rows, the
 * recorder's states and the Reset affordance, one frame per state.
 *
 * THE STORE IS SET, NOT ASSUMED, for the reason every settings story sets its
 * flags: preferences persist into the profile's localStorage, so a story that
 * did not would photograph whatever an earlier one left behind. The refused and
 * cleared frames are REACHED, not staged — a `play` presses the conflicting
 * chord at the real field, and clicks the real Reset — because a sentence
 * nothing typed is not evidence about the recorder.
 *
 * THE PLATFORM RESOLVES `linux` IN THIS HARNESS (there are no window-chrome
 * facts): the caps read `Ctrl+J` / `Ctrl+Shift+C` here, the display tables'
 * shared fallback, exactly as the mini view's own stories read it.
 */
const meta = {
	title: "Settings/Keyboard shortcuts",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

const Section: FC<{
	/** The overrides the store is seeded with; reset after the frame. */
	bindings?: Record<string, string>;
	/** Focus this action's field with the keyboard modality (recording state). */
	focusAction?: string;
}> = ({ bindings = {}, focusAction }) => {
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ shortcutBindings: { ...bindings } });
		return () => useUiPreferencesStore.setState({ shortcutBindings: {} });
	}, [bindings]);
	/*
	 * `focusVisible: true` is what makes `:focus-visible` match for a
	 * script-focused control (Chromium's heuristic treats an unprompted
	 * `.focus()` as pointer focus), the same call the rail's focus stories make.
	 */
	useEffect(() => {
		if (!focusAction) return;
		document
			.querySelector<HTMLInputElement>(
				`input[data-shortcut-action="${focusAction}"]`,
			)
			?.focus({ focusVisible: true } as FocusOptions);
	}, [focusAction]);
	return (
		<div className="max-w-2xl bg-canvas p-8">
			<KeyboardShortcutsSection />
		</div>
	);
};

/** The default/unbound mix: console and canvas on their defaults, four unset. */
export const DefaultMix: Story = {
	render: () => <Section />,
};

/** Populated overrides: the two rebound actions carry their chords and Reset. */
export const Overrides: Story = {
	render: () => (
		<Section
			bindings={{ "panel.browser": "primary+i", "panel.run": "primary+u" }}
		/>
	),
};

/** Recording: the focused field is the state; the hint and the focus ring are it. */
export const Recording: Story = {
	render: () => <Section focusAction="panel.canvas" />,
};

/**
 * Refused: the console field holds focus and the canvas's chord is pressed at
 * it, so the frame is the REAL refusal — previous value kept, sentence shown.
 */
export const Refused: Story = {
	render: () => <Section focusAction="panel.console" />,
	play: async () => {
		const field = await screen.findByLabelText(
			"Console: press the keys you want",
		);
		await userEvent.click(field);
		/*
		 * `fireEvent.keyDown` rather than `userEvent.keyboard`: the handler is the
		 * component's own `onKeyDown`, and a modified chord's exact shape is what
		 * this frame is about.
		 */
		fireEvent.keyDown(field, { key: "c", metaKey: true, shiftKey: true });
		await screen.findByText("Already assigned to Open canvas.");
	},
};

/**
 * Cleared: the browser has an override, and the frame is taken after the REAL
 * Reset button deletes it — the value back to `No shortcut`, the button gone.
 */
export const Cleared: Story = {
	render: () => <Section bindings={{ "panel.browser": "primary+i" }} />,
	play: async () => {
		const reset = await screen.findByRole("button", {
			name: "Reset Browser to its default",
		});
		await userEvent.click(reset);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Reset Browser to its default" }),
			).toBeNull(),
		);
		const field = screen.getByLabelText(
			"Browser: press the keys you want",
		) as HTMLInputElement;
		await waitFor(() => expect(field.value).toBe("No shortcut"));
	},
};
