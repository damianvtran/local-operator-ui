/** Exact self identity comes from the real account authority journal. These
 * synthetic fixtures cover absence as well as the own-person action; agent
 * ownership and message permission never grant permission to edit a person. */
import { radientUserKeys } from "@shared/hooks/radient-account-authority";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TeamBridgeProfileCard } from "./team-bridge-profile-card";
import "../../styles/index.css";

function Fixture({
	own = true,
	agent = false,
	known = true,
}: { own?: boolean; agent?: boolean; known?: boolean }) {
	const [client] = useState(() => {
		const value = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		if (known)
			value.setQueryData(radientUserKeys.user(), {
				account: { id: "acc_self_fixture" },
			});
		return value;
	});
	const [editing, setEditing] = useState(false);
	const destination = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (editing) destination.current?.focus();
	}, [editing]);
	return (
		<QueryClientProvider client={client}>
			<div className="min-h-96 bg-surface p-8 text-ink">
				<TeamBridgeProfileCard
					member={{
						account_id: own ? "acc_self_fixture" : "acc_other_fixture",
						display_label: "Alex Example",
						role: "member",
						bridge_enabled: true,
						bridge_state: "active",
					}}
					label={agent ? "Fixture agent" : "Alex Example"}
					kind={agent ? "agent" : "human"}
					canMessage={false}
					onMessage={() => {}}
					onEditOwnProfile={() => setEditing(true)}
				>
					<button type="button" data-testid="profile-anchor">
						{agent ? "Fixture agent" : "Alex Example"}
					</button>
				</TeamBridgeProfileCard>
				{editing && (
					<div
						ref={destination}
						tabIndex={-1}
						data-testid="profile-destination"
					>
						{t("ui.settings.personal_profile.heading")}
					</div>
				)}
			</div>
		</QueryClientProvider>
	);
}
const meta = {
	title: "Team Bridge/Own profile edit",
	component: Fixture,
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
const open = async (canvasElement: HTMLElement) => {
	await userEvent.click(within(canvasElement).getByTestId("profile-anchor"));
	return within(canvasElement.ownerDocument.body);
};
export const OwnHuman: Story = {
	play: async ({ canvasElement }) => {
		const page = await open(canvasElement);
		await expect(
			page.getByRole("button", {
				name: t("ui.settings.personal_profile.edit"),
			}),
		).toBeInTheDocument();
	},
};
export const OtherHuman: Story = {
	args: { own: false },
	play: async ({ canvasElement }) => {
		const page = await open(canvasElement);
		await expect(
			page.queryByRole("button", {
				name: t("ui.settings.personal_profile.edit"),
			}),
		).not.toBeInTheDocument();
	},
};
export const OwnAgent: Story = { args: { agent: true }, play: OtherHuman.play };
export const UnknownViewer: Story = {
	args: { known: false },
	play: OtherHuman.play,
};
export const NativeFocusHandoff: Story = {
	play: async ({ canvasElement }) => {
		const page = await open(canvasElement);
		await userEvent.click(
			page.getByRole("button", {
				name: t("ui.settings.personal_profile.edit"),
			}),
		);
		await expect(
			within(canvasElement).getByTestId("profile-destination"),
		).toHaveFocus();
		await expect(
			page.queryByRole("button", {
				name: t("ui.settings.personal_profile.edit"),
			}),
		).not.toBeInTheDocument();
	},
};
