import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor, within } from "@storybook/test";
import { type FC, type ReactNode, useLayoutEffect } from "react";
import type {
	TeamBridgeAttachment,
	TeamBridgeMessage,
	TeamBridgeScheduledMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeAttachmentStrip } from "./team-bridge-attachments";
import { rememberUploadPreview } from "./team-bridge-attachments-model";
import {
	SHOT_GREEN_B64,
	SHOT_PANORAMA_B64,
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
	/* Extra ids for the inline-image grid and letterbox stories: the same
	   synthetic pixels under distinct ids, because an id is a list key. */
	batt_fifth: SHOT_GREEN_B64,
	batt_sixth: SHOT_WIDE_B64,
	batt_pano: SHOT_PANORAMA_B64,
	batt_tall: SHOT_TALL_B64,
	batt_green: SHOT_GREEN_B64,
	batt_red: SHOT_RED_B64,
};
const decode = (b64: string) =>
	Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));

const DELAY_PREFIX = /^batt_delay_/;
// Explicit gates let QA capture pending, ready and settled frames without a
// timer race. Synthetic authority is required by the real member component.
const controlledMedia = new Map<string, () => void>();
const controlledAttempts = new Map<string, number>();
const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string; attachmentId?: string }) => {
			const id = request.attachmentId ?? "";
			if (id.startsWith("batt_refused_"))
				return {
					status: Number(id.slice("batt_refused_".length)),
					kind: "error",
				};
			if (id.startsWith("batt_control_") || id.startsWith("batt_retry_")) {
				const attempt = (controlledAttempts.get(id) ?? 0) + 1;
				controlledAttempts.set(id, attempt);
				if (id.startsWith("batt_retry_") && attempt === 1)
					return { status: 503, kind: "error" };
				await new Promise<void>((resolve) => controlledMedia.set(id, resolve));
				controlledMedia.delete(id);
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: decode(SHOT_WIDE_B64),
				};
			}
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
	clearSent: () => {},
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

const Thread: FC<{
	messages: TeamBridgeMessage[];
	width?: number;
	density?: "regular" | "compact";
}> = ({ messages, width = 760, density }) => (
	<div
		style={{ width, maxWidth: "100%" }}
		className="flex min-w-0 flex-col bg-surface text-ink"
	>
		<TeamBridgeMessageList
			messages={messages}
			labelFor={(sender) => sender.display_label}
			tenantId="tnt_story"
			accountId="acct_story_reader"
			density={density}
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

/** The attachments lane's reproduction in the conversation thread, synthetic
 * bytes: a legacy body that inlined the image as text, `[image ...; jpeg ...;
 * sha256 ...] data:image/jpeg;base64,<~600 KB>`. It must read as a bounded,
 * inert receipt, never megabytes of base64 and never an image. */
export const BubbleLegacyInlineDataReceipt: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: `${"[image 1/1: photo.jpg; jpeg 1600x1200; 452118 bytes; sha256 3f1c9a0e5b7d2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a0c2e4b6d8f0a]"} data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ${"Qk+/x9Zp".repeat(75000)}AB==`,
				}),
			]}
		/>
	),
};

/** PR #1554 review round 1 (R1-1 / Q1): data URIs in Markdown code. A short one
 * in a fence or an inline code span is ordinary code, never a receipt, and the
 * prose after the fence stays prose. A large one in a fence becomes ONE receipt
 * for the whole block, so neither neighbour is left inside a broken fence.
 * Synthetic bytes. */
export const BubbleDataUriInCode: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					id: "bmsg_code_small",
					body: 'Strip the `data:image/jpeg;base64,` prefix before decoding. Example:\n\n```html\n<img src="data:image/png;base64,iVBORw0KGgo=">\n```\n\nThe line after the fence is prose.',
				}),
				message({
					id: "bmsg_code_large",
					seq: 2,
					body: `Fenced big:\n\n\`\`\`\ndata:image/png;base64,${"Qk+/x9Zp".repeat(2500)}\n\`\`\`\n\nThe line after the fence.`,
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

/** Inline-image refresh (SPEC §3.1): three images put the first across both
 * rows and stack the other two. */
export const BubbleThreeImages: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Three angles:",
					attachments: [
						descriptor("batt_tall", 120, 180),
						descriptor("batt_wide", 240, 150),
						descriptor("batt_green", 200, 140),
					],
				}),
			]}
		/>
	),
};

/** Six images: a 2×2 grid whose fourth tile says `+2`; the lightbox still
 * walks all six. */
