/**
 * The redesign's RISKY GROUND PAIRS, one frame per palette that is tightest in
 * each (§N's `branding-cyberpunk` and `selection-check`).
 *
 * WHY THESE ARE STORIES RATHER THAN RIG STATES. A rig state photographs the live
 * app in one palette (the operator's stored theme), and the claims these frames
 * carry are about FOUR OTHER palettes. A story can pin `data-theme` on its own
 * subtree — the same trick `theme-selector.tsx` uses for its preview tiles — so
 * the palette under test is the story's own parameter rather than a setting the
 * rig would have to change on the operator's behalf.
 *
 * WHAT EACH ONE IS FOR, from the redesign's §B3 change (the sidebar's ground moved
 * to `surface` and the user's turn is a filled `surface` block on `canvas`):
 *
 *   cyberpunk          the pane's `canvas` -> `surface` step is the smallest in
 *                      the fleet here (delta L* 2.53), and BOTH new grounds are
 *                      that one step.
 *   rosePineDawn       the smallest ink headroom of any palette, so the user
 *                      block's `ink` on `surface` is closest to its floor.
 *   selection-check    the selected sidebar row (`rowSelected`) over `sunken`
 *                      content: `catppuccinMacchiato` is tightest for that pair
 *                      (delta L* 2.55), and `high-contrast-light` is the palette
 *                      §N named for the same check. Both are drawn side by side in
 *                      one frame, because a pair measured in isolation is the
 *                      claim the frame exists to test.
 *
 * IT DRAWS THE ROLE TOKENS, NOT THE COMPONENTS, and that is deliberate rather
 * than a shortcut: the sidebar cannot be rendered in this repository's Storybook
 * either (it reads the router, the store and the capability hooks, which is why
 * `scripts/chat-list-sections.test.mjs` pins its wiring as source text). What a
 * palette-risk frame has to show is the STEP between two rebindable values, so
 * each band draws the real role class — `bg-canvas`, `bg-surface`, `bg-sunken`,
 * `bg-row-selected`, `text-ink` — inside the palette under test.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";

/**
 * One labelled band: the design-system role's own class, its name, and what sits
 * on it. The prop is `token` rather than `role` because `role` is an ARIA
 * attribute and a lint rule reads it as one - this is a name for a `--lo-*` role,
 * which is a different vocabulary that happens to share the word.
 */
const Band = ({
	token,
	className,
	sample,
	note,
}: {
	token: string;
	className: string;
	sample: string;
	note: string;
}) => (
	<div className={cn("flex flex-col gap-1", className)}>
		<div className="flex items-baseline gap-2 px-3 pt-3">
			<span className="font-mono text-ink text-mono-sm">{token}</span>
			<span className="text-ink-dim text-meta">{note}</span>
		</div>
		<p className="px-3 pb-3 text-body text-ink">{sample}</p>
	</div>
);

/** A palette scoped to its own subtree, exactly as the settings preview does. */
const Palette = ({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: React.ReactNode;
}) => (
	<div data-theme={id} className="bg-canvas p-4">
		<p className="mb-2 font-mono text-ink-dim text-mono-sm">{label}</p>
		{children}
	</div>
);

const ROLES = [
	{
		token: "canvas",
		className: "bg-canvas",
		note: "the pane's ground; the user's block sits ON it",
	},
	{
		token: "surface",
		className: "bg-surface",
		note: "the new sidebar ground, and the user block's fill",
	},
	{
		token: "sunken",
		className: "bg-sunken",
		note: "a detail or code block inside the column",
	},
	{
		token: "row-selected",
		className: "bg-row-selected",
		note: "the selected sidebar row",
	},
];

const SENTENCE =
	"Fix the flaky scroll-anchor test — the transcript scroller jumps when a run re-files.";

const meta: Meta = {
	title: "Chat/Ground risk",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

export const Cyberpunk: Story = {
	render: () => (
		<Palette
			id="cyberpunk"
			label="cyberpunk — the smallest canvas → surface step"
		>
			<div className="flex flex-col gap-2">
				{ROLES.map((r) => (
					<Band key={r.token} {...r} sample={SENTENCE} />
				))}
			</div>
		</Palette>
	),
};

export const RosePineDawn: Story = {
	render: () => (
		<Palette
			id="rosePineDawn"
			label="rose-pine-dawn — the smallest ink headroom"
		>
			<div className="flex flex-col gap-2">
				{ROLES.map((r) => (
					<Band key={r.token} {...r} sample={SENTENCE} />
				))}
			</div>
		</Palette>
	),
};

export const SelectionCheck: Story = {
	render: () => (
		<div className="bg-canvas p-4">
			<p className="mb-2 text-ink-dim text-meta">
				The selected sidebar row over the column's ground, in the two palettes
				this pair is tightest in.
			</p>
			<div className="flex gap-4">
				<div className="flex-1">
					<Palette
						id="catppuccinMacchiato"
						label="catppuccin-macchiato — rowSelected vs sunken, 2.55 L*"
					>
						<div className="flex flex-col gap-2">
							<Band
								token="surface"
								className="bg-surface"
								sample="the sidebar column"
								note="the ground the selected row is drawn on"
							/>
							<Band
								token="row-selected"
								className={cn("bg-row-selected", "ring-1 ring-ink-dim")}
								sample="Reconcile the supplier ledger"
								note="the selected row"
							/>
							<Band
								token="row-hover"
								className="bg-row-hover"
								sample="Quarterly revenue model"
								note="the row under the pointer"
							/>
						</div>
					</Palette>
				</div>
				<div className="flex-1">
					<Palette
						id="highContrastLight"
						label="high-contrast-light — the palette §N names for this check"
					>
						<div className="flex flex-col gap-2">
							<Band
								token="surface"
								className="bg-surface"
								sample="the sidebar column"
								note="the ground the selected row is drawn on"
							/>
							<Band
								token="row-selected"
								className={cn("bg-row-selected", "ring-1 ring-ink-dim")}
								sample="Reconcile the supplier ledger"
								note="the selected row"
							/>
							<Band
								token="row-hover"
								className="bg-row-hover"
								sample="Quarterly revenue model"
								note="the row under the pointer"
							/>
						</div>
					</Palette>
				</div>
			</div>
		</div>
	),
};
