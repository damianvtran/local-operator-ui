import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect, useRef, useState } from "react";
import {
	ownerAuditConversationSchema,
	ownerAuditMessageSchema,
} from "../../../../../shared/team-bridge-owner-audit-contract";
import {
	SHOT_GREEN_B64,
	SHOT_WIDE_B64,
} from "../team-bridge-attachments.fixtures";
import { OwnerAuditPanelView } from "../team-bridge-owner-audit";

/** Real owner-audit panel and byte/save consumers, SYNTHETIC preload boundary.
 * No hub authority, native dialog or real filesystem operation is claimed. The
 * production native save API returns only saved/cancelled, never paths/bytes. */
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
		body: "Opaque file: native main-owned Save As only.",
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
}: { mode?: Mode; narrow?: boolean; metadataOnly?: boolean }) {
	const [owner, setOwner] = useState(OWNER);
	const ownerRef = useRef(owner);
	ownerRef.current = owner;
	const releaseImage = useRef<(() => void) | null>(null);
	const releaseSave = useRef<(() => void) | null>(null);
	const cancelNextSave = useRef(false);
	const holdSave = useRef(false);
	const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useLayoutEffect(() => {
		const previous = window.api;
		let attempts = 0;
		// A scoped mock, installed before passive resource effects. Renderer code
		// still builds the production captured-account tuple and closed audit op.
		window.api = {
			...previous,
			desktop: {
				...previous?.desktop,
				media: async (request) => {
					if (
						request.op !== "team_bridge.owner_audit.attachment" ||
						request.tenantId !== TENANT ||
						request.conversationId !== conversation.id ||
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
				ownerAuditAttachmentSave: async (request) => {
					if (mode === "refused")
						return { status: 403, kind: "error", detail: "Synthetic refusal" };
					if (
						request.expectedAccountId !== ownerRef.current ||
						request.tenantId !== TENANT
					)
						return { status: 409, kind: "error", detail: "Synthetic refusal" };
					if (holdSave.current)
						await new Promise<void>((resolve) => {
							releaseSave.current = resolve;
						});
					if (request.expectedAccountId !== ownerRef.current)
						return { status: 409, kind: "error", detail: "Synthetic refusal" };
					const cancelled = cancelNextSave.current;
					cancelNextSave.current = false;
					return {
						status: 200,
						kind: "json",
						body: { saved: !cancelled, cancelled },
					};
				},
			},
		} as typeof window.api;
		return () => {
			releaseImage.current?.();
			releaseImage.current = null;
			releaseSave.current?.();
			releaseSave.current = null;
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
					onClick={() => {
						cancelNextSave.current = true;
					}}
				>
					Cancel next synthetic save
				</button>
				<button
					type="button"
					onClick={() => {
						holdSave.current = true;
					}}
				>
					Hold synthetic save
				</button>
				<button
					type="button"
					onClick={() => {
						holdSave.current = false;
						releaseSave.current?.();
					}}
				>
					Release synthetic save
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
					messages={metadataOnly ? messages.slice(2) : messages.slice(0, 2)}
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
	args: { mode: "ready", narrow: false, metadataOnly: false },
} satisfies Meta<typeof AuditResourceFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PreviewAndOpaqueSave: Story = {};
export const PendingToReady: Story = { args: { mode: "pending" } };
export const ExplicitRetry: Story = { args: { mode: "transient" } };
export const TerminalRefusal: Story = { args: { mode: "refused" } };
export const Narrow: Story = { args: { narrow: true } };
export const Light: Story = {
	args: { ...{ theme: "localOperatorLight" }, mode: "ready" },
};
export const Dark: Story = {
	args: { ...{ theme: "localOperatorDark" }, mode: "ready" },
};

export const NonfetchableMetadata: Story = { args: { metadataOnly: true } };
