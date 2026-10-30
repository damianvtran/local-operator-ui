import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor, within } from "@storybook/test";
import type { FC } from "react";
import type {
	TeamBridgeDeliveryState,
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
): TeamBridgeMessage => ({
	id: "bcmsg_delivery01",
	conversation_id: "bcv_delivery01",
	seq: 1,
	sender: { account_id: "acct_me", kind: "human", display_label: "Ada" },
	body: "Can you pull the customer list for the Q3 renewal and send it over?",
	origin: "human",
	created_at: new Date().toISOString(),
	delivery_states,
});

const Thread: FC<{ states: TeamBridgeDeliveryState[] | undefined }> = ({
	states,
}) => (
	// Top padding leaves room for the tooltip panel, which opens above.
	<div className="flex w-[760px] flex-col bg-surface pt-24 text-ink">
		<TeamBridgeMessageList
			messages={[message(states)]}
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
 * The tooltip OPEN, through the path a click-first user takes (D3): the play
 * function presses the info button and waits for the panel, which is what the
 * shared trigger used to close. No forced `defaultOpen` (see `TooltipProps`).
 */
const openInfo =
	(panelText: () => string) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const [button] = within(canvasElement).getAllByRole("button", {
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
