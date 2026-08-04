import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useLayoutEffect } from "react";
/* Storybook's preview does not load the app's stylesheet, so a story that
   renders ported components has to bring it or it renders with no utilities. */
import "../../../styles/index.css";
import { CommandPalette } from "./command-palette";

/**
 * The command palette, open.
 *
 * ## Why the store is driven rather than a prop
 *
 * `CommandPalette` takes no props: it reads `isCommandPaletteOpen` and the
 * query straight out of `useUiPreferencesStore`, because in the app it is
 * mounted once at the root and opened from anywhere. A story that wanted to
 * pass `open` would be testing a component that does not exist.
 *
 * ## Why `data-theme` goes on `documentElement`
 *
 * The palette is a Radix dialog and portals to `document.body`, outside any
 * wrapper this story could render. With the theme only on a wrapper every
 * `--lo-*` read inside the portal resolves to nothing and the panel comes out
 * unstyled.
 *
 * ## What the agent rows do here
 *
 * There is no backend in Storybook, so `useAgents` returns nothing and the
 * Agents section is absent. Actions, Navigation and Settings are static and
 * render in full, which is enough to judge row rhythm, the section headings,
 * the active row and the key legend.
 */
const THEME_IDS = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
] as const;

type StoryArgs = {
	theme: (typeof THEME_IDS)[number];
	/** Seeded into the store before the palette opens. */
	query: string;
};

const PaletteFrame = ({ theme, query }: StoryArgs) => {
	// Theme first and synchronously, so no frame is painted unthemed.
	useLayoutEffect(() => {
		const previous = document.documentElement.dataset.theme;
		document.documentElement.dataset.theme = theme;
		return () => {
			if (previous === undefined) {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = previous;
			}
		};
	}, [theme]);

	/*
	 * Deliberately a passive effect, not a layout effect.
	 *
	 * `CommandPalette` two-way binds the query: it seeds local state from the
	 * store and writes the debounced local value back. That write-back is a
	 * passive effect, and passive effects run child-first — so a layout effect
	 * here set the query and the palette immediately wrote its own empty
	 * initial value over it, and the query stories rendered the unfiltered
	 * list. Seeding from a passive effect in the parent lands last.
	 */
	useEffect(() => {
		const store = useUiPreferencesStore.getState();
		store.setCommandPaletteQuery(query);
		store.openCommandPalette();
		return () => {
			useUiPreferencesStore.getState().closeCommandPalette();
		};
	}, [query]);

	return (
		<div
			data-theme={theme}
			className="min-h-screen bg-canvas font-sans text-body text-ink"
		>
			<CommandPalette />
		</div>
	);
};

const meta: Meta<StoryArgs> = {
	title: "Command palette/CommandPalette",
	parameters: { layout: "fullscreen" },
	argTypes: {
		theme: { control: "select", options: THEME_IDS },
		query: { control: "text" },
	},
	args: { theme: "localOperatorDark", query: "" },
	render: (args) => <PaletteFrame {...args} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** Opened with no query: every section, in the order they are offered. */
export const Default: Story = {};

/** A query that narrows to one section. */
export const Filtered: Story = { args: { query: "agent" } };

/** The no-results state, which has to say what to try next. */
export const NoResults: Story = { args: { query: "zzzz" } };
