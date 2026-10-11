/**
 * The chat header's action cluster, as a surface of its own: the `...` menu (#872,
 * #896).
 *
 * WHY THIS FILE EXISTS. The operator reported the controls at the top right of the
 * chat header sitting slightly unevenly, and a claim about a GAP is a claim about
 * boxes the eye is bad at comparing across two stills. `scripts/header-cluster-
 * geometry.mjs` reads the boxes out of exactly this rendered state, and this file
 * is what makes that state reachable without a conversation: the real `ChatHeader`
 * needs an agent identity, a run model and the pane actions, and Storybook is the
 * only instrument here that can supply all of them with no backend and no session.
 *
 * THE FIVE PANEL TRIGGERS LEFT THIS CLUSTER (#872, #896) and their states - the
 * browser count at one and at the cap, the run trigger's dot, the console blip in
 * both of its inks, the canvas-open arrangement, and the asks item in each of its
 * states - are `panel-rail.stories.tsx` now. THE ASKS TRIGGER was the last of the
 * five (#896): its control moved to the rail, the menu gained an asks row
 * (`Open asks` / `Close asks`, the scope glyph), and what is left here is what the
 * header still owns: the menu (whose five panel entries are the keyboard door).
 * The asks stories below are the menu row's two variant states - reachable by
 * opening the menu (the capture recipes' press) - and the trigger's own visible
 * states are photographed on the rail, not here. `NoApproval` keeps
 * its name because the committed capture rows and the menu frames are keyed on it;
 * it is the header with nothing to report.
 *
 * THE HEADER IS THE PRODUCTION COMPONENT in its production 56px band; the ground
 * under it is deliberately empty, because a gap is a fact about boxes and a
 * populated transcript would only be something else for the eye to go to.
 *
 * A SESSION ID IS PASSED (#893), because the overflow menu's `Copy session ID`
 * item is drawn ONLY when `ChatHeader` receives one (`a draft has none`): a mount
 * without it renders a menu that silently contradicts the feature, and the three
 * captured menu dirs (`conversation-actions-open`, the two
 * `transcript-display-submenu-*`) would show a first row that is the submenu
 * rather than the id. The fixture id is 12 hex characters, the shape the app's
 * own session ids take.
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
	 * THE ASKS ROW'S KNOBS (#896). `onToggleAsks` is handed in for every story - the
	 * menu row is present whenever a host offers a door, which is what the
	 * entry's absence would be a fact about otherwise - and the scope/open pair are
	 * the two readings the operator's split names: the row's glyph is the scope's
	 * (a conversation's own queue in a session, the whole fleet's at the top level)
	 * and its label flips with `asksOpen`, like the browser row beside it.
	 */
	asksScope = "session",
	asksOpen = false,
}: {
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
				sessionId="4b7f2c9a1e05"
				onOpenOptions={() => undefined}
				onToggleBrowser={() => undefined}
				onOpenConsole={() => undefined}
				runDetails={details}
				onToggleAsks={() => undefined}
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

/*
 * THE ASKS ROW, IN THE TWO STATES THAT DIFFER (#896). The trigger this file used to
 * stage - quiet, waiting, open - moved to the panel rail (see
 * `panel-rail.stories.tsx`'s Asks* stories for those frames); what remains here is
 * the MENU ROW, whose only two variant readings are its scope glyph and its
 * open/close label, so those are the two stories. Both reach the row by opening the
 * `...` menu (the capture recipes' press), which is also why the quiet/waiting pair
 * - identical frames now - is gone rather than kept as two mounts that photograph
 * the same header.
 */

/**
 * AT THE TOP LEVEL: the row's glyph is the scope's (a stack of bubbles - the same
 * pairing the rail item draws, `AsksScopeIcon`). The scope-legibility claim (UX
 * round 1, U3) is assertable on the RAIL item's `data-ask-scope` (#896 moved it
 * there); this story is the menu's half of the same pairing.
 */
export const AsksFleet: Story = {
	render: () => (
		<Cluster details={deriveRunDetails(fixtures.idle())} asksScope="fleet" />
	),
};

/** The row while its surface is up: mounted as a TOGGLE like the browser row, so
 * the label reads `Close asks` - the same one-string-two-directions idiom. */
export const AsksOpen: Story = {
	render: () => (
		<Cluster
			details={deriveRunDetails(fixtures.idle())}
			asksScope="session"
			asksOpen={true}
		/>
	),
};
