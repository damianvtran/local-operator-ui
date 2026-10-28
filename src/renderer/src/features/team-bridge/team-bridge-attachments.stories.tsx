import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor, within } from "@storybook/test";
import type { FC, ReactNode } from "react";
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

const DELAY_PREFIX = /^batt_delay_/;
const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string; attachmentId?: string }) => {
			const id = request.attachmentId ?? "";
			/*
			 * Loading-state ids. `batt_hold_*` NEVER answers, so the reserved box
			 * can be captured for as long as needed; `batt_delay_*` answers after
			 * 1.5 s with a real picture, so consecutive loading -> loaded frames show
			 * whether anything moves when the bytes land (design round 1, D4 gap).
			 */
			if (id.startsWith("batt_hold_")) return new Promise(() => {});
			if (id.startsWith("batt_delay_"))
				await new Promise((done) => setTimeout(done, 1500));
			const b64 =
				request.op === "team_bridge.attachment"
					? BYTES[id.replace(DELAY_PREFIX, "batt_")]
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

const CAPABILITY = {
	enabled: true,
	max_count: 4,
	max_bytes: 5 * 1024 * 1024,
	mime_types: ["image/png", "image/jpeg"],
};

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
	/* The composer can take a failed send's images back; a story fixture that
	 * cannot is a state the real component can never be in. */
	restore: () => {},
	clearSent: () => {},
	detachForSend: () => [...chips],
	busy: chips.some((c) => c.status === "uploading" || c.status === "preparing"),
	blocked: chips.some((c) => c.status === "error" || c.status === "expired"),
	held: chips.some((c) => c.status === "held"),
	count: chips.length,
	max: 4,
	enabled: notice !== "unsupported",
	unsupported: false,
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

/** D15: the runtime lost its sign-in mid-compose (401). The chip names the
 * sign-in fact and offers Remove only - a Retry would 401 again (r7 M2). */
export const ChipsSignedOut: Story = {
	args: {
		state: chipState([
			{ key: "a", status: "ready", previewUrl: blobUrl(SHOT_WIDE_B64) },
			{
				key: "b",
				status: "error",
				reason: "signed_out",
				previewUrl: blobUrl(SHOT_TALL_B64),
				prepared,
			},
		]),
	},
};

/** Restored from a draft after a reload: expired (remove-only) beside a good
 * chip whose bytes this session no longer holds (neutral glyph, D1). */
export const ChipsExpiredRestored: Story = {
	args: {
		state: chipState([
			{ key: "a", status: "expired" },
			{ key: "b", status: "ready" },
		]),
	},
};

/** Expired while this session still holds the bytes: Retry is offered and the
 * note says so (D1). */
export const ChipsExpiredRetryable: Story = {
	args: {
		state: chipState([
			{
				key: "a",
				status: "expired",
				previewUrl: blobUrl(SHOT_GREEN_B64),
				prepared,
			},
		]),
	},
};

/** Two failures: the note names the chip it describes ("Image 2 of 3: …", D10). */
export const ChipsMultipleErrors: Story = {
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
			{
				key: "c",
				status: "error",
				reason: "unsupported",
				prepared,
			},
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
						attachmentCapability={CAPABILITY}
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

/* ------------------------- widths (design round 2) ------------------------ */

/*
 * Width decorators: the composer, the four-image message and the thread at the
 * two widths the desktop window realistically spans. The containers FLEX here
 * (no fixed `w-[560px]`), so wrap behaviour is what is on screen.
 */
const AtWidth: FC<{ width: number; children: ReactNode }> = ({
	width,
	children,
}) => (
	<div style={{ width }} className="flex flex-col bg-surface text-ink">
		{children}
	</div>
);

const fourImages = message({
	body: "All four states from QA:",
	attachments: [
		descriptor("batt_wide", 240, 150),
		descriptor("batt_tall", 120, 180),
		descriptor("batt_green", 200, 140),
		descriptor("batt_red", 160, 160),
	],
});

const fourChips = chipState([
	{ key: "a", status: "ready", previewUrl: blobUrl(SHOT_WIDE_B64) },
	{
		key: "b",
		status: "uploading",
		previewUrl: blobUrl(SHOT_TALL_B64),
		prepared,
	},
	{
		key: "c",
		status: "error",
		reason: "too_large",
		previewUrl: blobUrl(SHOT_GREEN_B64),
		prepared,
	},
	{ key: "d", status: "ready" },
]);

const widthStories = (width: number) => ({
	grid: {
		parameters: { layout: "fullscreen" },
		render: () => (
			<AtWidth width={width}>
				<TeamBridgeMessageList
					messages={[fourImages]}
					labelFor={(sender) => sender.display_label}
					tenantId="tnt_story"
				/>
			</AtWidth>
		),
	},
	chips: {
		parameters: { layout: "fullscreen" },
		render: () => (
			<AtWidth width={width}>
				<div className="p-4">
					<div className="rounded-xl bg-elevated">
						<TeamBridgeAttachmentStrip state={fourChips} />
						<div className="px-3.5 pt-3 pb-3 text-[14px] text-ink-dim">
							Message #design-review
						</div>
					</div>
				</div>
			</AtWidth>
		),
	},
	thread: {
		parameters: { layout: "fullscreen" },
		render: () => (
			<div style={{ width }} className="flex h-[640px] bg-surface text-ink">
				<div className="flex-1 p-6 text-ink-muted">#design-review</div>
				<TeamBridgeThreadPaneView
					root={message({
						id: "bmsg_root",
						body: "Chip states?",
						reply_count: 1,
					})}
					replies={[
						{
							...fourImages,
							id: "bmsg_reply",
							seq: 2,
							thread_root_id: "bmsg_root",
						},
					]}
					state="ready"
					labelFor={(sender) => sender.display_label}
					onClose={() => {}}
					onRetry={() => {}}
					onSend={async () => {}}
					tenantId="tnt_story"
					conversationId="bcv_story"
					accountId="acct_ada"
					attachmentCapability={CAPABILITY}
				/>
			</div>
		),
	},
});
const narrow = widthStories(800);
const wide = widthStories(1440);
export const NarrowFourImageGrid: StoryObj = narrow.grid;
export const NarrowChips: StoryObj = narrow.chips;
export const NarrowThread: StoryObj = narrow.thread;
export const WideFourImageGrid: StoryObj = wide.grid;
export const WideChips: StoryObj = wide.chips;
export const WideThread: StoryObj = wide.thread;

/* ----------------------------- loading frames ----------------------------- */

/** The reserved box held indefinitely (the relay never answers). */
export const BubbleLoadingHeld: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Reserved boxes while bytes are on their way:",
					attachments: [
						descriptor("batt_hold_1", 240, 150),
						descriptor("batt_hold_2", 120, 180),
					],
				}),
				message({
					id: "bmsg_after",
					seq: 2,
					body: "The message below must not move.",
				}),
			]}
		/>
	),
};

