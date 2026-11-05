import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { Contrast } from "lucide-react";
import { type FC, useLayoutEffect, useState } from "react";
import type { AccentRef } from "../../../../../shared/theme-engine/accent.mjs";
import type { WindowGlassState } from "../../../../../shared/window-glass";
import { AccentRow } from "./accent-row";
import { AppearanceLayers } from "./appearance-layers";
import { AppearancePreviewStrip } from "./appearance-preview-strip";
import { ContrastControl } from "./contrast-control";
import { SettingsSection } from "./settings-section";
import { ThemeSelector } from "./theme-selector";

/**
 * The layered appearance picker: preview strip, Theme, Contrast and Accent.
 *
 * ## Why the full-section stories drive the REAL store
 *
 * The layers are three persisted fields composed by the engine, and the frame
 * worth reviewing is the composed result - the strip, the chips' per-preset
 * swatches and the whole app chrome around them repainting. So `Layers*` stories
 * seed `useUiPreferencesStore` (contrast, accent, custom accents) before mount
 * and render the shipped `AppearanceLayers` + `ThemeSelector`, exactly as
 * `settings-page.tsx` does; the preview's theme arg still picks the theme. A
 * story leaves the layers it seeded in place for the next; each seeds all of
 * them, so order does not matter.
 *
 * ## Why the control stories are props-only
 *
 * States the store cannot be put in deterministically - a compose in flight
 * ("Applying contrast…"), an engine cap, an accent the engine refused - are
 * reached by rendering `ContrastControl` / `AccentRow` with those props.
 */

const LAYERS_IDENTITY = {
	contrast: { dark: 0, light: 0 },
	accent: { dark: { kind: "theme" }, light: { kind: "theme" } } as {
		dark: AccentRef;
		light: AccentRef;
	},
	customAccents: [] as string[],
	customAccentNames: {} as Record<string, string>,
};

const Seed: FC<{
	layers: Partial<typeof LAYERS_IDENTITY>;
	children: React.ReactNode;
}> = ({ layers, children }) => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ ...LAYERS_IDENTITY, ...layers });
		setReady(true);
	}, [layers]);
	return ready ? children : null;
};

const Frame: FC<{
	layers: Partial<typeof LAYERS_IDENTITY>;
	glass?: WindowGlassState | null;
}> = ({ layers, glass }) => (
	<Seed layers={layers}>
		{/* The app shell owns scrolling; standalone stories need the same bounded
		    viewport or its global overflow:hidden clips every lower control. */}
		<div className="h-screen overflow-y-auto" data-appearance-story-scroll="">
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
				<SettingsSection
					title="Appearance"
					icon={Contrast}
					description="Customize the look and feel of Local Operator"
					dataTourTag="settings-appearance-section"
				>
					<AppearanceLayers gallery={<ThemeSelector />} glass={glass} />
				</SettingsSection>
			</div>
		</div>
	</Seed>
);

const meta = {
	title: "Settings/Appearance layers",
	component: AppearanceLayers,
	parameters: { layout: "fullscreen" },
	args: { gallery: null, glass: null },
} satisfies Meta<typeof AppearanceLayers>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Standard contrast, the theme's accent, no custom accents: today's look. */
export const LayersStandard: Story = {
	render: ({ glass }) => <Frame layers={{}} glass={glass} />,
};

/** Synthetic native facts, not a claim that Storybook owns a native material. */
const SAMPLE_GLASS: WindowGlassState = {
	active: true,
	restartRequired: false,
	capability: {
		supported: true,
		mechanism: "vibrancy",
		reason: "ok",
		materials: ["window", "menu", "popover"],
		defaultMaterial: "window",
		liquid: false,
		defaultEnabled: true,
		liveToggle: true,
	},
	settings: {
		enabled: true,
		coverage: "full",
		intensity: 80,
		material: "window",
	},
};

export const LayersGlass: Story = {
	args: { glass: SAMPLE_GLASS },
	render: ({ glass }) => <Frame layers={{}} glass={glass} />,
};

