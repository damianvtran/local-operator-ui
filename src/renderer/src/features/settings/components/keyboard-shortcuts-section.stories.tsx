import "../../../styles/index.css";

import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { useRecordingShortcutStore } from "@shared/hooks/use-recording-shortcut";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, screen, userEvent, waitFor } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, useEffect, useLayoutEffect, useState } from "react";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";
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
		<div className="min-h-screen bg-canvas p-8">
			{/*
			 * `max-w-4xl`, the page's own content column (`settings-page.tsx`), not
			 * the `max-w-2xl` this story mounted at until design review round 1
			 * (D1): the page renders this section at 896px and the description's own
			 * cap binds there, so a 608px frame under-rendered the description and
			 * photographed a composition the app never draws. The speech story
			 * states the rule this follows.
			 */}
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
				<KeyboardShortcutsSection />
			</div>
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

/*
 * The recording row is backend-owned, unlike the renderer-local panel rows.
 * These stories provide the same desktop envelope and query client as the app,
 * so the populated states exercise the production row rather than a mock of it.
 */
const RecordingBackendStory: FC<{
	value?: string;
	refuseSave?: boolean;
}> = ({ value = "primary+shift+s", refuseSave = false }) => {
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	);
	useLayoutEffect(() => {
		const previous = window.api;
		const previousElectron = window.electron;
		const setting: BackendSettings["settings"][number] = {
			key: "keymap.start_recording",
			section: "keymap",
			label: "Start recording",
			kind: "hotkey",
			help: "Starts speech-to-text recording in the desktop window.",
			value,
			default: "primary+shift+s",
			is_default: value === "primary+shift+s",
			minimum: null,
			maximum: null,
			members: [],
			choices: [],
			empty_unsets: false,
			redacted: false,
			tier: "core",
			hotkey_scope: "desktop",
		};
		const ok = (result: unknown): DesktopResponse => ({
			status: 200,
			body: { status: 200, message: "ok", result },
		});
		const request = async (input: DesktopRequest): Promise<DesktopResponse> => {
			if (input.op === "settings.list")
				return ok({ sections: [], settings: [setting] });
			if (input.op === "settings.edit") {
				if (refuseSave)
					return {
						status: 422,
						body: {
							status: 422,
							detail:
								"Start recording cannot use this shortcut: reserved chord.",
						},
					};
				setting.value = input.value;
				setting.is_default = input.value === setting.default;
				useRecordingShortcutStore.getState().setState({
					value: String(input.value),
					canonical: String(input.value),
				});
				return ok(setting);
			}
			if (input.op === "settings.reset") {
				setting.value = setting.default;
				setting.is_default = true;
				return ok(setting);
			}
			throw new Error(`Unsupported story request: ${input.op}`);
		};
		window.api = {
			...previous,
			desktop: { ...previous?.desktop, request },
		} as typeof window.api;
		window.electron = {
			...previousElectron,
			recordingShortcut: {
				get: async () => ({ value, canonical: value }),
				onChange: () => () => {},
				markPending: () => {},
				syncClaims: () => {},
			},
		} as typeof window.electron;
		return () => {
			window.api = previous;
			window.electron = previousElectron;
			client.clear();
		};
	}, [client, refuseSave, value]);
	return (
		<QueryClientProvider client={client}>
			<Section />
		</QueryClientProvider>
	);
};

/** The backend row beside the six panel rows, with the preserved default. */
export const RecordingDefault: Story = {
	render: () => <RecordingBackendStory />,
	play: async () => {
		await screen.findByText("Start recording");
	},
};

/** A saved override displays its glyph label and explicit Reset affordance. */
export const RecordingOverride: Story = {
	render: () => <RecordingBackendStory value="primary+alt+r" />,
	play: async () => {
		await screen.findByText("Start recording");
	},
};

/** Capture saves immediately; a refusal keeps the previous saved value. */
export const RecordingSaveRefused: Story = {
	render: () => <RecordingBackendStory refuseSave />,
	play: async () => {
		const field = await screen.findByLabelText(
			"Start recording: press the keys you want",
		);
		fireEvent.keyDown(field, { key: "r", metaKey: true, altKey: true });
		await screen.findByText(
			"Start recording cannot use this shortcut: reserved chord.",
		);
		expect(field).toHaveValue("Ctrl+Shift+S");
	},
};
