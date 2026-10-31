/**
 * The agent profile picture, in every state the surfaces and the editor show.
 *
 * WHAT IS REAL AND WHAT IS MOCKED. These stories render the shipped components -
 * `AgentMark`, `AgentAvatarEditLink`, `AgentAvatarField`, `AgentAvatarCropper`,
 * `ChatSessionAvatar` - and mock only the two things a story cannot have: the
 * backend's picture bytes (the preload media relay answers `agent.avatar` with a
 * synthetic PNG, no user data) and the agent records themselves. The picture's
 * record is seeded straight into the query key the seam reads, which is the same
 * path a real agents read fills, so what is exercised is the seam and the
 * rendering rather than a fixture-shaped prop.
 *
 * THE PENCIL'S HOVER IS THE RIG'S JOB. A story cannot hold a pointer over an
 * element, so `EditLinkOwned` shows the link at rest and the captured frames in
 * the PR hover it; `EditLinkUnowned` is the same picture with no link at all,
 * which is the state that must never grow a pencil.
 */

import {
	agentAvatarsQueryKey,
	useAgentAvatarMap,
} from "@shared/agent-avatar/agent-avatar";
import { AgentAvatarEditLink } from "@shared/agent-avatar/agent-avatar-edit-link";
import { AgentMark } from "@shared/agent-avatar/agent-mark";
import type { AgentAvatarMeta } from "@shared/api/local-operator/types";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { queryClient } from "@shared/api/query-client";
import { TooltipProvider } from "@shared/components/ui";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useMemo, useState } from "react";
import {
	ChatSessionAvatar,
	ChatSessionAvatarEdit,
} from "../../chat/components/chat-session-avatar";
import { AgentAvatarCropper } from "./agent-avatar-cropper";
import { AgentAvatarField } from "./agent-avatar-field";
import { AgentsSidebarItem } from "./agents-sidebar";

/* ------------------------------------------------------------------ *
 * THE SYNTHETIC PICTURE
 * ------------------------------------------------------------------ */

/**
 * A 512x512 gradient with a disc in it, encoded once as a PNG.
 *
 * Drawn rather than shipped as a base64 blob so the story carries no binary
 * asset and the image is obviously synthetic in the frames.
 */
const syntheticPng = (): Uint8Array => {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const context = canvas.getContext("2d");
	if (context) {
		const gradient = context.createLinearGradient(0, 0, 512, 512);
		gradient.addColorStop(0, "#3b82f6");
		gradient.addColorStop(1, "#8b5cf6");
		context.fillStyle = gradient;
		context.fillRect(0, 0, 512, 512);
		context.fillStyle = "#e5e7eb";
		context.beginPath();
		context.arc(256, 220, 110, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.arc(256, 470, 170, Math.PI, 0);
		context.fill();
	}
	const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
	return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const PNG = syntheticPng();
const SHA = "a".repeat(64);

/** The one media stub these stories need: the bytes behind an agent's picture. */
const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string }) =>
			request.op === "agent.avatar"
				? { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};
installMedia();

/** Seed the agents' picture records the way a real agents read would. */
const useSeedPictures = (ids: readonly string[]) => {
	useEffect(() => {
		const map: Record<string, AgentAvatarMeta> = {};
		for (const id of ids)
			map[id] = {
				sha256: SHA,
				mime: "image/png",
				bytes: PNG.byteLength,
				updated_at: "2026-10-30T00:00:00.000Z",
			};
		queryClient.setQueryData(agentAvatarsQueryKey, map);
	}, [ids]);
	// Read the map so the story repaints when the query is filled.
	useAgentAvatarMap();
};

const agent = (
	id: string,
	name: string,
	description: string,
): AgentDetails => ({
	id,
	name,
	description,
	created_date: "2026-10-30T00:00:00.000Z",
	version: "1",
	security_prompt: "",
	hosting: "openrouter",
	model: "openai/gpt-4o-mini",
});

const CODER = agent(
	"agent-coder",
	"coder",
	"Implements one bounded slice and reports what changed.",
);
const REVIEWER = agent(
	"agent-reviewer",
	"reviewer",
	"Reviews every pull request before it merges.",
);
const MANAGER = agent(
	"agent-manager",
	"manager",
	"Coordinates the team and keeps the record current.",
);
const LONG_NAME = agent(
	"agent-long",
	"research-and-reconciliation-analyst",
	"Reads the whole corpus before answering one question about it.",
);

const noop = () => {};

const ROWS = [CODER.id, MANAGER.id, LONG_NAME.id] as const;

/* ------------------------------------------------------------------ *
 * THE ROSTER ROWS
 * ------------------------------------------------------------------ */

