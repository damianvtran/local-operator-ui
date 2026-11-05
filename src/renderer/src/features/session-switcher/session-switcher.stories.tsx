// @ts-ignore Path aliases don't work for Storybook root
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
// @ts-ignore Path aliases don't work for Storybook root
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
/**
 * The Ctrl+Tab recent-session switcher, as a fixture both review lanes can open.
 *
 * WHY THIS FILE EXISTS. QA round 1 and design round 1 both hit the same wall: the
 * overlay mounts only at `app.tsx:837`, behind a held chord, and there was no
 * story anywhere - so the one marked panel in this PR that nothing had ever
 * photographed was also the one whose markup differs most from the primitives
 * (its own portal, its own row buttons, no Radix layer). A panel that is only
 * reachable through a keyboard chord is a panel no screenshot-based lane can
 * judge, which is the defect this story removes.
 *
 * IT OPENS THE WAY THE APP OPENS IT - a `keydown` of the chord - rather than
 * reaching past the hook into its state. The reveal is the production path: the
 * listener, the 180 ms hold, the panel that only exists while Control is held.
 * There is no `open` prop to set, and inventing one would be a production change
 * made for a story.
 *
 * FIXTURE, NOT PRODUCT: the stores are seeded for this frame only, the way the
 * sidebar stories seed them, and nothing here is imported by the app.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { SessionSwitcher } from "./components/session-switcher";

/** Three ranked rows, so the selection brackets the current conversation. */
const ROWS = [
	{
		session_id: "switcher-fixture-current",
		title: "Rebuild the overlay floor",
	},
	{ session_id: "switcher-fixture-second", title: "Tooltip contrast sweep" },
	{
		session_id: "switcher-fixture-third",
		title: "QA matrix for the glass lane",
	},
];

const meta: Meta<typeof SessionSwitcher> = {
	title: "Features/Session switcher",
	component: SessionSwitcher,
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof SessionSwitcher>;

/**
 * The overlay open over a seeded conversation list.
 *
 * THE CHORD IS DISPATCHED FROM `play`, so the frame is already painted before a
 * screenshot is taken: the handler opens the run on the press, the hook holds the
 * overlay for `SESSION_SWITCHER_REVEAL_MS` (180 ms), and the wait below covers
 * that window with room to spare. Control is never released, so the run stays
 * open - which is the state the surface is worth looking at.
 */
export const SwitcherOpen: Story = {
	render: () => {
		useCanonicalSessionsStore.setState({
			sessions: ROWS as never,
			activeSessionId: ROWS[0].session_id,
			activeDraftKey: null,
			error: null,
		});
		useUiPreferencesStore.setState({
			conversationRecents: ROWS.map((row) => row.session_id),
		});
		return (
			<div className="min-h-screen bg-canvas p-6 text-body text-ink">
				<SessionSwitcher />
			</div>
		);
	},
	play: async ({ canvasElement }) => {
		/*
		 * `window`, not the canvas: the listener sits on the document's own bubble
		 * phase, and a press dispatched into a subtree exercises a path the app never
		 * takes.
		 */
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Tab",
				code: "Tab",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 260));
		/* Fails loudly rather than photographing an empty page: if a future host
		 * cannot dispatch the chord, the story says so instead of showing nothing. */
		await expect(
			canvasElement.ownerDocument.querySelector(
				'[role="dialog"][data-glass-overlay]',
			),
		).not.toBeNull();
	},
};
