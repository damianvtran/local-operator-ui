import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type {
	TeamBridgeAttachment,
	TeamBridgeMessage,
	TeamBridgeScheduledMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeAttachmentStrip } from "./team-bridge-attachments";
import { rememberUploadPreview } from "./team-bridge-attachments-model";
import {
	SHOT_GREEN_B64,
	SHOT_RED_B64,
	SHOT_TALL_B64,
	SHOT_WIDE_B64,
} from "./team-bridge-attachments.fixtures";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { TeamBridgeScheduledRow } from "./team-bridge-scheduled";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";
import type {
	AttachmentChip,
	TeamBridgeAttachmentsState,
} from "./use-team-bridge-attachments";

/*
 * Team Bridge image attachments, every state a reviewer has to see:
 * composer chips (uploading / error / expired / ready / unsupported note),
 * a message with 1 and 4 images, image-only, expired/unavailable/failed
 * placeholders, a thread reply with images, and a scheduled row.
 *
 * WHAT IS MOCKED: the preload media relay (`window.api.desktop.media`) answers
 * `team_bridge.attachment` from synthetic PNG fixtures (generated pixels - no
 * user data); `batt_broken` answers 404 to show the failed state. No hub or
 * runtime is involved, so these frames show the renderer's states, not
 * end-to-end delivery.
 */

const BYTES: Record<string, string> = {
	batt_wide: SHOT_WIDE_B64,
	batt_tall: SHOT_TALL_B64,
	batt_green: SHOT_GREEN_B64,
	batt_red: SHOT_RED_B64,
};
const decode = (b64: string) =>
	Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));

const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string; attachmentId?: string }) => {
			const b64 =
				request.op === "team_bridge.attachment" && request.attachmentId
					? BYTES[request.attachmentId]
					: undefined;
			return b64
				? {
						status: 200,
						kind: "bytes",
						mimeType: "image/png",
						data: decode(b64),
					}
				: { status: 404, kind: "error", detail: "Not in this story." };
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};
installMedia();

const blobUrl = (b64: string) =>
	URL.createObjectURL(new Blob([decode(b64)], { type: "image/png" }));

const descriptor = (
	id: string,
	width: number,
	height: number,
	state?: string,
): TeamBridgeAttachment => ({
	id,
	mime: "image/png",
	size: 1000,
	width,
	height,
	...(state ? { state } : {}),
});

const message = (overrides: Partial<TeamBridgeMessage>): TeamBridgeMessage => ({
	id: "bmsg_story_1",
	conversation_id: "bcv_story",
	seq: 1,
	sender: { account_id: "acct_ada", kind: "human", display_label: "Ada" },
	body: "",
	origin: "human",
	created_at: new Date().toISOString(),
	...overrides,
});

/* ------------------------------- composer -------------------------------- */

const chipState = (
	chips: AttachmentChip[],
	notice: TeamBridgeAttachmentsState["notice"] = null,
): TeamBridgeAttachmentsState => ({
	chips,
	notice,
	dismissNotice: () => {},
	add: () => {},
	remove: () => {},
	retry: () => {},
	uploadHeld: async () => [],
	readyIds: () => [],
	markExpired: () => {},
	clearSent: () => {},
	busy: chips.some((c) => c.status === "uploading" || c.status === "preparing"),
	blocked: chips.some((c) => c.status === "error" || c.status === "expired"),
	held: chips.some((c) => c.status === "held"),
	count: chips.length,
	max: 4,
	enabled: notice !== "unsupported",
});

const prepared = {
	bytes: new Uint8Array(1),
	mime: "image/png" as const,
	width: 1,
	height: 1,
};

const Composer: FC<{ state: TeamBridgeAttachmentsState }> = ({ state }) => (
	<div className="w-[560px] bg-surface p-4 text-ink">
		<div className="rounded-xl bg-elevated">
			<TeamBridgeAttachmentStrip state={state} />
			<div className="px-3.5 pt-3 pb-3 text-[14px] text-ink-dim">
				Message #design-review
			</div>
		</div>
	</div>
);

const meta = {
	title: "Team Bridge/Attachments",
	component: Composer,
	parameters: { layout: "centered" },
	args: { state: chipState([]) },
} satisfies Meta<typeof Composer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChipsUploading: Story = {
	args: {
		state: chipState([
			{
				key: "a",
				status: "uploading",
				previewUrl: blobUrl(SHOT_WIDE_B64),
				prepared,
			},
			{ key: "b", status: "preparing" },
		]),
	},
};

export const ChipsReady: Story = {
	args: {
		state: chipState([
			{ key: "a", status: "ready", previewUrl: blobUrl(SHOT_WIDE_B64) },
			{ key: "b", status: "ready", previewUrl: blobUrl(SHOT_TALL_B64) },
			{ key: "c", status: "ready", previewUrl: blobUrl(SHOT_GREEN_B64) },
			{ key: "d", status: "ready", previewUrl: blobUrl(SHOT_RED_B64) },
		]),
	},
};