/** Loads after 1.5 s: capture frames before and after to compare geometry. */
export const BubbleLoadingDelayed: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Single image, delayed relay:",
					attachments: [descriptor("batt_delay_wide", 240, 150)],
				}),
				message({
					id: "bmsg_after",
					seq: 2,
					body: "The message below must not move.",
				}),
			]}
		/>
	),
};

/* ------------------------------ lightbox keys ----------------------------- */

/**
 * Opens image 2 of 4, walks with ArrowRight/ArrowLeft, checks Tab stays
 * inside the dialog (focus trap), closes with Escape and asserts focus
 * returns to the tile that opened it.
 *
 * Queries are by the dialog's HEADING role: the lightbox renders its position
 * twice (the sr-only `DialogTitle` and an `aria-live` announcer), so a text
 * query is ambiguous and stopped the round-2 run at step 5 (D11).
 */
export const LightboxKeyboard: StoryObj<typeof Thread> = {
	render: () => <Thread messages={[fourImages]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tile = await canvas.findByRole("button", {
			name: "Open image 2 of 4",
		});
		await waitFor(() => expect(tile).not.toBeDisabled());
		await userEvent.click(tile);
		const dialog = await screen.findByRole("dialog");
		const at = (name: string) =>
			waitFor(() =>
				expect(
					within(dialog).getByRole("heading", { name }),
				).toBeInTheDocument(),
			);
		await at("Image 2 of 4");
		await userEvent.keyboard("{ArrowRight}");
		await at("Image 3 of 4");
		await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
		await at("Image 1 of 4");
		// Focus trap: a full lap of Tab (more presses than controls) never
		// leaves the dialog.
		for (let press = 0; press < 10; press += 1) {
			await userEvent.tab();
			await expect(dialog.contains(document.activeElement)).toBe(true);
		}
		await userEvent.tab({ shift: true });
		await expect(dialog.contains(document.activeElement)).toBe(true);
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(tile).toHaveFocus());
	},
};
