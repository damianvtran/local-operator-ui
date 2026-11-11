/**
 * The New chat header's agent/team chip, beside the device chip it joins.
 *
 * `Before` is the change absent - the header `origin/main` draws for a New chat
 * (the device chip alone, the operator's screenshot) - so the after frames read
 * against it. Every mount goes through the real `ChatHeader`, the real
 * `ChatDeviceSlot` and the real chip, fed by a story bridge that answers the
 * desktop reads they make; the chip's rosters come from `profiles.list` and
 * `teams.list` exactly as in the app.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect, useLayoutEffect } from "react";
import "../../../styles/index.css";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ChatDeviceSlot } from "../device/chat-device-slot";
import { ChatHeader } from "./chat-header";
import { ChatHeaderDraftTarget } from "./chat-header-draft-target";

const meta = {
	title: "Chat/Draft target",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

const DRAFT = "draft-4f2c";
const SELF = "d_9f3ac1e0b7d2aa41";
const CAPABILITIES = {
	desktop_available: true,
	desktop_contract: 1,
	desktop_auth: "bearer" as const,
	features: { peers: 1, profile_catalogue: 1, team_catalogue: 1 },
};

const profile = (name: string, source = "custom") => ({
	name,
	kind: "role",
	source,
	agent_id: null,
	description: "",
	tools: null,
	effort: null,
	delegate: false,
});

const installBridge = () => {
	const ok = <T,>(result: T) => ({ status: 200, body: { result } });
	const bridge = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return ok(CAPABILITIES);
			case "peers.list":
				return ok({ self_device_id: SELF, peers: [] });
			case "networks.list":
				return ok({ self_device_id: SELF, networks: [] });
			case "profiles.list":
				return ok({
					profiles: [
						profile("coder"),
						profile("reviewer"),
						profile("scout"),
						profile("designer", "builtin"),
					],
				});
			case "teams.list":
				return ok({
					teams: [
						{
							id: "t1",
							name: "lopdev",
							label: "Local Operator Dev",
							manager: "manager",
							description: "",
						},
						{ id: "t2", name: "ops", manager: "lead", description: "" },
					],
				});
			case "commands.entities":
				return ok({ command: "", entities: [], current: null });
			case "sessions.list":
				return ok({ sessions: [] });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof bridge } };
	};
	page.api = { ...(page.api ?? {}), desktop: { request: bridge } };
};

const seed = (target?: ChatTarget) => {
	useCanonicalSessionsStore.setState({
		activeDraftKey: DRAFT,
		drafts: {
			[DRAFT]: {
				key: DRAFT,
				target,
				admissionRequestId: "story-admission",
				createRequestId: "story-create",
			},
		},
	});
};

const Band = ({ children }: { children: ReactNode }) => (
	<div
		data-header-band=""
		className={cn("flex shrink-0 flex-col bg-canvas")}
		style={{ width: 1000 }}
	>
		{children}
	</div>
);

/**
 * Opens the chip's menu once the rosters have painted, holding the capture
 * latch until then so the frame is the open menu and not its loading row.
 */
const OpenOnMount = () => {
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.capturePending = "";
		let tries = 0;
		const timer = window.setInterval(() => {
			tries += 1;
			const chip = document.querySelector<HTMLButtonElement>(
				"[data-draft-target-chip]",
			);
			const menu = document.querySelector("[data-draft-target-menu]");
			if (chip && !menu) {
				chip.focus();
				chip.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
			}
			if (
				document.querySelector('[data-draft-target-row="team:ops"]') ||
				tries > 100
			) {
				window.clearInterval(timer);
				delete root.dataset.capturePending;
			}
		}, 50);
		return () => window.clearInterval(timer);
	}, []);
	return null;
};

const Mount = ({
	title = "New chat",
	target,
	withChip = true,
	open = false,
}: {
	title?: string;
	target?: ChatTarget;
	withChip?: boolean;
	open?: boolean;
}) => {
	useLayoutEffect(() => {
		installBridge();
		seed(target);
	}, [target]);
	return (
		<div className={cn("flex min-h-[30rem] flex-col bg-canvas")}>
			<Band>
				<ChatHeader
					agentName={title}
					description="~/local-operator-ui"
					onOpenOptions={() => undefined}
					onToggleBrowser={() => undefined}
					onOpenConsole={() => undefined}
					draftTargetSlot={
						withChip ? (
							<ChatHeaderDraftTarget
								target={target}
								capabilities={CAPABILITIES}
							/>
						) : undefined
					}
					deviceSlot={<ChatDeviceSlot draftKey={DRAFT} />}
				/>
			</Band>
			{open ? <OpenOnMount /> : null}
		</div>
	);
};

/** TODAY: a New chat's header offers the device chip and nothing else. */
export const Before: Story = {
	render: () => <Mount withChip={false} />,
};

/** A fresh New chat: the chip reads the default agent. */
export const DefaultClosed: Story = {
	render: () => <Mount />,
};

/** The chip's menu: the default, then agents, then teams (by label). */
export const MenuOpen: Story = {
	render: () => <Mount open={true} />,
};

/** A team picked (or arrived from the sidebar's "New chat with <team>"). */
export const TeamPicked: Story = {
	render: () => (
		<Mount
			title="New chat with Local Operator Dev"
			target={{ kind: "team", name: "lopdev" }}
		/>
	),
};

/** An agent picked. */
export const AgentPicked: Story = {
	render: () => (
		<Mount
			title="New chat with reviewer"
			target={{ kind: "agent", name: "reviewer" }}
		/>
	),
};