export const ChipsError: Story = {
	args: {
		state: chipState([
			{ key: "a", status: "ready", previewUrl: blobUrl(SHOT_WIDE_B64) },
			{
				key: "b",
				status: "error",
				reason: "too_large",
				previewUrl: blobUrl(SHOT_TALL_B64),
				prepared,
			},
		]),
	},
};

export const ChipsExpiredRestored: Story = {
	args: {
		state: chipState([
			{ key: "a", status: "expired" },
			{ key: "b", status: "ready" },
		]),
	},
};

export const ChipsLimitReached: Story = {
	args: {
		state: chipState(
			[
				{ key: "a", status: "ready", previewUrl: blobUrl(SHOT_WIDE_B64) },
				{ key: "b", status: "ready", previewUrl: blobUrl(SHOT_TALL_B64) },
				{ key: "c", status: "ready", previewUrl: blobUrl(SHOT_GREEN_B64) },
				{ key: "d", status: "ready", previewUrl: blobUrl(SHOT_RED_B64) },
			],
			"limit",
		),
	},
};

export const PasteUnsupported: Story = {
	args: { state: chipState([], "unsupported") },
};

/* -------------------------------- bubbles -------------------------------- */

const Thread: FC<{ messages: TeamBridgeMessage[] }> = ({ messages }) => (
	<div className="flex w-[760px] flex-col bg-surface text-ink">
		<TeamBridgeMessageList
			messages={messages}
			labelFor={(sender) => sender.display_label}
			tenantId="tnt_story"
		/>
	</div>
);

export const BubbleOneImage: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Here's the empty state after the fix.",
					attachments: [descriptor("batt_wide", 240, 150)],
				}),
			]}
		/>
	),
};

export const BubbleFourImages: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "All four states from QA:",
					attachments: [
						descriptor("batt_wide", 240, 150),
						descriptor("batt_tall", 120, 180),
						descriptor("batt_green", 200, 140),
						descriptor("batt_red", 160, 160),
					],
				}),
			]}
		/>
	),
};

export const BubbleImageOnly: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "",
					attachments: [descriptor("batt_green", 200, 140)],
				}),
			]}
		/>
	),
};

export const BubblePlaceholders: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Older screenshots (retention, withheld, and a failed load):",
					attachments: [
						descriptor("batt_old", 240, 150, "expired"),
						descriptor("batt_gone", 240, 150, "deleted"),
						descriptor("batt_withheld", 240, 150, "withheld"),
						descriptor("batt_broken", 240, 150),
					],
				}),
			]}
		/>
	),
};

export const BubbleMarkdownImageStaysText: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Body text cannot load pictures: ![tracking pixel](http://localhost:1111/v1/status)",
				}),
			]}
		/>
	),
};

/* -------------------------------- thread --------------------------------- */

export const ThreadReplyWithImages: StoryObj<typeof TeamBridgeThreadPaneView> =
	{
		render: () => {
			const root = message({
				id: "bmsg_root",
				body: "Can someone check the new chip states?",
				reply_count: 1,
			});
			return (
				<div className="flex h-[640px] bg-surface text-ink">
					<div className="flex-1 p-6 text-ink-muted">#design-review</div>
					<TeamBridgeThreadPaneView
						root={root}
						replies={[
							message({
								id: "bmsg_reply",
								seq: 2,
								thread_root_id: "bmsg_root",
								sender: {
									account_id: "acct_bea",
									kind: "human",
									display_label: "Bea",
								},
								body: "Before / after:",
								attachments: [
									descriptor("batt_tall", 120, 180),
									descriptor("batt_red", 160, 160),
								],
							}),
						]}
						state="ready"
						labelFor={(sender) => sender.display_label}
						onClose={() => {}}
						onRetry={() => {}}
						onSend={async () => {}}
						tenantId="tnt_story"
						conversationId="bcv_story"
						accountId="acct_ada"
						attachmentCapability={{
							enabled: true,
							max_count: 4,
							max_bytes: 5 * 1024 * 1024,
							mime_types: ["image/png", "image/jpeg"],
						}}
					/>
				</div>
			);
		},
	};

/* ------------------------------- scheduled ------------------------------- */

export const ScheduledWithImages: StoryObj<typeof TeamBridgeScheduledRow> = {
	render: () => {
		// One image this session uploaded (its preview is in memory); one restored.
		rememberUploadPreview(
			"acct_ada",
			"batt_mine",
			new Blob([decode(SHOT_GREEN_B64)], { type: "image/png" }),
		);
		const row: TeamBridgeScheduledMessage = {
			id: "bsch_story",
			tenant_id: "tnt_story",
			conversation_id: "bcv_story",
			body: "Release notes screenshots for tomorrow.",
			send_at: new Date(Date.now() + 86_400_000).toISOString(),
			status: "scheduled",
			created_at: new Date().toISOString(),
			attachments: [
				descriptor("batt_mine", 200, 140, "reserved"),
				descriptor("batt_restored", 240, 150, "reserved"),
			],
		};
		return (
			<div className="w-[560px] bg-surface p-4">
				<TeamBridgeScheduledRow
					message={row}
					refresh={async () => {}}
					accountId="acct_ada"
				/>
			</div>
		);
	},
};