const Rows: FC<{
	rows: ReadonlyArray<{ record: AgentDetails; selected: boolean }>;
	pictured: readonly string[];
}> = ({ rows, pictured }) => {
	useSeedPictures(pictured);
	return (
		<TooltipProvider>
			<div className="w-80 bg-surface p-2">
				<ul className="flex flex-col gap-1">
					{rows.map(({ record, selected }) => (
						<AgentsSidebarItem
							key={record.id}
							agent={record}
							isSelected={selected}
							onSelectAgent={noop}
							onChatWithAgent={noop}
							onExportAgent={noop}
							onAgentDeleted={noop}
							onUploadAgentToHub={noop}
						/>
					))}
				</ul>
			</div>
		</TooltipProvider>
	);
};

const meta: Meta<typeof Rows> = {
	title: "Features/Agents/Agent avatar",
	component: Rows,
};
export default meta;

type Story = StoryObj<typeof Rows>;

/** Every row state the picture meets, side by side at the same row height. */
export const RosterStates: Story = {
	render: () => (
		<Rows
			pictured={ROWS}
			rows={[
				{ record: CODER, selected: false },
				/* No picture: the row must be exactly the row it was before. */
				{ record: REVIEWER, selected: false },
				{ record: MANAGER, selected: true },
				{ record: LONG_NAME, selected: false },
			]}
		/>
	),
};

/** The same roster with no pictures at all - the pre-feature baseline. */
export const RosterNoPictures: Story = {
	render: () => (
		<Rows
			pictured={[]}
			rows={[
				{ record: CODER, selected: false },
				{ record: REVIEWER, selected: true },
			]}
		/>
	),
};

/* ------------------------------------------------------------------ *
 * THE EDITOR
 * ------------------------------------------------------------------ */

const pictureSource = (): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("the synthetic picture failed"));
		image.src = URL.createObjectURL(
			new Blob([PNG as BlobPart], { type: "image/png" }),
		);
	});

/** The cropper needs a decoded source; a story decodes its own picture. */
const usePictureSource = () => {
	const [source, setSource] = useState<HTMLImageElement | null>(null);
	useEffect(() => {
		let live = true;
		void pictureSource().then((image) => {
			if (live) setSource(image);
		});
		return () => {
			live = false;
		};
	}, []);
	return source;
};

const Cropper: FC<{ zoom?: number }> = ({ zoom = 1 }) => {
	const source = usePictureSource();
	if (!source) return <p className="text-ink-dim text-meta">Decoding…</p>;
	return (
		<div className="w-[46rem] bg-surface p-6">
			<AgentAvatarCropper
				source={source}
				initialZoom={zoom}
				onSave={noop}
				onCancel={noop}
			/>
		</div>
	);
};

/** The crop step as it opens: 1x, centred, previews at the real sizes. */
export const EditorCropFresh: Story = {
	render: () => <Cropper />,
};

/** The same crop panned and zoomed - what the saved square will keep. */
export const EditorCropZoomed: Story = {
	render: () => <Cropper zoom={2.5} />,
};

/** The crop step mid-upload: Save is busy and locked for the whole request. */
export const EditorCropSaving: Story = {
	render: () => {
		const source = usePictureSource();
		if (!source) return <p className="text-ink-dim text-meta">Decoding…</p>;
		return (
			<div className="w-[46rem] bg-surface p-6">
				<AgentAvatarCropper
					source={source}
					saving={true}
					onSave={noop}
					onCancel={noop}
				/>
			</div>
		);
	},
};

/** The crop step after a refused upload: the framing is kept, the reason shown. */
export const EditorCropSaveFailed: Story = {
	render: () => {
		const source = usePictureSource();
		if (!source) return <p className="text-ink-dim text-meta">Decoding…</p>;
		return (
			<div className="w-[46rem] bg-surface p-6">
				<AgentAvatarCropper
					source={source}
					error="The picture could not be saved. Try again."
					onSave={noop}
					onCancel={noop}
				/>
			</div>
		);
	},
};

/**
 * The field with a picture: the picture itself, Replace and Remove beside it.
 *
 * THE STORY WAS THE BROKEN PART, NOT THE FIELD (design review round 1, D2). It
 * mounted `AgentAvatarField` for an agent that HAS a picture but never called
 * `useSeedPictures`, so `useAgentAvatar` - which reads the agents map - answered
 * `null` and the field drew its EMPTY arm: the frame was pixel-identical to
 * `EditorEmpty`, and the "uploaded" state the brief asks for had no evidence at
 * all. The component was right; opening this agent in the app renders the
 * picture, because the map carries its digest and the media stub below answers
 * the bytes. Seeding the map is therefore what makes the state real - and this
 * story now exercises the shipped fetch rather than the `pictureSrc` story seam.
 */
const FieldWithPicture: FC = () => {
	useSeedPictures([CODER.id]);
	return (
		<div className="w-96 bg-surface p-6">
			<AgentAvatarField agentId={CODER.id} />
		</div>
	);
};

export const EditorWithPicture: Story = {
	render: () => <FieldWithPicture />,
};

