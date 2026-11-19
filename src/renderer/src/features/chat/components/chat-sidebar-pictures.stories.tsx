/**
 * The real chat sidebar with a mix of pictured and unpictured conversation rows.
 *
 * WHY THE REAL SIDEBAR. The session row's leading cluster (status glyph and
 * picture) and its pencil door are laid out by the sidebar's own row wrapper
 * (`rowBoxStyle`, the locality cell, `ChatSessionAvatarEdit`'s `start-*`), so a
 * stand-in row built from the marks alone cannot show whether the pencil still
 * lands on the picture or whether a list that mixes both kinds of row keeps one
 * status column. Only the desktop transport and the media relay are stubbed.
 */

import { agentAvatarsQueryKey } from "@shared/agent-avatar/agent-avatar";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useEffect } from "react";
import { ChatSidebar } from "./chat-sidebar";

const SHA = "d".repeat(64);

const PICTURED = { id: "agent-pictured", name: "coder" };
const BARE = { id: "agent-bare", name: "scout" };

const syntheticPng = (): Uint8Array => {
	const canvas = document.createElement("canvas");
	canvas.width = 64;
	canvas.height = 64;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = "#6b7280";
		context.fillRect(0, 0, 64, 64);
		context.fillStyle = "#e5e7eb";
		context.beginPath();
		context.arc(32, 26, 13, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.arc(32, 62, 22, Math.PI, 0);
		context.fill();
	}
	const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};
const PNG = syntheticPng();

const wireRow = (
	id: string,
	name: string,
	mtime: number,
	agent: { id: string; name: string },
	status: { code: string; label: string },
	pictured: boolean,
) => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: agent.name, team: null },
	agent_id: agent.id,
	avatar_sha256: pictured ? SHA : null,
	status,
});

const ROSTER = [
	wireRow(
		"a1",
		"Reconcile the supplier ledger",
		1_760_000_500,
		PICTURED,
		{ code: "busy", label: "Running" },
		true,
	),
	wireRow(
		"a2",
		"Migrate the deploy script",
		1_760_000_400,
		BARE,
		{ code: "busy", label: "Running" },
		false,
	),
	wireRow(
		"a3",
		"Quarterly revenue model",
		1_760_000_300,
		PICTURED,
		{ code: "complete", label: "Done" },
		true,
	),
	wireRow(
		"a4",
		"Audit the retry budget",
		1_760_000_200,
		BARE,
		{ code: "complete", label: "Done" },
		false,
	),
	wireRow(
		"a5",
		"Draft the release notes",
		1_760_000_100,
		PICTURED,
		{ code: "error", label: "Failed" },
		true,
	),
	wireRow(
		"a6",
		"Clean up stale branches",
		1_760_000_000,
		BARE,
		{ code: "error", label: "Failed" },
		false,
	),
];

if (typeof window !== "undefined") {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = ((window as any).api ?? {}) as any;
	const ok = (result: unknown) => ({ status: 200, body: { result } });
	api.desktop = {
		...(api.desktop ?? {}),
		request: async (request: { op: string }) => {
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						features: {
							session_catalogue: 2,
							profile_catalogue: 1,
							team_catalogue: 1,
						},
					});
				case "sessions.list":
					return ok({ sessions: ROSTER, truncated: false });
				case "profiles.list":
					return ok({ profiles: [] });
				case "teams.list":
					return ok({ teams: [] });
				default:
					throw new Error(`unexpected desktop op in this story: ${request.op}`);
			}
		},
		media: async (request: { op?: string }) =>
			request.op === "agent.avatar"
				? { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	(window as unknown as { api: unknown }).api = api;
}

const Page: FC = () => {
	const client = useQueryClient();
	useEffect(() => {
		client.setQueryData(agentAvatarsQueryKey, {
			[PICTURED.id]: {
				sha256: SHA,
				mime: "image/png",
				bytes: PNG.byteLength,
				updated_at: "2026-11-03T00:00:00.000Z",
			},
		});
	}, [client]);
	return (
		<div
			data-sidebar-pictures=""
			className={cn(
				"flex h-[420px] w-[280px] overflow-hidden bg-canvas text-ink",
			)}
		>
			<div className="w-[280px] shrink-0">
				<ChatSidebar
					selectedConversation={undefined}
					onSelectConversation={() => undefined}
					onStageDraft={() => undefined}
				/>
			</div>
		</div>
	);
};

const meta = {
	title: "Chat/Sidebar pictured rows",
	parameters: { layout: "fullscreen" },
	render: () => <Page />,
} satisfies Meta;
export default meta;

type Story = StoryObj;

/** Running, done and failed, each with a picture and without, in one list. */
export const MixedRows: Story = {};
