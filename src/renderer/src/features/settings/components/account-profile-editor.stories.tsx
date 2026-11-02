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
import {
	dispatchWhileCurrent,
	useMutationLifetime,
} from "@shared/lib/mutation-lifetime";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { QueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
	/*
	 * BY SELECTOR, NOT BY LABEL (design round 2, D8). The file input is
	 * deliberately unnamed and `aria-hidden` (UX round 1, N2): the visible
	 * button is the one accessible name. A label lookup therefore threw, the
	 * play stopped, and the story rendered the plain form while looking like a
	 * passing frame. A missing input now throws by name, and the crop area is
	 * awaited so the story cannot settle anywhere but in the crop state.
	 */
	const input =
		canvasElement.querySelector<HTMLInputElement>("input[type=file]");
	if (!input) throw new Error("Profile photo file input is not rendered");
	await userEvent.upload(
		input,
		new File([blob], "synthetic-profile.png", { type: "image/png" }),
	);
	await expect(
		await within(canvasElement).findByLabelText(
			t("ui.settings.personal_profile.crop_area"),
		),
	).toBeInTheDocument();
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
			}),
		);
		await userEvent.click(
			canvas.getByRole("button", {
				name: t("ui.settings.personal_profile.discard_action"),
			}),
		);
		await userEvent.click(canvas.getByTestId("fixture-navigation"));
		await userEvent.click(canvas.getByTestId("fixture-navigation"));
		await expect(
			canvas.getByLabelText(t("ui.settings.personal_profile.display_name")),
		).toHaveValue(seed.profile.display_name);
	},
};
function DeferredPhotoPreparation({
	release,
	onDispatch,
}: { release: { current: (() => void) | undefined }; onDispatch: () => void }) {
	const lifetime = useMutationLifetime("synthetic selected photo");
	return (
		<button
			type="button"
			data-testid="prepare-photo"
			onClick={() => {
				void dispatchWhileCurrent(
					lifetime,
					lifetime.capture(),
					() =>
						new Promise<ArrayBuffer>((resolve) => {
							release.current = () => resolve(new ArrayBuffer(1));
						}),
					onDispatch,
				);
			}}
		>
			Prepare fixture photo
		</button>
	);
}
function DeferredUnmountFixture() {
	const [mounted, setMounted] = useState(true);
	const [calls, setCalls] = useState(0);
	const release = useRef<(() => void) | undefined>(undefined);
	return (
		<div className="flex flex-col gap-4 bg-surface p-4 text-ink">
			{/* i18n: ignore story-only deferred-promise/unmount controls, never product copy */}
			{mounted && (
				<DeferredPhotoPreparation
					release={release}
					onDispatch={() => setCalls((value) => value + 1)}
				/>
			)}
			<button
				type="button"
				data-testid="unmount-photo"
				onClick={() => setMounted(false)}
			>
				Leave fixture editor
			</button>
			<button
				type="button"
				data-testid="resolve-photo"
				onClick={() => release.current?.()}
			>
				Complete deferred preparation
			</button>
			<output data-testid="transport-count">{calls}</output>
		</div>
	);
}
export const DeferredUnmountNoUpload: Story = {
	render: () => <DeferredUnmountFixture />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId("prepare-photo"));
		await userEvent.click(canvas.getByTestId("unmount-photo"));
		await userEvent.click(canvas.getByTestId("resolve-photo"));
		await expect(canvas.getByTestId("transport-count")).toHaveTextContent("0");
	},
};
export const PhotoFailure: Story = {
	args: { fail: true },
	play: async ({ canvasElement }) => {
		await chooseFixture(canvasElement);
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: t("ui.settings.personal_profile.save_photo"),
			}),
		);
		// The upload's own error, not just any alert: the story must settle in
		// the photo-failure state it is named for.
		await expect(
			await within(canvasElement).findByText(
				t("ui.settings.personal_profile.photo_error"),
			),
		).toBeInTheDocument();
	},
};
