/**
 * @file settings-tab-panel.tsx
 * @description
 * One tab's panel: the box that decides whether a settings section is on screen.
 *
 * ## Why `hidden`, and nothing else
 *
 * Cmd/Ctrl+F on this page searches the RENDERED DOM (`data-search-row`,
 * `data-search-section`: the index is built from what is in the document), and
 * the onboarding tour matches its anchors by selector. Unmounting an inactive
 * panel would take other tabs' rows out of search and take the tour's anchors
 * out of the document; `display: none` keeps both, keeps each section's
 * unsaved field state, and costs the same render work the long page already
 * paid.
 *
 * `hidden` rather than a class, because it is the statement assistive tech and
 * the browser agree on: the subtree leaves the tab order and the accessibility
 * tree, and `closest("[hidden]")` — the test the Backend reveal loop and the
 * search jump already use as "not reachable yet" — reads it. `inert` would also
 * block pointer events on the content, and `content-visibility` would leave the
 * box in the a11y tree, so neither is the same statement.
 *
 * ## Why the visible panel is NOT re-keyed
 *
 * A tab switch changes the `hidden` attribute on twelve sibling boxes and
 * nothing else, so the panel that stays visible keeps its component identities,
 * its subscriptions and any pending write. The sections' own skeletons, error
 * states and empty states are untouched by this wrapper.
 */
import type { FC, ReactNode } from "react";

type SettingsTabPanelProps = {
	/** The section id this panel shows; also the id `settingsPanelOf` reports. */
	tab: string;
	/** The rail row's label, so the panel is named the same as its destination. */
	label: string;
	/** Whether this panel is the one on screen. */
	active: boolean;
	children: ReactNode;
};

export const SettingsTabPanel: FC<SettingsTabPanelProps> = ({
	tab,
	label,
	active,
	children,
}) => (
	<section
		hidden={!active}
		data-settings-panel={tab}
		id={`settings-panel-${tab}`}
		aria-label={label}
		/*
		 * A programmatic rest-stop, never a tab stop: a keyboard press on the rail
		 * moves focus here (the row's own `event.detail === 0`), so the reader
		 * lands on the named region they chose instead of walking the remaining
		 * rail rows to reach it. `-1`, because the panel itself is not something
		 * Tab should stop on later.
		 */
		tabIndex={-1}
		/*
		 * NO RING ON THE REST-STOP. `tabIndex={-1}` makes this a programmatic
		 * landing, not a control, and Chromium counts a scripted `.focus()` after
		 * keyboard input as `:focus-visible` — so the app's 2px accent ring would
		 * outline the whole panel, heading through its last control, with nothing
		 * actionable in it. Same escape, for the same reason, as the
		 * `model-providers` landing (`settings-page.tsx`): every focusable CHILD
		 * keeps its own ring, and the rail's own `aria-current` plus the panel
		 * that just appeared already say where the reader is.
		 */
		className="focus-visible:outline-none!"
	>
		{children}
	</section>
);