/** The field before anything is picked - the state a new agent is in. */
export const EditorEmpty: Story = {
	render: () => (
		<div className="w-96 bg-surface p-6">
			<AgentAvatarField agentId="agent-no-picture" />
		</div>
	),
};

/* ------------------------------------------------------------------ *
 * THE PENCIL
 * ------------------------------------------------------------------ */

const Pencil: FC<{ owned: boolean }> = ({ owned }) => {
	useSeedPictures([CODER.id]);
	return (
		<div className="flex items-center gap-4 bg-surface p-6">
			<AgentAvatarEditLink
				agentName={CODER.name}
				agentId={CODER.id}
				owned={owned}
				className="size-10"
				pencilClassName="size-4"
			>
				{/*
				 * `AgentMark` is unseeded here on purpose: the story needs the picture
				 * WITHOUT the seam's async fetch, so a fixed URL is passed.
				 */}
				<AgentMark
					agentId={CODER.id}
					src={URL.createObjectURL(
						new Blob([PNG as BlobPart], { type: "image/png" }),
					)}
					className="size-10"
					fallback={null}
				/>
			</AgentAvatarEditLink>
			<span className="text-body text-ink-dim">
				{owned ? "Owned: the picture is a link" : "Not owned: no link"}
			</span>
		</div>
	);
};

/** An agent the viewer owns: hovering or focusing the picture reveals the pencil. */
export const EditLinkOwned: Story = {
	render: () => <Pencil owned={true} />,
};

/** Someone else's agent: no link, no pencil, no tab stop. */
export const EditLinkUnowned: Story = {
	render: () => <Pencil owned={false} />,
};

/* ------------------------------------------------------------------ *
 * THE CHAT ROWS
 * ------------------------------------------------------------------ */

const row = (
	id: string,
	statusCode: string,
	label: string,
	pictured: boolean,
): CanonicalSessionRow =>
	({
		session_id: id,
		title: `${label} conversation`,
		updated_at: 0,
		agent_id: pictured ? CODER.id : null,
		avatar_sha256: pictured ? SHA : null,
		binding: { agent: CODER.name, team: null },
		status: { code: statusCode, label },
	}) as CanonicalSessionRow;

const ChatRows: FC = () => {
	useSeedPictures([CODER.id]);
	const rows = useMemo(
		() => [
			row("s-busy-a", "busy", "Running", true),
			row("s-waiting-a", "waiting", "Waiting for you", true),
			row("s-done-a", "complete", "Done", true),
			row("s-error-a", "error", "Failed", true),
			row("s-busy-b", "busy", "Running", false),
			row("s-waiting-b", "waiting", "Waiting for you", false),
			row("s-done-b", "complete", "Done", false),
			row("s-error-b", "error", "Failed", false),
		],
		[],
	);
	return (
		<div className="w-72 bg-surface p-2">
			<div className="flex flex-col gap-1">
				{rows.map((entry) => (
					<div
						key={entry.session_id}
						className="flex h-8 items-center gap-1 rounded-md px-1 text-body-sm"
					>
						<ChatSessionAvatar row={entry} nowSeconds={0} />
						<span className="min-w-0 truncate text-ink">
							{entry.binding?.agent ?? "agent"} · {entry.status?.label ?? ""}
						</span>
					</div>
				))}
			</div>
		</div>
	);
};

/**
 * The four states the row must keep legible, with a picture and without: the
 * picture beside the untouched status cell (see `AVATAR_STATUS_VARIANT`).
 */
export const ChatRowStatuses: Story = {
	render: () => <ChatRows />,
};

/**
 * THE ROW AND ITS PENCIL, in the real wrapper the sidebar uses.
 *
 * WHY THIS EXISTS (design review round 1, D3). `ChatRowStatuses` builds a
 * stand-in row from the marks alone and mounts no `ChatSessionAvatarEdit`, so
 * nothing on this branch framed the editor's door at hover or at keyboard focus -
 * the state the whole feature adds, unphotographed. This mounts the shipped
 * components inside the sidebar's own wrapper class string (`group/row relative`,
 * which is what the overlay's hover reveal keys off), and the capture plans for
 * it take the resting, hover and focus frames.
 */
const RowPencil: FC = () => {
	useSeedPictures([CODER.id]);
	const entry = useMemo(() => row("s-pencil", "complete", "Done", true), []);
	return (
		<div className="w-72 bg-surface p-2">
			<div
				data-avatar-row-pencil=""
				className="group/row relative flex h-8 items-center gap-1 rounded-md px-1 text-body-sm"
			>
				<ChatSessionAvatar row={entry} nowSeconds={0} />
				<span className="min-w-0 truncate text-ink">{CODER.name} · Done</span>
				<ChatSessionAvatarEdit row={entry} />
			</div>
		</div>
	);
};

export const ChatRowPencil: Story = {
	render: () => <RowPencil />,
};
