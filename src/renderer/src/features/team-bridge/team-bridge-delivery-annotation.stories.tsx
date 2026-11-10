import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor, within } from "@storybook/test";
import type { FC } from "react";
import type {
	TeamBridgeDeliveryState,
	TeamBridgeDeliverySummary,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";

/*
 * Team Bridge per-recipient delivery annotation (delivery-state contract v1),
 * drawn inside the real message list so the muted line is judged against the
 * body and header it sits under. Every state a reviewer has to see: refused
 * with and without a class, held as the sender sees it (no reason) and as the
 * recipient's owner sees it (with the reason, and the separate "screened,
 * delivery pending" line), several recipients at once, delivered (nothing),
 * and each of the two tooltip texts OPEN (design review round 1, D6). Switch
 * the toolbar theme to check light and dark.
 *
 * WHAT IS MOCKED: the `delivery_states` arrays are synthetic hub answers; no
 * hub or runtime is involved, so these frames show the renderer's states, not
 * which viewer the hub sends them to.
 */

const state = (
	over: Partial<TeamBridgeDeliveryState>,
): TeamBridgeDeliveryState => ({
	endpoint_id: "bep_aida",
	recipient_label: "Aida",
	recipient_owner_label: "Sam Rivera",
	state: "refused",
	...over,
});

const message = (
	delivery_states: TeamBridgeDeliveryState[] | undefined,
	senderKind: "human" | "agent",
	delivery_summary?: TeamBridgeDeliverySummary,
): TeamBridgeMessage => ({
	id: "bcmsg_delivery01",
	conversation_id: "bcv_delivery01",
	seq: 1,
	sender: { account_id: "acct_me", kind: senderKind, display_label: "Ada" },
	body: "Can you pull the customer list for the Q3 renewal and send it over?",
	origin: senderKind,
	created_at: new Date().toISOString(),
	delivery_states,
	delivery_summary,
});

const Thread: FC<{
	states: TeamBridgeDeliveryState[] | undefined;
	/* The hub's neutral per-message counts (every member receives them). */
	summary?: TeamBridgeDeliverySummary;
	senderKind?: "human" | "agent";
	/* Pane width in px; the default is the desktop thread column. */
	width?: number;
}> = ({ states, summary, senderKind = "human", width = 760 }) => (
	// Top padding leaves room for the tooltip panel, which opens above.
	<div className="flex flex-col bg-surface pt-24 text-ink" style={{ width }}>
		<TeamBridgeMessageList
			messages={[message(states, senderKind, summary)]}
			labelFor={(sender) => sender.display_label}
			tenantId="tnt_story"
		/>
	</div>
);

const meta = {
	title: "Team Bridge/Delivery annotation",
	component: Thread,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Thread>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RefusedWithClass: Story = {
	args: { states: [state({ refusal_class: "personal_info" })] },
};

export const RefusedWithoutClass: Story = {
	args: { states: [state({})] },
};

export const HeldSenderView: Story = {
	args: { states: [state({ state: "held" })] },
};

export const HeldOwnerView: Story = {
	args: {
		states: [state({ state: "held", hold_class: "screening_unavailable" })],
	},
};

export const DeliveryPendingOwnerView: Story = {
	args: {
		states: [state({ state: "held", hold_class: "delivery_pending" })],
	},
};

export const MultiRecipient: Story = {
	args: {
		states: [
			state({ refusal_class: "out_of_scope" }),
			state({
				endpoint_id: "bep_bo",
				recipient_label: "Bo's assistant",
				recipient_owner_label: "Bo Chen",
				state: "delivered",
			}),
			state({
				endpoint_id: "bep_cy",
				recipient_label: "Cy",
				recipient_owner_label: "Cyrus Patel",
			}),
			state({
				endpoint_id: "bep_dee",
				recipient_label: "Dee",
				recipient_owner_label: "Dana Ortiz",
				state: "held",
			}),
		],
	},
};

export const Delivered: Story = {
	args: { states: [state({ state: "delivered" })] },
};

/*
 * The summary's details popover OPEN, through a press on the summary line (the
 * per-recipient lines live inside it since 2026-11-09).
 */
const openDetails = async ({
	canvasElement,
}: {
	canvasElement: HTMLElement;
}) => {
	const [summary] = within(canvasElement).getAllByRole("button");
	await userEvent.click(summary);
	await waitFor(() =>
		expect(
			screen.getByRole("dialog", {
				name: t("ui.teamBridge.delivery.summary.details_label"),
			}),
		).toBeVisible(),
	);
};

/*
 * The tooltip OPEN, through the path a click-first user takes (D3): the play
 * function presses the info button and waits for the panel, which is what the
 * shared trigger used to close. No forced `defaultOpen` (see `TooltipProps`).
 */
const openInfo =
	(panelText: () => string) =>
	async (context: { canvasElement: HTMLElement }) => {
		await openDetails(context);
		const [button] = screen.getAllByRole("button", {
			name: t("ui.teamBridge.delivery.info_label"),
		});
		await userEvent.click(button);
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toHaveTextContent(panelText()),
		);
	};

export const RefusedTooltipOpen: Story = {
	args: { states: [state({ refusal_class: "out_of_scope" })] },
	play: openInfo(() => t("ui.teamBridge.delivery.info_refused")),
};

export const HeldTooltipOpen: Story = {
	args: { states: [state({ state: "held" })] },
	play: openInfo(() => t("ui.teamBridge.delivery.info_held")),
};

// Even deliberately over-disclosed wire fixtures must render generic agent
// non-delivery. The same state still retains a coarse hint for known humans.
export const AgentRefusalWithSuppliedClass: Story = {
	args: {
		senderKind: "agent",
		states: [state({ refusal_class: "abusive" })],
	},
};

export const AgentMixedPartialDelivery: Story = {
	args: {
		senderKind: "agent",
		states: [
			state({ refusal_class: "personal_info" }),
			state({
				endpoint_id: "bep_bo",
				recipient_label: "Bo",
				state: "delivered",
			}),
			state({
				endpoint_id: "bep_cy",
				recipient_label: "Cy",
				state: "held",
			}),
		],
	},
};

/*
 * The recipient label as older clients stored it (operator report,
 * 2026-11-03). An agent member written before the composition fix holds the
 * already composed "Aida (Ben Tran)", and an endpoint enrolled without an agent
 * name holds its owner's name. Each line must name its recipient the way the
 * message rows do: the owner exactly once, or "Ben Tran's chief of staff".
 * Refused, held and pending are drawn together because all three templates
 * take the one composed `{recipient}`.
 */
/*
 * WRAPPED LINES AT A NARROW PANE (design review D2 on #1643). Every delivery
 * template at once, in a column narrow enough that each wraps, so the info
 * glyph's position on the LAST line can be judged: it must sit after the
 * sentence's final word, never alone on a continuation line. Pin a locale with
 * `?args=locale:ru` (the locale D2 was found in) and nudge `width` to move the
 * break; the glyph travels with the last word at every width.
 *
 * AN RTL LOCALE IS ACTUALLY RTL HERE ONLY BECAUSE THE PREVIEW WRITES IT
 * (design review D1 on #1666): `LocaleFrame` in `.storybook/preview.tsx` calls
 * the app's own `applyDocumentDirection` for the pinned locale, so
 * `?args=locale:ur` measures `direction: rtl` on `html` and on the rows and the
 * glyph lands at the inline END. Before that, this story's ur frames were Urdu
 * text laid out LTR while the evidence text claimed otherwise.
 */
export const NarrowWrappedLines: Story = {
	args: {
		width: 340,
		states: [
			state({
				endpoint_id: "bep_scope",
				recipient_label: "Ben Tran",
				recipient_owner_label: "Ben Tran",
				refusal_class: "out_of_scope",
			}),
			state({ endpoint_id: "bep_generic" }),
			state({
				endpoint_id: "bep_held",
				state: "held",
				hold_class: "screening_unavailable",
			}),
		],
	},
};

export const LegacyComposedRecipientLabels: Story = {
	args: {
		states: [
			state({
				endpoint_id: "bep_aida",
				recipient_label: "Aida (Ben Tran)",
				recipient_owner_label: "Ben Tran",
			}),
			state({
				endpoint_id: "bep_orion",
				recipient_label: "Orion (Sherman Lee)",
				recipient_owner_label: "Sherman Lee",
				state: "held",
			}),
			state({
				endpoint_id: "bep_cy",
				recipient_label: "Cy (Cyrus Patel)",
				recipient_owner_label: "Cyrus Patel",
				state: "held",
				hold_class: "delivery_pending",
			}),
			state({
				endpoint_id: "bep_dana",
				recipient_label: "Dana Ortiz",
				recipient_owner_label: "Dana Ortiz",
			}),
		],
	},
};

/*
 * THE COLLAPSED SUMMARY (operator report 2026-11-09). One line per message in
 * DMs, groups and channels; the sender sees it as a button whose popover holds
 * the per-recipient lines, every other member sees the hub's neutral counts as
 * plain text. Switch the toolbar theme for light/dark.
 */
const CHANNEL_STATES: TeamBridgeDeliveryState[] = [
	state({
		endpoint_id: "bep_sana",
		recipient_label: "Sana",
		recipient_owner_label: "Sana Iqbal",
		refusal_class: "out_of_scope",
	}),
	state({
		endpoint_id: "bep_orion",
		recipient_label: "Orion",
		recipient_owner_label: "Sherman Lee",
	}),
	/* `phase` as the hub sends it to the sender (cross-PR contract), so every
	 * summary segment has a row behind it (design D1). */
	state({
		endpoint_id: "bep_aida",
		recipient_label: "Aida",
		recipient_owner_label: "Ben Tran",
		state: "held",
		phase: "held",
	}),
	state({
		endpoint_id: "bep_dot",
		recipient_label: "Dot",
		recipient_owner_label: "Ana Ruiz",
		state: "held",
		phase: "screening",
	}),
	state({
		endpoint_id: "bep_eli",
		recipient_label: "Eli",
		recipient_owner_label: "Eli Novak",
		state: "delivered",
	}),
	state({
		endpoint_id: "bep_bo",
		recipient_label: "Bo",
		recipient_owner_label: "Bo Chen",
		state: "delivered",
	}),
	state({
		endpoint_id: "bep_cy",
		recipient_label: "Cy",
		recipient_owner_label: "Cyrus Patel",
		state: "delivered",
	}),
];

/* The hub summary and the sender's entries describe the SAME seven
 * recipients, as the contract guarantees (design D1). */
const CHANNEL_SUMMARY = {
	total: 7,
	delivered: 3,
	screening: 1,
	held: 1,
	not_reviewed: 0,
	not_delivered: 2,
};

export const SummarySenderView: Story = {
	args: { states: CHANNEL_STATES, summary: CHANNEL_SUMMARY },
};

export const SummarySenderDetailsOpen: Story = {
	args: SummarySenderView.args,
	play: openDetails,
};

/* A member who is neither the sender nor an affected agent's owner: counts only. */
export const SummaryNonSenderView: Story = {
	args: { states: undefined, summary: CHANNEL_SUMMARY },
};

/* Everything delivered: renders NOTHING (operator 2026-11-10: a "Delivered to
 * N" under every message cluttered the channel; silence now means complete). */
export const SummaryAllDelivered: Story = {
	args: {
		states: undefined,
		summary: { total: 3, delivered: 3 },
	},
};

/* Still in progress: the line stays until every recipient is delivered. */
export const SummaryOneBeingScreened: Story = {
	args: {
		states: undefined,
		summary: { total: 6, delivered: 5, screening: 1 },
	},
};

/* A day later with no decision: the row says what happened and what to do
 * (UX U2); the footer covers a stale count the rows cannot name. */
export const SummaryNotReviewedOpen: Story = {
	args: {
		states: [
			state({
				endpoint_id: "bep_aida",
				recipient_label: "Aida",
				recipient_owner_label: "Ben Tran",
				state: "held",
				phase: "not_reviewed",
			}),
		],
		summary: { total: 3, delivered: 1, not_reviewed: 2 },
	},
	play: openDetails,
};

/* An older hub: no summary, so the sender's counts derive from their entries. */
export const SummaryDerivedWithoutHubSummary: Story = {
	args: { states: CHANNEL_STATES },
};

export const SummarySingleRecipientDm: Story = {
	args: {
		states: [
			state({
				endpoint_id: "bep_aida",
				recipient_label: "Aida",
				recipient_owner_label: "Ben Tran",
				state: "held",
				phase: "held",
			}),
		],
		summary: { total: 1, held: 1 },
	},
};

export const SummarySingleRecipientDmOpen: Story = {
	args: SummarySingleRecipientDm.args,
	play: openDetails,
};

/* A narrow pane: the line truncates on one line rather than wrapping, and
 * "Delivered to 12" gives way first (design D5). */
export const SummaryNarrowTruncates: Story = {
	args: {
		width: 240,
		states: undefined,
		summary: {
			total: 22,
			delivered: 12,
			screening: 3,
			held: 2,
			not_reviewed: 1,
			not_delivered: 4,
		},
	},
};

/* ONE RECIPIENT IN TOTAL (operator request 2026-11-10): a 1:1 conversation
 * reads "Delivered" / "Being screened", not "Delivered to 1" / "1 being
 * screened"; the count adds nothing when there is only one recipient. */
export const SummarySingleRecipientDelivered: Story = {
	args: { states: undefined, summary: { total: 1, delivered: 1 } },
};

export const SummarySingleRecipientScreening: Story = {
	args: { states: undefined, summary: { total: 1, screening: 1 } },
};

/* Several recipients with one bucket at 1 KEEP their counts: "Delivered ·
 * 1 being screened" would hide how many received it. */
export const SummaryMultiRecipientOneScreening: Story = {
	args: {
		states: undefined,
		summary: { total: 3, delivered: 2, screening: 1 },
	},
};
