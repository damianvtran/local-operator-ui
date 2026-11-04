/**
 * Agent picture presence: the state matrix the presence decision draws, on every
 * surface that draws it.
 *
 * ROWS are the four states an agent's picture slot can be in - no picture, a
 * picture, a picture being uploaded, and a picture whose bytes are unreadable (the
 * row claims a digest and the relay answers 404; NOT a refused upload) - and
 * COLUMNS are the surfaces: the chat turn head, the chat header, the session row
 * and the agents rail's row. The turn head and the header follow the reader's
 * size setting (`size` arg); the session row and the rail stay at 16px by design.
 *
 * REAL SEAMS, NOT HAND-FED URLS. The mark is the production `useAgentSlotMark`:
 * the media stub below answers `agent.avatar` per agent id (bytes for the
 * pictured agent, a 404 for the failed one), the `uploading` row issues a real
 * `setAgentAvatar` whose `put` never settles (so `useAgentAvatarWriting` is true
 * for exactly as long as the frame is held), and ownership comes from the same
 * `sessionPictureEditable` the app uses. `MatrixNotOwned` is the remote column
 * the table must keep empty.
 *
 * `capturePending` is held until the failed row has settled, because its claim
 * ("bytes did not resolve") arrives after paint and an early frame would show the
 * calm plate instead (AGENTS.md, *What a capture may claim*).
 */

import {
	agentAvatarsQueryKey,
	setAgentAvatar,
} from "@shared/agent-avatar/agent-avatar";
import { sessionAgentTarget } from "@shared/agent-avatar/agent-avatar-meta";
import { useAgentSlotMark } from "@shared/agent-avatar/agent-avatar-slot";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { type FC, useEffect, useLayoutEffect } from "react";
import { type AgentAvatarSize, HEADER_AVATAR_BOX } from "../agent-avatar-size";
import { ChatHeaderAvatar } from "./chat-header";
import { ChatSessionAvatar } from "./chat-session-avatar";
import { EntityMark } from "./chat-sidebar";
import { MessageAvatar } from "./message-item/message-avatar";

const SHA = "c".repeat(64);

type State = "none" | "picture" | "uploading" | "failed";

const STATES: readonly State[] = ["none", "picture", "uploading", "failed"];

const AGENTS: Record<State, { id: string; name: string; label: string }> = {
	none: { id: "agent-none", name: "scout", label: "No picture" },
	picture: { id: "agent-picture", name: "coder", label: "Picture set" },
	uploading: { id: "agent-up", name: "reviewer", label: "Uploading" },
	failed: { id: "agent-fail", name: "manager", label: "Picture unreadable" },
};

/** A flat two-tone figure: synthetic, so no frame is a claim about a palette. */
const syntheticPng = (): Uint8Array => {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = "#6b7280";
		context.fillRect(0, 0, 128, 128);
		context.fillStyle = "#e5e7eb";
		context.beginPath();
		context.arc(64, 52, 26, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.arc(64, 124, 44, Math.PI, 0);
		context.fill();
	}
	const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};
const PNG = syntheticPng();

const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: (request: { op?: string; agentId?: string }) => {
			if (request.op === "agent.avatar.put") return new Promise(() => {});
			if (
				request.op === "agent.avatar" &&
				request.agentId === AGENTS.picture.id
			)
				return Promise.resolve({
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: PNG,
				});
			return Promise.resolve({
				status: 404,
				kind: "error",
				detail: "Not in this story.",
			});
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};
installMedia();

/** The session row for a state; `pictured` rows claim a digest, the failed one too. */
const rowOf = (state: State, locality?: "remote"): CanonicalSessionRow =>
	({
		session_id: `s-${state}`,
		title: `${AGENTS[state].label} conversation`,
		updated_at: 0,
		agent_id: AGENTS[state].id,
		avatar_sha256: state === "none" ? null : SHA,
		binding: { agent: AGENTS[state].name, team: null },
		status: { code: "complete", label: "Done" },
		...(locality ? { locality } : {}),
	}) as CanonicalSessionRow;

const TurnHead: FC<{ state: State; owned: boolean }> = ({ state, owned }) => {
	const agent = AGENTS[state];
	const mark = useAgentSlotMark({
		agentId: agent.id,
		agentName: agent.name,
		sha256Hint: state === "none" ? null : SHA,
		owned,
		pictureDoor: false,
	});
	return (
		<div className="w-56">
			{mark ? <MessageAvatar mark={mark} name={agent.name} /> : null}
			<p className="text-ink">First line of the turn.</p>
		</div>
	);
};

const Header: FC<{ state: State; owned: boolean }> = ({ state, owned }) => {
	const row = rowOf(state, owned ? undefined : "remote");
	const target = sessionAgentTarget(row);
	if (!target) return null;
	return (
		<div className="flex h-10 w-56 items-center">
			<ChatHeaderAvatar
				agent={{
					agentId: target.agentId,
					agentName: target.agentName,
					sha256: target.sha256,
					owned: target.owned,
				}}
			/>
			<span className="font-medium text-body text-ink">
				{AGENTS[state].label}
			</span>
		</div>
	);
};

