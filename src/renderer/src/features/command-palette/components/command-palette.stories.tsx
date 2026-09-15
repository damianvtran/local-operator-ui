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
 * ## What these stories cannot show
 *
 * There is no backend here, so the two sources that need one are absent: the
 * agent roster and the conversation search. What remains is the whole of the
 * local half — destinations, actions, the settings rail and its sections — which
 * is what the browse state is made of, and enough to judge the row rhythm, the
 * section headings, the active row, the key legend and the scope prefixes.
 *
 * The conversation and registry stories therefore live in the app's own
 * evidence rather than here: `docs/evidence/command-palette-commandpalette/` is
 * the Storybook set, and the frames taken from the running app are what show a
 * chat matched by its body.
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
	 * store and writes the settled local value back. That write-back is a passive
	 * effect, and passive effects run child-first — so a layout effect here set
	 * the query and the palette immediately wrote its own empty initial value
	 * over it, and the query stories rendered the unfiltered list. Seeding from a
	 * passive effect in the parent lands last.
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

/**
 * Opened with no query: the browse layout, and the state that teaches the
 * prefixes.
 */
export const Default: Story = {};

/** A query that spans more than one source, showing how the groups order. */
export const Filtered: Story = { args: { query: "agent" } };

/**
 * A settings query, which is where the alias table earns its place: "theme" is
 * not a word in the settings rail, and the row it finds is called Appearance.
 */
export const SettingsScope: Story = { args: { query: ",theme" } };

/**
 * The command scope on its own: `>` is "show me what the app can do", which is
 * the browse layout narrowed to destinations, actions and panels.
 *
 * The Panels group is absent here, and that absence is the gate working rather
 * than missing evidence: every panel is presented by the chat pane, a story has
 * no pane, and the palette does not offer a row it could not deliver. The rows
 * themselves are covered by the ranking tests and the live-app QA pass.
 */
export const CommandsScope: Story = { args: { query: ">" } };

/**
 * The no-results state, which has to say what to try next — and, in the app,
 * must not claim it while the conversation search is still out.
 */
export const NoResults: Story = { args: { query: "zzzz" } };
