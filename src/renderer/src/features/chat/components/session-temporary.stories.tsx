/**
 * Temporary chats (`features.temporary_chats`), for design review: the draft's
 * dashed toggle, the live pill and its last-five-minutes countdown, the header
 * menu's Keep / Make temporary items, the confirmation, and the sidebar's
 * `Temporary · N` group. `session-archive.stories.tsx` is the precedent; these
 * render the components with fixtures and a pinned clock, so every frame is the
 * same frame on every host.
 */
import { cn } from "@shared/lib/utils";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { useEffect, useState } from "react";
import { ChatHeader } from "./chat-header";
import { MakeTemporaryDialog } from "./make-temporary-dialog";
import { SidebarTemporaryGroup } from "./sidebar-temporary-group";

// A pinned clock: every countdown below is computed against it.
const NOW_MS = Date.UTC(2026, 10, 11, 15, 0, 0);
const NOW_S = NOW_MS / 1000;

const live = {
	marked_at: NOW_S - 600,
	idle_minutes: 30,
	deletes_at: NOW_S + 22 * 60,
	hold: null,
};
const lastMinutes = { ...live, deletes_at: NOW_S + 4 * 60 };
const held = { ...live, deletes_at: null, hold: "running" };

const Header = ({
	draft,
	temporary = null,
	open = false,
}: {
	draft?: boolean;
	temporary?: typeof live | null;
	open?: boolean;
}) => {
	const [on, setOn] = useState(draft === true);
	return (
		<div className={cn("flex h-[84px] w-[640px] shrink-0 flex-col bg-canvas")}>
			<ChatHeader
				agentName={draft === undefined ? "Quick regex question" : "New chat"}
				description="~/work/api"
				onOpenOptions={() => undefined}
				onToggleBrowser={() => undefined}
				deleteEnabled
				onRequestDelete={() => undefined}
				temporaryEnabled
				temporary={temporary}
				temporaryDraft={
					draft === undefined ? undefined : { on, onToggle: setOn }
				}
				onKeepTemporary={draft === undefined ? () => undefined : undefined}
				onMakeTemporary={draft === undefined ? () => undefined : undefined}
				temporaryNowMs={NOW_MS}
			/>
			{open ? <MenuOpener /> : null}
		</div>
	);
};

const MenuOpener = () => {
	useEffect(() => {
		void (async () => {
			const trigger = await screen.findByLabelText("Conversation actions");
			await userEvent.click(trigger);
		})();
	}, []);
	return null;
};

const rows: CanonicalSessionRow[] = [
	{
		session_id: "a1b2c3d4e5f6",
		title: "Quick regex question",
		temporary: live,
	},
	{
		session_id: "b2c3d4e5f6a1",
		title: "Scratch: curl flags",
		temporary: lastMinutes,
	},
	{ session_id: "c3d4e5f6a1b2", title: "Try the new parser", temporary: held },
];

const meta = {
	title: "Session temporary",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

export const DraftToggleOff: Story = { render: () => <Header draft={false} /> };
export const DraftToggleOn: Story = { render: () => <Header draft /> };
export const LivePill: Story = { render: () => <Header temporary={live} /> };
export const LastFiveMinutes: Story = {
	render: () => <Header temporary={lastMinutes} />,
};
export const MenuKeepChat: Story = {
	render: () => <Header temporary={live} open />,
	play: async () => {
		await screen.findByText("Keep chat");
	},
};
export const MenuMakeTemporary: Story = {
	render: () => <Header temporary={null} open />,
	play: async () => {
		await screen.findByText("Make temporary…");
	},
};
export const ConfirmMakeTemporary: Story = {
	render: () => (
		<div className={cn("flex h-[560px] w-[640px] bg-canvas")}>
			<MakeTemporaryDialog
				open
				onConfirm={() => undefined}
				onCancel={() => undefined}
			/>
		</div>
	),
};
export const SidebarGroupClosed: Story = {
	render: () => (
		<div className={cn("w-[300px] bg-surface p-1")}>
			<SidebarTemporaryGroup
				rows={rows}
				currentId="0ther0000000"
				onSelect={() => undefined}
				nowMs={NOW_MS}
			/>
		</div>
	),
};
export const SidebarGroupOpen: Story = {
	render: () => (
		<div className={cn("w-[300px] bg-surface p-1")}>
			<SidebarTemporaryGroup
				rows={rows}
				currentId="a1b2c3d4e5f6"
				onSelect={() => undefined}
				nowMs={NOW_MS}
			/>
		</div>
	),
};
