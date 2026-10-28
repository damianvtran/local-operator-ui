import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useEffect, useState } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { SHOT_WIDE_DATA_URL } from "./team-bridge-attachments.fixtures";
import {
	type TeamBridgeOrganization,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";
import type { TeamBridgeLocalRowPresentation } from "./team-bridge-send-presentation";

/** Full-page PRESENTATION proof, not a native send/API proof. The real list is
 * empty until the create receipt; only the shared projection supplies the row.
 * Theme remains the Storybook toolbar's choice, not a forced fixture palette. */
const tenantId = asTeamBridgeTenantId("tnt_first_send_fixture");
const self = "acct_first_send_ada";
const recipient = "acct_first_send_bea";
const clientRef = "first-send-fixture-stable-ref";
const localId = "local_first_send_fixture";
const serverId = "bcmsg_first_send_fixture";
const organization: TeamBridgeOrganization = {
	tenantId,
	name: "Northwind Collective",
	role: "owner",
	unread: 0,
};
const people: TeamBridgeDirectoryMember[] = [
	{
		account_id: self,
		display_label: "Ada",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active",
	},
	{
		account_id: recipient,
		display_label: "Bea",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_first_send_bea", name: "Aida", state: "active" },
	},
];

function FirstSendPage({
	state: initialState,
	targetKind,
	width,
	withImage,
	allowSwap,
}: {
	state: TeamBridgeLocalRowPresentation["state"];
	targetKind: "chief" | "person";
	width: "desktop" | "narrow";
	withImage: boolean;
	allowSwap: boolean;
}) {
	const [state, setState] = useState(initialState);
	const [discarded, setDiscarded] = useState(false);
	useEffect(() => {
		setState(initialState);
		setDiscarded(false);
	}, [initialState]);
	const confirmed = state === "confirmed";
	const id = confirmed ? serverId : localId;
	const conversationId = "bcv_first_send_fixture";
	const message: TeamBridgeMessage = {
		id,
		conversation_id: confirmed ? conversationId : "local_first_send_target",
		seq: confirmed ? 1 : 0,
		sender: { account_id: self, kind: "human", display_label: "Ada" },
		body: "Could you take a look at this before we start?",
		origin: "human",
		created_at: "2026-10-28T12:00:00Z",
		attachments: withImage
			? [
					{
						id: confirmed ? "batt_first_send_fixture" : "local_image_fixture",
						mime: "image/png",
						width: 480,
						height: 360,
						size: 1024,
						state: confirmed ? "bound" : "staged",
					},
				]
			: [],
	};
	// A create receipt is not a fake rail entry: keep conversations empty even
	// after confirmation and pass the resolved receipt through the page seam.
	const resolved: TeamBridgeConversation | null = confirmed
		? {
				id: conversationId,
				tenant_id: tenantId,
				kind: "dm",
				name: "",
				visibility: "private",
				agent_capable: targetKind === "chief",
				status: "open",
				created_by: self,
				latest_seq: 1,
				last_read_seq: 1,
				last_message_at: message.created_at,
				unread_count: 0,
				muted: false,
				members: [
					{
						account_id: self,
						kind: "human",
						display_label: "Ada",
						role: "owner",
						state: "active",
					},
					{
						account_id: recipient,
						kind: targetKind === "chief" ? "agent" : "human",
						display_label: targetKind === "chief" ? "Aida (Bea)" : "Bea",
						role: "member",
						state: "active",
					},
				],
			}
		: null;
	const sendRows = new Map<string, TeamBridgeLocalRowPresentation>();
	if (!discarded)
		sendRows.set(id, {
			clientRef,
			state,
			previewUrls: withImage ? [SHOT_WIDE_DATA_URL] : [],
			onRetry: () => setState("pending"),
			onDiscard: () => setDiscarded(true),
		});
	return (
		<div
			className="flex h-dvh max-w-full flex-col bg-canvas text-ink"
			style={{ width: width === "narrow" ? 680 : 1380 }}
		>
			{allowSwap && (
				<div className="flex shrink-0 items-center gap-3 border-hairline border-b bg-surface px-3 py-2 text-sm">
					<span>Projection fixture · no API dispatch</span>
					<Button onClick={() => setState("confirmed")}>
						Confirm server receipt
					</Button>
					<Button
						variant="ghost"
						onClick={() => {
							setDiscarded(false);
							setState("pending");
						}}
					>
						Reset pending
					</Button>
				</div>
			)}
			<div className="min-h-0 flex-1">
				<TeamBridgePageView
					selfAccountId={self}
					selfName="Ada"
					conversations={[]}
					resolvedConversation={resolved}
					target={{ type: targetKind, accountId: recipient }}
					messages={discarded ? [] : [message]}
					sendRows={sendRows}
					organizations={[organization]}
					scope={tenantId}
					totalUnread={0}
					people={people}
					peopleState="ready"
					listState="ready"
					messageState="ready"
					/* Return to draft is only decorated when the page can take a row
					 * back (design round 1, D4): without this the Failed story drew two
					 * of the three actions and the headline recovery affordance was
					 * never in any frame. The handler is a stub here, so this story
					 * evidences the ACTION SET, not the merge-with-typed-text behaviour -
					 * that half needs the live app. */
					onTakeBackSend={() => ({
						body: "Hi Ada, could we move the Wednesday review to Thursday?",
						attachments: [],
					})}
					onTarget={() => {}}
					onSend={() => undefined}
					onNewChannel={() => {}}
					onScopeChange={() => {}}
				/>
			</div>
		</div>
	);
}

const meta = {
	title: "Team Bridge/First send",
	component: FirstSendPage,
	parameters: { layout: "fullscreen" },
	args: {
		state: "pending",
		targetKind: "chief",
		width: "desktop",
		withImage: true,
		allowSwap: false,
	},
	argTypes: {
		state: { control: "select", options: ["pending", "failed", "confirmed"] },
		targetKind: { control: "select", options: ["chief", "person"] },
		width: { control: "select", options: ["desktop", "narrow"] },
	},
} satisfies Meta<typeof FirstSendPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};
export const Failed: Story = { args: { state: "failed" } };
export const Confirmed: Story = { args: { state: "confirmed" } };
export const PersonPending: Story = { args: { targetKind: "person" } };
export const NarrowFailed: Story = {
	args: { state: "failed", width: "narrow", targetKind: "person" },
};