export const LayersGlassHigh: Story = {
	args: { glass: SAMPLE_GLASS },
	render: ({ glass }) => (
		<Frame layers={{ contrast: { dark: 100, light: 100 } }} glass={glass} />
	),
};

export const LayersGlassSidebars: Story = {
	...LayersGlass,
	args: {
		glass: {
			...SAMPLE_GLASS,
			settings: { ...SAMPLE_GLASS.settings, coverage: "sidebars" },
		},
	},
};

export const LayersGlassUnsupported: Story = {
	...LayersGlass,
	args: {
		glass: {
			...SAMPLE_GLASS,
			active: false,
			capability: {
				...SAMPLE_GLASS.capability,
				supported: false,
				mechanism: "none",
				reason: "reduced-transparency",
			},
		},
	},
};

export const LayersGlassRestartPending: Story = {
	...LayersGlass,
	args: { glass: { ...SAMPLE_GLASS, restartRequired: true } },
};

/**
 * High contrast with a custom accent selected and two named accents saved -
 * the operator's "high contrast obsidian" example with their own blue. The
 * Theme header shows the override reminder with "Use theme accent".
 */
export const LayersHighCustomAccent: Story = {
	render: () => (
		<Frame
			layers={{
				contrast: { dark: 100, light: 100 },
				accent: {
					dark: { kind: "custom", hex: "#3B82F6" },
					light: { kind: "custom", hex: "#3B82F6" },
				},
				customAccents: ["#3B82F6", "#F472B6"],
				customAccentNames: { "#3B82F6": "Harbour" },
			}}
		/>
	),
};

/** Soft contrast: the "stony/grey" end, with an accent borrowed from a palette. */
export const LayersSoftPaletteAccent: Story = {
	render: () => (
		<Frame
			layers={{
				contrast: { dark: -100, light: -100 },
				accent: {
					dark: { kind: "palette", id: "tokyoNight" },
					light: { kind: "palette", id: "tokyoNightDay" },
				},
			}}
		/>
	),
};

/** Between presets (+25): no chip checked, Standard reads "(adjusted)". */
export const LayersBetweenPresets: Story = {
	render: () => <Frame layers={{ contrast: { dark: 25, light: 25 } }} />,
};

/** The "+" picker open, then an invalid hex entered: the error state. */
export const AddAccentInvalidHex: Story = {
	render: () => <Frame layers={{}} />,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Add a custom accent" }),
		);
		const field = await screen.findByLabelText("Hex");
		await userEvent.clear(field);
		await userEvent.type(field, "#GGG{Enter}");
		await screen.findByText("Enter a hex colour like #1A2B3C.");
	},
};

/** Adding a custom accent selects it and puts it first in "Your accents". */
export const AddAccentCommits: Story = {
	render: () => <Frame layers={{}} />,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Add a custom accent" }),
		);
		const field = await screen.findByLabelText("Hex");
		await userEvent.clear(field);
		await userEvent.type(field, "#2563EB{Enter}");
		await userEvent.click(await screen.findByRole("button", { name: "Add" }));
		await waitFor(() =>
			expect(useUiPreferencesStore.getState().customAccents[0]).toBe("#2563EB"),
		);
	},
};

/* ---------------------------------------------------- control-only states */

const noop = () => {};

/** A committed value the engine composes: "Applying contrast…" (loading). */
export const ContrastPending: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<ContrastControl
				committed={50}
				mode="dark"
				pending
				onDraft={noop}
				onCommit={noop}
			/>
		</div>
	),
};

/** The engine capped the request: the hint says what was reached, honestly. */
export const ContrastCapped: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<ContrastControl
				committed={-100}
				effective={-75}
				mode="light"
				onDraft={noop}
				onCommit={noop}
			/>
		</div>
	),
};

