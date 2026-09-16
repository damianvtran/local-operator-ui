/**
 * The chat header's action cluster, as a surface of its own.
 *
 * WHY THIS FILE EXISTS. The operator reported the three controls at the top right
 * of the chat header sitting slightly unevenly - wider between the browser button
 * and the canvas button than between the run trigger and the browser button - and
 * a claim about a GAP is a claim about two numbers the eye is bad at comparing
 * across two stills. `scripts/header-cluster-geometry.mjs` reads the three boxes
 * out of exactly this rendered state, and this file is what makes that state
 * reachable without a conversation: the real `ChatHeader` needs an agent identity,
 * a run model and both pane actions, and Storybook is the only instrument here
 * that can supply all of them with no backend and no session.
 *
 * FIVE STATES, and each answers one half of the decision:
 *
 * - `no-approval` is the state the operator photographed, and the one the fix is
 *   about: no badge is drawn, so no control is paying for one.
 * - `one-approval` and `at-cap` are the badge DRAWN, because the 12px the badge
 *   needs before its neighbour's box is the constraint the whole reservation
 *   exists for. `at-cap` is the widest the badge can ever be: `9+` is its own
 *   grammar, so a three-digit badge is unreachable by construction and a frame of
 *   one would photograph a state the app cannot enter (`chat-header.tsx`'s
 *   `badgeText` says why the glyph is capped).
 * - `trigger-dot` is the OTHER control that paints outside its own box: the run
 *   trigger's own 8px attention dot is anchored 2px past its right edge. A frame
 *   is owed for it because the fix moves the cluster's spacing, and "the dot does
 *   not do what the badge does" is a claim about pixels as much as about geometry.
 * - `canvas-open-badge` is the badge drawn with the CANVAS BUTTON unmounted, which
 *   is the arrangement that separates the reservation's two facts: the badge is
 *   still seeking 12px of room, but the box it exists to clear is not rendered, so
 *   the cluster must stay at 8px. A frame is owed because the spacing here is a
 *   pixel a reader can check against `one-approval` (design round 1's D2 rule: the
 *   container pays only for ink that would land in a neighbour's box).
 *
 * THE CLUSTER IS THE ONLY THING PHOTOGRAPHED. The header is the production
 * component in its production 56px band; the ground under it is deliberately
 * empty, because a gap is a fact about three boxes and a populated transcript
 * would only be something else for the eye to go to instead of the three controls.
 */

import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import "../../../styles/index.css";
import { ChatHeader } from "./chat-header";
import { deriveRunDetails } from "./run-details/run-detail-model";
import * as fixtures from "./run-details/run-details.fixtures";

const meta = {
	title: "Chat/Header cluster",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

/**
 * The real header in its real band, on the ground it really sits on.
 *
 * 560px is the width the header trigger's own frames use
 * (`browser-pane--trigger-*`), so these frames and those are the same surface at
 * the same size and a reviewer can hold them side by side.
 *
 * The three pane flags are SET rather than assumed, for the reason the run panel's
 * stories set theirs: the preference is persisted into the profile's localStorage,
 * so a story that left the browser pane "open" from an earlier state would
 * photograph the cluster with the browser button hidden - three controls minus one
 * - and every number read off it would be about a different arrangement.
 */
const Cluster = ({
	count,
	details,
	canvasOpen = false,
}: {
	count: number;
	details: ReturnType<typeof deriveRunDetails>;
	canvasOpen?: boolean;
}) => {
	useEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: false,
			isCanvasOpen: canvasOpen,
			isBrowserPaneOpen: false,
		});
	}, [canvasOpen]);
	return (
		<div className={cn("flex h-[84px] w-[560px] shrink-0 flex-col bg-canvas")}>
			<ChatHeader
				agentName="Core"
				description="Invoices workspace · on this machine"
				onOpenOptions={() => undefined}
				onOpenBrowser={() => undefined}
				browserAttentionCount={count}
				runDetails={details}
			/>
		</div>
	);
};

/** No badge: the cluster's own spacing and nothing else. */
export const NoApproval: Story = {
	render: () => (
		<Cluster count={0} details={deriveRunDetails(fixtures.idle())} />
	),
};

/** The badge drawn, at the count the acceptance test names first. */
export const OneApproval: Story = {
	render: () => (
		<Cluster count={1} details={deriveRunDetails(fixtures.idle())} />
	),
};

/** The badge at the widest it can be: `9+`, which is where the glyph cap lands. */
export const AtCap: Story = {
	render: () => (
		<Cluster count={12} details={deriveRunDetails(fixtures.idle())} />
	),
};

/** The run trigger's own dot, with no badge anywhere in the cluster. */
export const TriggerDot: Story = {
	render: () => (
		<Cluster count={0} details={deriveRunDetails(fixtures.jobsInFlight())} />
	),
};

/**
 * The badge drawn with the canvas open, so the canvas button - the box the badge's
 * room exists to clear - is unmounted. The cluster must stay at its 8px step here:
 * the same rule that earns the badge its 12px is the one that refuses it a
 * neighbour that is not rendered.
 */
export const CanvasOpenBadge: Story = {
	render: () => (
		<Cluster
			count={1}
			details={deriveRunDetails(fixtures.idle())}
			canvasOpen={true}
		/>
	),
};