/** These assertions are authored but not executed while the disk hold is active.
 * The image and row DOM identity assertions are the negative controls for a
 * superficial stable-URL fix that still remounts a wrapper or the image tile. */
export const Swap: Story = {
	args: { allowSwap: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const selector = (id: string) => `[data-message-id="${id}"]`;
		await waitFor(() =>
			expect(canvasElement.querySelector(selector(localId))).not.toBeNull(),
		);
		const row = canvasElement.querySelector(selector(localId));
		const image = row?.querySelector("img");
		expect(image).toBeTruthy();
		if (!row || !image) throw new Error("First-send fixture row/image missing");
		const before = image.getBoundingClientRect();
		expect(row).not.toHaveClass("lo-team-bridge-arrival");
		await userEvent.click(
			canvas.getByRole("button", { name: "Confirm server receipt" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector(selector(serverId))).toBe(row),
		);
		expect(row.querySelector("img")).toBe(image);
		expect(image.getAttribute("src")).toBe(SHOT_WIDE_DATA_URL);
		expect(row).not.toHaveClass("lo-team-bridge-arrival");
		expect(image.getBoundingClientRect().width).toBe(before.width);
		expect(image.getBoundingClientRect().height).toBe(before.height);
		expect(canvas.queryByText(t("ui.teamBridge.message.sending"))).toBeNull();
	},
};