const accentBase = {
	themeName: "Dracula",
	themeAccent: "#BD93F9",
	themeAccentAlt: "#FF79C6",
	curated: [
		{ id: "tokyoNight", hex: "#7AA2F7" },
		{ id: "nord", hex: "#88C0D0" },
		{ id: "gruvboxDark", hex: "#FE8019" },
		{ id: "obsidian", hex: "#FAFAFA" },
	],
	all: [],
	paletteName: (id: string) => id,
	customNames: {},
	paintedAccent: "#BD93F9",
	adjusted: 0,
	applied: true,
	onSelect: noop,
	onAdd: noop,
	onReplace: noop,
	onRename: noop,
	onRemove: noop,
};

/** No custom accents yet: the row ends at "+" (empty state). */
export const AccentEmpty: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<AccentRow {...accentBase} custom={[]} selected={{ kind: "theme" }} />
		</div>
	),
};

/** A full row (12 custom accents): the limit hint shows. */
export const AccentFull: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<AccentRow
				{...accentBase}
				custom={[
					"#EF4444",
					"#F97316",
					"#F59E0B",
					"#EAB308",
					"#84CC16",
					"#22C55E",
					"#14B8A6",
					"#06B6D4",
					"#3B82F6",
					"#6366F1",
					"#8B5CF6",
					"#EC4899",
				]}
				customNames={{ "#3B82F6": "Harbour" }}
				selected={{ kind: "custom", hex: "#3B82F6" }}
				paintedAccent="#3B82F6"
			/>
		</div>
	),
};

/** The engine moved the colour for legibility (ΔE00 > 5): the hint shows. */
export const AccentAdjusted: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<AccentRow
				{...accentBase}
				custom={["#FACC15"]}
				selected={{ kind: "custom", hex: "#FACC15" }}
				paintedAccent="#C9A10A"
				adjusted={9.4}
			/>
		</div>
	),
};

/** No legible version existed (error): the theme's accent shows, and says so. */
export const AccentNotApplied: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<AccentRow
				{...accentBase}
				custom={["#2A2A2D"]}
				selected={{ kind: "custom", hex: "#2A2A2D" }}
				applied={false}
			/>
		</div>
	),
};

/** The strip on its own, for the token and overlap audits. */
export const PreviewStrip: Story = {
	render: () => (
		<div className="max-w-4xl p-6">
			<AppearancePreviewStrip />
		</div>
	),
};

/** Menu focus scope teardown must finish before opening the next form. Uses the
 * real store + provider supplied by ThemeFrame, not a mocked menu or callback. */
const CUSTOM_BLUE_LABEL = /#2563EB/;
const RENAME_ACTION = /Rename/;
const EDIT_ACTION = /Edit colour/;
export const CustomAccentManagement: Story = {
	render: () => <Frame layers={{ customAccents: ["#2563EB"] }} />,
	play: async () => {
		const swatch = await screen.findByRole("radio", {
			name: CUSTOM_BLUE_LABEL,
		});
		swatch.focus();
		await userEvent.keyboard("{Shift>}{F10}{/Shift}");
		await userEvent.click(
			await screen.findByRole("menuitem", { name: RENAME_ACTION }),
		);
		const field = await screen.findByRole("textbox", { name: "Name" });
		await userEvent.clear(field);
		await userEvent.type(field, "Harbour");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(
				useUiPreferencesStore.getState().customAccentNames["#2563EB"],
			).toBe("Harbour"),
		);
		await waitFor(() => expect(swatch).toHaveFocus());
		await userEvent.keyboard("{ContextMenu}");
		await userEvent.click(
			await screen.findByRole("menuitem", { name: EDIT_ACTION }),
		);
		await screen.findByRole("textbox", { name: "Hex" });
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(swatch).toHaveFocus());
		const add = screen.getByRole("button", { name: "Add a custom accent" });
		await userEvent.click(add);
		await screen.findByRole("textbox", { name: "Hex" });
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(add).toHaveFocus());
		document.documentElement.dataset.managementRegression = "pass";
	},
};
