import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect, useRef, useState } from "react";
import {
	ownerAuditConversationSchema,
	ownerAuditMessageSchema,
} from "../../../../../shared/team-bridge-owner-audit-contract";
import {
	FILE_SAVE_FILES,
	SHOT_GREEN_B64,
	SHOT_WIDE_B64,
	fileSaveAnswer,
	pressFileSaves,
} from "../team-bridge-attachments.fixtures";
import { OwnerAuditPanelView } from "../team-bridge-owner-audit";

/** Real owner-audit panel and image consumers, SYNTHETIC preload boundary.
 * No hub authority or rendered approval is claimed. A generic file offers one
 * action, Save (decision a-fdf0), answered here by the synthetic file lane
 * only for this panel's own owner receipt; no native save API is registered
 * or advertised, and nothing is previewed. */
const OWNER = "acct_synthetic_owner";
const OTHER = "acct_synthetic_other";
const TENANT = "org_synthetic_audit";
const conversation = ownerAuditConversationSchema.parse({
	id: "bcv_synthetic_audit",
	tenant_id: TENANT,
	kind: "group",
	name: "Synthetic owner-audit attachments",
	visibility: "private",
	status: "active",
	latest_seq: 4,
	members: [],
	member_count: 2,
	agent: {
		account_id: "acct_synthetic_agent",
		display_label: "Synthetic agent",
		state: "active",
		joined_seq: 0,
	},
	viewers: [],
});
const image = {
	id: "batt_synthetic_image",
	mime: "image/png",
	size: 2048,
	width: 640,
	height: 480,
	state: "bound",
};
const messages = [
	{
		id: "bmsg_synthetic_image",
		seq: 1,
		body: "Owner-scoped image preview; no member fallback.",
		attachments: [image],
	},
	{
		id: "bmsg_synthetic_file",
		seq: 2,
		body: "Generic file: metadata only, no preview or download.",
		attachments: [
			{
				...image,
				id: "batt_synthetic_file",
				mime: "application/octet-stream",
				width: null,
				height: null,
			},
		],
	},
	{
		id: "bmsg_synthetic_revoked",
		seq: 3,
		body: "Revoked and unknown metadata must not fetch.",
		attachments: ["revoked", "unknown"].map((state) => ({
			...image,
			id: `batt_${state}`,
			state,
		})),
	},
	{
		id: "bmsg_synthetic_count",
		seq: 4,
		body: "",
		attachments: [],
		attachment_count: 3,
	},
	{
		id: "bmsg_synthetic_files",
		seq: 5,
		body: "Generic files: Save through the owner-audit relay, never a preview.",
		attachments: [],
		files: FILE_SAVE_FILES,
	},
].map((item) =>
	ownerAuditMessageSchema.parse({
		conversation_id: conversation.id,
		sender: {
			account_id: OWNER,
			kind: "human",
			display_label: "Synthetic owner",
		},
		origin: "human",
		created_at: "2026-11-03T12:00:00Z",
		agent_delivery_status: "admitted",
		...item,
	}),
);
const decode = (value: string) =>
	Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
type Mode = "ready" | "pending" | "transient" | "refused";