const SessionRow: FC<{ state: State; owned: boolean }> = ({ state, owned }) => (
	<div className="flex h-8 w-56 items-center gap-1 rounded-md px-1 text-body-sm">
		<ChatSessionAvatar
			row={rowOf(state, owned ? undefined : "remote")}
			nowSeconds={0}
		/>
		<span className="min-w-0 truncate text-ink">{AGENTS[state].label}</span>
	</div>
);

const RailRow: FC<{ state: State }> = ({ state }) => (
	<div className="flex h-8 w-40 items-center gap-2 px-1 text-body-sm text-ink">
		<EntityMark agentId={AGENTS[state].id} glyph={Bot} />
		<span>{AGENTS[state].name}</span>
	</div>
);

const Matrix: FC<{ size: AgentAvatarSize; owned: boolean }> = ({
	size,
	owned,
}) => {
	const client = useQueryClient();
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ agentAvatarSize: size });
	}, [size]);
	useEffect(() => {
		client.setQueryData(agentAvatarsQueryKey, {
			[AGENTS.picture.id]: {
				sha256: SHA,
				mime: "image/png",
				bytes: PNG.byteLength,
				updated_at: "2026-11-03T00:00:00.000Z",
			},
			[AGENTS.failed.id]: {
				sha256: SHA,
				mime: "image/png",
				bytes: 1,
				updated_at: "2026-11-03T00:00:00.000Z",
			},
		});
		void setAgentAvatar(AGENTS.uploading.id, new Blob([PNG as BlobPart]));
		/* Hold the shutter until the failed row's bytes have answered 404. */
		document.documentElement.dataset.capturePending = "true";
		const timer = window.setTimeout(() => {
			delete document.documentElement.dataset.capturePending;
		}, 800);
		return () => window.clearTimeout(timer);
	}, [client]);
	return (
		<>
			<div
				data-avatar-matrix={`${size}-${owned ? "owned" : "not-owned"}`}
				className="inline-block bg-canvas p-4 text-body-sm text-ink"
			>
				<div
					className="grid items-center gap-x-6 gap-y-3"
					style={{ gridTemplateColumns: "repeat(5, max-content)" }}
				>
					<span className="text-ink-muted">State</span>
					<span className="text-ink-muted">Turn head</span>
					<span className="text-ink-muted">Chat header</span>
					<span className="text-ink-muted">Session row</span>
					<span className="text-ink-muted">Agents rail row</span>
					{STATES.map((state) => (
						<MatrixRow key={state} state={state} owned={owned} />
					))}
				</div>
				<p className="mt-3 text-ink-muted">
					Header box {HEADER_AVATAR_BOX[size].px}px; session row and rail stay
					16px.
				</p>
				{/*
				 * WHAT THE LAST ROW IS. "Picture unreadable" is a digest the row claims
				 * whose bytes answer 404 - not an upload that failed (a refused upload
				 * leaves the previous picture or none, and is the editor's error line).
				 * It draws what NO picture draws on each surface, which is the contract:
				 * the turn head and the header draw the placeholder door; the session row
				 * and the rail draw the bare status or glyph, because those two surfaces
				 * never draw a placeholder. The Uploading row is the one place the door is
				 * closed on purpose (a plate and a spinner).
				 */}
				<p className="mt-1 max-w-xl text-ink-muted">
					Picture unreadable draws the same as No picture on every surface: the
					door on the turn head and header, the bare status on the session row,
					the glyph on the rail.
				</p>
			</div>
		</>
	);
};

const MatrixRow: FC<{ state: State; owned: boolean }> = ({ state, owned }) => (
	<>
		<span className="text-ink">{AGENTS[state].label}</span>
		<TurnHead state={state} owned={owned} />
		<Header state={state} owned={owned} />
		<SessionRow state={state} owned={owned} />
		<RailRow state={state} />
	</>
);

type Args = { size: AgentAvatarSize; owned: boolean };

const meta: Meta<Args> = {
	title: "Chat/Agent picture presence",
	parameters: { layout: "fullscreen" },
	args: { size: "small", owned: true },
	argTypes: {
		size: {
			control: { type: "select" },
			options: ["small", "medium", "large"],
		},
	},
	render: (args) => <Matrix size={args.size} owned={args.owned} />,
};
export default meta;

type Story = StoryObj<Args>;

/** Every state on every surface at today's sizes. */
export const MatrixSmall: Story = {};

export const MatrixMedium: Story = { args: { size: "medium" } };

export const MatrixLarge: Story = { args: { size: "large" } };

/** A remote conversation's agent: nothing owned, so no door and no placeholder. */
export const MatrixNotOwned: Story = { args: { owned: false } };
