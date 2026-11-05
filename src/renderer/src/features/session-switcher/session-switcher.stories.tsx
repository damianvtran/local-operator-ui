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
		const doc = canvasElement.ownerDocument;
		/*
		 * ON `document`, WHICH IS WHERE THE LISTENER IS. `use-session-switcher-keys.ts`
		 * binds `document.addEventListener("keydown", onKeyDown)`; an event dispatched
		 * on `window` does not travel DOWN the tree to a document listener, so the first
		 * version of this fixture pressed a key nobody was listening for and the panel
		 * never opened (QA round 1, Q-2). Dispatching on `document` is the same target
		 * the app's own press reaches, which is the whole point of driving the real path
		 * instead of reaching into the hook's state.
		 */
		const press = () =>
			doc.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Tab",
					code: "Tab",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		/*
		 * POLLED, WITH ONE RETRY, because the listener is attached from a `useEffect`
		 * and a `play` that runs before that effect flushes would press a key nobody is
		 * listening for yet - design round 2's D4 named the race as a candidate cause
		 * alongside the wrong target. The retry costs one extra `Tab` press (a second
		 * press only steps the cursor, and the panel is what is being asserted), and it
		 * cannot turn a broken fixture green: without the panel this still fails, and
		 * paints the banner first.
		 */
		press();
		const panelAfter = async (ms: number) => {
			const deadline = Date.now() + ms;
			while (Date.now() < deadline) {
				const found = doc.querySelector('[role="dialog"][data-glass-overlay]');
				if (found !== null) return found;
				/* The reveal is `SESSION_SWITCHER_REVEAL_MS` (180 ms) after the press. */
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			return null;
		};
		let panel = await panelAfter(400);
		if (panel === null) {
			press();
			panel = await panelAfter(400);
		}
		/*
		 * A BROKEN FIXTURE HAS TO BE VISIBLE IN THE PIXELS, not only in the interactions
		 * log. A screenshot lane reads a blank frame as "the surface has nothing to
		 * show", which is exactly how this fixture's own defect survived a review: the
		 * assertion failed and the picture looked like an empty story. So the failure
		 * paints a banner over the frame BEFORE it throws, and the story still fails.
		 */
		if (panel === null) {
			const banner = doc.createElement("div");
			banner.setAttribute("data-story-fixture-failure", "session-switcher");
			banner.style.cssText = [
				"position:fixed",
				"inset:0",
				"z-index:2147483647",
				"display:grid",
				"place-items:center",
				"padding:24px",
				"background:#b00020",
				"color:#fff",
				"font:600 18px/1.5 system-ui,sans-serif",
				"text-align:center",
			].join(";");
			banner.textContent =
				"FIXTURE FAILED: the session switcher did not open. No [role=dialog][data-glass-overlay] exists 260 ms after the chord - check the dispatch target and the reveal timer.";
			doc.body.appendChild(banner);
		}
		await expect(panel).not.toBeNull();
	},
};