export const BubbleSixImages: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "The whole set:",
					attachments: [
						descriptor("batt_wide", 240, 150),
						descriptor("batt_tall", 120, 180),
						descriptor("batt_green", 200, 140),
						descriptor("batt_red", 160, 160),
						descriptor("batt_fifth", 200, 140),
						descriptor("batt_sixth", 240, 150),
					],
				}),
			]}
		/>
	),
};

/** An extreme ratio (4.5:1) letterboxes on `media-surface` rather than
 * cropping the panorama to a strip. */
export const BubblePanorama: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Panorama:",
					attachments: [descriptor("batt_pano", 450, 100)],
				}),
			]}
		/>
	),
};

/** Non-image descriptors and S3b files: borderless chips, never "N bytes". */
export const BubbleFileChips: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Notes and the log:",
					attachments: [descriptor("batt_wide", 240, 150)],
					files: [
						{
							id: "bfile_notes",
							class: "pdf",
							size: 2_400_000,
							display_name: "Quarterly board summary.pdf",
							state: "bound",
						},
						{
							id: "bfile_log",
							class: "text",
							size: 18_200,
							display_name: "run-2026-11-03.log",
							state: "expired",
						},
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
					/* The byte route needs the captured account; without it every
					   tile drew "Image unavailable" (QA round 1, Q2). */
					accountId="acct_story_reader"
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
		tile.focus();
		await userEvent.keyboard("{Enter}");
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
		// Count actual enabled controls, then walk more than a complete lap
		// in both directions. QA records the real order from rendered focus.
		const controls = dialog.querySelectorAll(
			'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
		);
		for (const shift of [false, true]) {
			for (let press = 0; press <= controls.length; press += 1) {
				await userEvent.tab({ shift });
				await expect(dialog.contains(document.activeElement)).toBe(true);
			}
		}
		await userEvent.keyboard("{ArrowLeft}");
		await at("Image 4 of 4");
		await userEvent.keyboard("{ArrowRight}");
		await at("Image 1 of 4");
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(tile).toHaveFocus());
		await userEvent.keyboard(" ");
		const reopened = await screen.findByRole("dialog");
		await userEvent.click(
			within(reopened).getByRole("button", { name: "Close image" }),
		);
		await waitFor(() => expect(tile).toHaveFocus());
	},
};

/** Fixture controls release synthetic bytes, never production auth or transport.
 * A fresh story mount resets only its own synthetic request counters. */
const ControlledMember: FC<{ retry?: boolean; compact?: boolean }> = ({
	retry = false,
	compact = false,
}) => {
	const id = retry
		? "batt_retry_explicit"
		: compact
			? "batt_control_compact"
			: "batt_control_single";
	useLayoutEffect(() => {
		controlledAttempts.delete(id);
		return () => {
			controlledMedia.get(id)?.();
			controlledMedia.delete(id);
			controlledAttempts.delete(id);
		};
	}, [id]);
	return (
		<div className="space-y-3">
			<button
				type="button"
				className="min-h-6 rounded border border-control px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
				onClick={() => controlledMedia.get(id)?.()}
			>
				Release synthetic preview bytes
			</button>
			<Thread
				width={compact ? 272 : 760}
				density={compact ? "compact" : "regular"}
				messages={[
					message({
						id: `message_${id}`,
						body: retry
							? "503 first; use Try again, then release bytes."
							: "Pending until released; compare ready and settled geometry.",
						attachments: [descriptor(id, 240, 150)],
					}),
					message({
						id: `after_${id}`,
						seq: 2,
						body: "This following message must not move.",
					}),
				]}
			/>
			<button type="button">After attachment flow</button>
		</div>
	);
};
export const PendingToReady: StoryObj = { render: () => <ControlledMember /> };
export const PendingToReadyCompact: StoryObj = {
	render: () => <ControlledMember compact />,
};
export const TransientExplicitRetry: StoryObj = {
	render: () => <ControlledMember retry />,
};
export const MemberTerminalRefusals: StoryObj<typeof Thread> = {
	render: () => (
		<Thread
			messages={[
				message({
					body: "Terminal responses are not retry actions.",
					attachments: [401, 403, 404].map((status) =>
						descriptor(`batt_refused_${status}`, 240, 150),
					),
				}),
			]}
		/>
	),
};
export const LightMemberPreview: StoryObj<typeof Thread> = {
	args: { ...{ theme: "localOperatorLight" }, messages: [fourImages] },
	render: (args) => <Thread {...args} />,
};
export const DarkMemberPreview: StoryObj<typeof Thread> = {
	args: { ...{ theme: "localOperatorDark" }, messages: [fourImages] },
	render: (args) => <Thread {...args} />,
};
