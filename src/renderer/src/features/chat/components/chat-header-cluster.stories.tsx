/**
 * The chat header's action cluster, as a surface of its own: the `...` menu and the
 * Asks trigger (#872).
 *
 * WHY THIS FILE EXISTS. The operator reported the controls at the top right of the
 * chat header sitting slightly unevenly, and a claim about a GAP is a claim about
 * boxes the eye is bad at comparing across two stills. `scripts/header-cluster-
 * geometry.mjs` reads the boxes out of exactly this rendered state, and this file
 * is what makes that state reachable without a conversation: the real `ChatHeader`
 * needs an agent identity, a run model and the pane actions, and Storybook is the
 * only instrument here that can supply all of them with no backend and no session.
 *
 * THE FOUR PANEL TRIGGERS LEFT THIS CLUSTER (#872) and their states - the browser
 * count at one and at the cap, the run trigger's dot, the console blip in both of
 * its inks, the canvas-open arrangement - are `panel-rail.stories.tsx` now. What is
 * left here is what the header still owns: the menu (whose four panel entries are
 * the keyboard door) and the Asks trigger in each of its states. `NoApproval` keeps
 * its name because the committed capture rows and the menu frames are keyed on it;
 * it is the header with nothing to report.
 *
 * THE HEADER IS THE PRODUCTION COMPONENT in its production 56px band; the ground
 * under it is deliberately empty, because a gap is a fact about boxes and a
 * populated transcript would only be something else for the eye to go to.
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
 * The pane flags are SET rather than assumed, for the reason the run panel's
 * stories set theirs: the preference is persisted into the profile's localStorage,
 * so a story that did not set them would photograph whatever an earlier state left
 * behind, and every number read off it would be about a different arrangement.
 */
const Cluster = ({
	details,
	/*
	 * THE ASKS TRIGGER'S OWN KNOBS (operator ask, 2026-10-05). `onToggleAsks` is
	 * handed in for every story - the control is present whenever a host offers a
	 * door, which is what makes the badge's absence a fact about the COUNT rather
	 * than about a missing control - and the count/scope pair are the two readings
	 * the operator's split names: a conversation's own asks in a session, the whole
	 * fleet's at the top level.
	 */
	asksCount = 0,
	asksScope = "session",
	asksOpen = false,
}: {
	asksCount?: number;
	asksScope?: "session" | "fleet";
	asksOpen?: boolean;
	details: ReturnType<typeof deriveRunDetails>;
}) => {
	useEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: false,
			isCanvasOpen: false,
			isBrowserPaneOpen: false,
		});
	}, []);
	return (
		<div className={cn("flex h-[84px] w-[560px] shrink-0 flex-col bg-canvas")}>
			<ChatHeader
				agentName="Core"
				description="Invoices workspace · on this machine"
				onOpenOptions={() => undefined}
				onToggleBrowser={() => undefined}
				onOpenConsole={() => undefined}
				runDetails={details}
				onToggleAsks={() => undefined}
				asksAttentionCount={asksCount}
				asksScope={asksScope}
				asksOpen={asksOpen}
			/>
		</div>
	);
};

/** No badge: the cluster's own spacing and nothing else. */
export const NoApproval: Story = {
	render: () => <Cluster details={deriveRunDetails(fixtures.idle())} />,
};

/**
 * THE ASKS TRIGGER, QUIET: the control with nothing to report, which is the state
 * the operator asked to keep visible - the entry point is a door to the surface,
 * not a badge, so a conversation with no asks still offers it and the hub draws no
 * number.
 */
export const AsksQuiet: Story = {
	render: () => (
		<Cluster details={deriveRunDetails(fixtures.idle())} asksCount={0} />
	),
};

/**
 * THE ASKS TRIGGER WITH A COUNT (operator ask, 2026-10-05): the attention state
 * the operator asked to see at a glance, in a CONVERSATION context - the number is
 * this conversation's own queue, which is the `session` half of his split.
 */
export const AsksWaiting: Story = {
	render: () => (
		<Cluster
			details={deriveRunDetails(fixtures.idle())}
			asksCount={3}
			asksScope="session"
		/>
	),
};

/**
 * AND AT THE TOP LEVEL: the same control carrying the WHOLE fleet's count, which is
 * what the header resolves to on a draft (no conversation open). The count is
 * deliberately larger than `AsksWaiting`'s so the two stories cannot be confused
 * for one frame, and the tooltip/announced name state the scope in the surface's own
 * words (`All conversations`).
 */
export const AsksFleet: Story = {
	render: () => (
		<Cluster
			details={deriveRunDetails(fixtures.idle())}
			asksCount={11}
			asksScope="fleet"
		/>
	),
};

/** The trigger while its surface is up: mounted as a TOGGLE like the browser
 * trigger, so the count stays on screen (the shape the operator asked for - the
 * number must not disappear with the pane it opened). */
export const AsksOpen: Story = {
	render: () => (
		<Cluster
			details={deriveRunDetails(fixtures.idle())}
			asksCount={3}
			asksScope="session"
			asksOpen={true}
		/>
	),
};