function AuditResourceFixture({
	mode = "ready",
	narrow = false,
	metadataOnly = false,
	files = false,
}: {
	mode?: Mode;
	narrow?: boolean;
	metadataOnly?: boolean;
	/** Show only the generic-file message, for the Save states. */
	files?: boolean;
}) {
	const [owner, setOwner] = useState(OWNER);
	const releaseImage = useRef<(() => void) | null>(null);
	const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useLayoutEffect(() => {
		const previous = window.api;
		let attempts = 0;
		// Deliberately omit the removed legacy save method even if another fixture
		// left it behind. This boundary provides image bytes only, never file export.
		const desktop = { ...previous?.desktop };
		Reflect.deleteProperty(desktop, "ownerAuditAttachmentSave");
		window.api = {
			...previous,
			desktop: {
				...desktop,
				media: async (request) => {
					/* A file's Save answers only this panel's own receipt and row. */
					if (
						request.op === "team_bridge.owner_audit.attachment" &&
						request.mode === "file"
					)
						return request.tenantId === TENANT &&
							request.conversationId === conversation.id &&
							request.messageId === "bmsg_synthetic_files" &&
							request.expectedAccountId === owner
							? fileSaveAnswer(request.attachmentId)
							: { status: 403, kind: "error", detail: "Synthetic refusal" };
					if (
						request.op !== "team_bridge.owner_audit.attachment" ||
						request.tenantId !== TENANT ||
						request.conversationId !== conversation.id ||
						request.messageId !== "bmsg_synthetic_image" ||
						request.attachmentId !== image.id ||
						request.expectedAccountId !== owner
					)
						return { status: 403, kind: "error", detail: "Synthetic refusal" };
					if (mode === "refused")
						return { status: 403, kind: "error", detail: "Synthetic refusal" };
					attempts += 1;
					if (mode === "transient" && attempts === 1)
						return {
							status: 503,
							kind: "error",
							detail: "Synthetic transient",
						};
					if (mode === "pending" || mode === "transient")
						await new Promise<void>((resolve) => {
							releaseImage.current = resolve;
						});
					return {
						status: 200,
						kind: "bytes",
						mimeType: "image/png",
						data: decode(owner === OWNER ? SHOT_WIDE_B64 : SHOT_GREEN_B64),
					};
				},
			},
		} as typeof window.api;
		return () => {
			releaseImage.current?.();
			releaseImage.current = null;
			if (switchTimer.current) clearTimeout(switchTimer.current);
			window.api = previous;
		};
	}, [mode, owner]);
	return (
		<div className="space-y-2 bg-canvas p-3 text-ink">
			<div className="flex flex-wrap gap-2">
				<button type="button" onClick={() => releaseImage.current?.()}>
					Release synthetic image
				</button>
				<button
					type="button"
					onClick={() =>
						setOwner((current) => (current === OWNER ? OTHER : OWNER))
					}
				>
					Switch synthetic account
				</button>
				<button
					type="button"
					onClick={() => {
						switchTimer.current = setTimeout(() => setOwner(OTHER), 1000);
					}}
				>
					Switch account after one second
				</button>
			</div>
			<div
				style={{ width: narrow ? 360 : 760, maxWidth: "100%", height: 800 }}
				className="flex min-w-0 flex-col bg-surface"
			>
				<OwnerAuditPanelView
					conversation={conversation}
					messages={
						files
							? messages.slice(4)
							: metadataOnly
								? messages.slice(2, 4)
								: messages.slice(0, 2)
					}
					state="ready"
					retry={() => {}}
					readerAccountId={owner}
					attachmentScope={{ accountId: owner, tenantId: TENANT }}
					people={[]}
				/>
			</div>
		</div>
	);
}
const meta = {
	title: "Team Bridge/Owner audit attachment access",
	component: AuditResourceFixture,
	parameters: { layout: "fullscreen" },
	args: { mode: "ready", narrow: false, metadataOnly: false, files: false },
} satisfies Meta<typeof AuditResourceFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PreviewAndFileMetadata: Story = {};
export const PendingToReady: Story = { args: { mode: "pending" } };
export const ExplicitRetry: Story = { args: { mode: "transient" } };
export const TerminalRefusal: Story = { args: { mode: "refused" } };
export const AccountSwitch: Story = { args: { mode: "pending" } };
export const Narrow: Story = { args: { narrow: true } };
export const Light: Story = {
	args: { ...{ theme: "localOperatorLight" }, mode: "ready" },
};
export const Dark: Story = {
	args: { ...{ theme: "localOperatorDark" }, mode: "ready" },
};
export const NonfetchableMetadata: Story = { args: { metadataOnly: true } };

/*
 * Generic-file Save in the audit panel (decision a-fdf0): the owner-audit relay
 * in file mode, one card per state. `FileSaveAvailable` is the untouched card
 * set; `FileSaveStates` presses Save on the saving, refused, too-large and
 * failed cards, scoped to the files message.
 */
export const FileSaveAvailable: Story = { args: { files: true } };
export const FileSaveStates: Story = {
	args: { files: true },
	play: async ({ canvasElement }) => pressFileSaves(canvasElement),
};
export const FileSaveStatesNarrow: Story = {
	args: { files: true, narrow: true },
	play: async ({ canvasElement }) => pressFileSaves(canvasElement),
};
