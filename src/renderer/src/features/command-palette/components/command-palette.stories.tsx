import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
/* Also imported by the Storybook preview; kept here so the file is honest
   about what it needs to render, and so it renders if run in isolation. */
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
 * unstyled. The preview frame in `.storybook/preview.tsx` puts it on the root
 * for every story.
 *
 * ## What the agent rows do here
 *
 * There is no backend in Storybook, so `useAgents` returns nothing and the
 * Agents section is absent. Actions, Navigation and Settings are static and
 * render in full, which is enough to judge row rhythm, the section headings,
 * the active row and the key legend.
 */
type StoryArgs = {
	/** Seeded into the store before the palette opens. */
	query: string;
};

const PaletteFrame = ({ query }: StoryArgs) => {
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

	return <CommandPalette />;
};

const meta: Meta<StoryArgs> = {
	title: "Command palette/CommandPalette",
	parameters: { layout: "fullscreen" },
	argTypes: {
		query: { control: "text" },
	},
	args: { query: "" },
	render: ({ query }) => <PaletteFrame query={query} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** Opened with no query: every section, in the order they are offered. */
export const Default: Story = {};

/** A query that narrows to one section. */
export const Filtered: Story = { args: { query: "agent" } };

/** The no-results state, which has to say what to try next. */
export const NoResults: Story = { args: { query: "zzzz" } };
