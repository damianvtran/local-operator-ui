/** Native personal-profile states use only synthetic people/photos. No operator
 * OAuth/account mutation is involved. Play steps drive the real controls. */
import type { AccountProfileSnapshot } from "@shared/api/radient/account-profile";
import {
	accountProfileDraft,
	retainProfileFields,
} from "@shared/hooks/account-profile-draft";
import {
	radientAuthoritySnapshot,
	radientUserKeys,
} from "@shared/hooks/radient-account-authority";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AccountProfileEditor } from "./account-profile-editor";
import {
	AccountProfileLoading,
	AccountProfileReadError,
} from "./account-profile-section";
import "../../../styles/index.css";

const seed: AccountProfileSnapshot = {
	scope: "a".repeat(64),
	profile: {
		account_id: "acct_profile_fixture",
		display_name: "Alex Example",
		display_label: "Alex Example",
		title: "Researcher",
		description: "Synthetic profile fixture. No real account is connected.",
		timezone: "Europe/Paris",
		avatar: { source: "none", hash: "" },
	},
};
function Fixture({
	empty = false,
	fail = false,
	saving = false,
	provider = false,
}: { empty?: boolean; fail?: boolean; saving?: boolean; provider?: boolean }) {
	const [snapshot, setSnapshot] = useState<AccountProfileSnapshot>({
		...seed,
		profile: {
			...seed.profile,
			...(empty
				? { display_name: "", title: "", description: "", timezone: "" }
				: {}),
			...(provider
				? { avatar: { source: "google", hash: "a".repeat(16) } }
				: {}),
		},
	});
	return (
		<div className="min-w-0 max-w-2xl bg-surface p-4 text-ink">
			<AccountProfileEditor
				snapshot={snapshot}
				onSave={async (fields) => {
					if (fail) throw new Error("Synthetic fixture failure");
					if (saving) return new Promise(() => {});
					const next = {
						...snapshot,
						profile: { ...snapshot.profile, ...fields },
					};
					setSnapshot(next);
					return next;
				}}
				onUpload={async () => {
					if (fail) throw new Error("Synthetic fixture failure");
					if (saving) return new Promise(() => {});
					const next = {
						...snapshot,
						profile: {
							...snapshot.profile,
							avatar: { source: "uploaded", hash: "b".repeat(16) },
						},
					};
					setSnapshot(next);
					return next;
				}}
				onRemove={async () => {
					if (fail) throw new Error("Synthetic fixture failure");
					const next = {
						...snapshot,
						profile: {
							...snapshot.profile,
							avatar: { source: "none", hash: "" },
						},
					};
					setSnapshot(next);
					return next;
				}}
			/>
		</div>
	);
}
const meta = {
	title: "Settings/Personal profile",
	component: Fixture,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = { args: { empty: true } };
export const Narrow: Story = {
	render: () => (
		<div className="w-[280px]">
			<Fixture />
		</div>
	),
};
export const Loading: Story = { render: () => <AccountProfileLoading /> };
export const ReadError: Story = {
	render: () => <AccountProfileReadError onRetry={() => {}} />,
};
const editName = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	const name = canvas.getByLabelText(
		t("ui.settings.personal_profile.display_name"),
	);
	await userEvent.clear(name);
	await userEvent.type(name, "Alex Updated");
	return canvas;
};
export const Saved: Story = {
	play: async ({ canvasElement }) => {
		const canvas = await editName(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.settings.personal_profile.save"),
				exact: true,
			}),
		);
		await expect(
			canvas.getByText(t("ui.settings.personal_profile.saved")),
		).toBeInTheDocument();
	},
};
export const SaveFailure: Story = {
	args: { fail: true },
	play: async ({ canvasElement }) => {
		const canvas = await editName(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.settings.personal_profile.save"),
				exact: true,
			}),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			t("ui.settings.personal_profile.save_error"),
		);
	},
};
export const Saving: Story = {
	args: { saving: true },
	play: async ({ canvasElement }) => {
		const canvas = await editName(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.settings.personal_profile.save"),
				exact: true,
			}),
		);
	},
};
export const DiscardConfirmation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = await editName(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.common.actions.cancel"),
				exact: true,
			}),
		);
	},
};
export const ProviderRemoval: Story = {
	args: { provider: true },
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: t("ui.settings.personal_profile.remove"),
				exact: true,
			}),
		);
	},
};
async function chooseFixture(canvasElement: HTMLElement) {
	const image = document.createElement("canvas");
	image.width = 800;
	image.height = 600;
	const context = image.getContext("2d");
	if (!context) throw new Error("Synthetic photo fixture canvas unavailable");
	// Deliberate fixture colours, not UI theme tokens; the geometric scene makes
	// pan/zoom changes observable without a real person's face or external file.
	context.fillStyle = "#a3c4d4";
	context.fillRect(0, 0, 800, 600);
	context.fillStyle = "#31566a";
	context.fillRect(80, 80, 400, 400);
	context.fillStyle = "#e8b75b";
	context.beginPath();
	context.arc(550, 300, 140, 0, 2 * Math.PI);
	context.fill();
	const blob = await new Promise<Blob>((resolve, reject) =>
		image.toBlob(
			(value) =>
				value ? resolve(value) : reject(new Error("Fixture encoding failed")),
			"image/png",
		),
	);
	await userEvent.upload(
		within(canvasElement).getByLabelText(
			t("ui.settings.personal_profile.choose"),
		),
		new File([blob], "synthetic-profile.png", { type: "image/png" }),
	);
	await within(canvasElement).findByLabelText(
		t("ui.settings.personal_profile.crop_area"),
	);
}
export const Crop: Story = {
	play: async ({ canvasElement }) => chooseFixture(canvasElement),
};
export const CropNarrow: Story = {
	render: () => (
		<div className="w-[280px]">
			<Fixture />
		</div>
	),
	play: async ({ canvasElement }) => chooseFixture(canvasElement),
};
function NavigationFixture() {
	const [client] = useState(() => {
		const query = new QueryClient();
		query.setQueryData(radientUserKeys.user(), {
			account: { id: seed.profile.account_id },
		});
		return query;
	});
	const [shown, setShown] = useState(true);
	const [snapshot, setSnapshot] = useState(seed);
	const key = `${radientAuthoritySnapshot(client)}:personal:${snapshot.scope}`;
	const retained = accountProfileDraft(client, key);
	return (
		<div className="flex max-w-2xl flex-col gap-4 bg-surface p-4 text-ink">
			{/* i18n: ignore story-only route lifecycle controls, never shipped UI */}
			<button
				type="button"
				data-testid="fixture-navigation"
				onClick={() => setShown(!shown)}
			>
				{shown ? "Leave fixture route" : "Return to fixture route"}
			</button>
			{shown && (
				<AccountProfileEditor
					snapshot={snapshot}
					initialDraft={retained?.fields}
					onDraftChange={(fields) => retainProfileFields(client, key, fields)}
					onSave={async (fields) => {
						const next = {
							...snapshot,
							profile: { ...snapshot.profile, ...fields },
						};
						setSnapshot(next);
						return next;
					}}
					onUpload={async () => snapshot}
					onRemove={async () => snapshot}
				/>
			)}
		</div>
	);
}
export const RetainedNavigation: Story = {
	render: () => <NavigationFixture />,
	play: async ({ canvasElement }) => {
		const canvas = await editName(canvasElement);
		await userEvent.click(canvas.getByTestId("fixture-navigation"));
		await userEvent.click(canvas.getByTestId("fixture-navigation"));
		await expect(
			canvas.getByLabelText(t("ui.settings.personal_profile.display_name")),
		).toHaveValue("Alex Updated");
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.common.actions.cancel"),
				exact: true,
			}),
		);
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.settings.personal_profile.discard_action"),
				exact: true,
			}),
		);
		await userEvent.click(canvas.getByTestId("fixture-navigation"));
		await userEvent.click(canvas.getByTestId("fixture-navigation"));
		await expect(
			canvas.getByLabelText(t("ui.settings.personal_profile.display_name")),
		).toHaveValue(seed.profile.display_name);
	},
};
export const PhotoFailure: Story = {
	args: { fail: true },
	play: async ({ canvasElement }) => {
		await chooseFixture(canvasElement);
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: t("ui.settings.personal_profile.save_photo"),
				exact: true,
			}),
		);
		await within(canvasElement).findByRole("alert");
	},
};
