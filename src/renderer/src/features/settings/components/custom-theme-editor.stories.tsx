import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { Contrast } from "lucide-react";
import { useState } from "react";
import type { CustomThemeV1 } from "../../../../../shared/theme-engine/appearance.mjs";
import { AppearanceLayers } from "./appearance-layers";
import { CustomThemeEditor } from "./custom-theme-editor";
import { CustomThemeStatus } from "./custom-theme-status";
import { SettingsSection } from "./settings-section";
import { ThemeSelector } from "./theme-selector";

const initial: CustomThemeV1 = {
	format: "local-operator-theme",
	version: 1,
	id: "custom-story",
	name: "Harbour",
	base: "localOperatorDark",
	seeds: {},
	overrides: {},
	updatedAt: 1,
};
const Editor = ({
	light = false,
	invalid = false,
}: { light?: boolean; invalid?: boolean }) => {
	const [open, setOpen] = useState(true);
	return (
		<>
			<Button onClick={() => setOpen(true)}>
				{t("ui.settings.appearance.editor.edit")}
			</Button>
			{open && (
				<CustomThemeEditor
					initial={{
						...initial,
						base: light ? "localOperatorLight" : "localOperatorDark",
						overrides: invalid ? { ink: "#000000", canvas: "#000000" } : {},
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
};
const meta = {
	title: "Settings/Custom theme editor",
	component: CustomThemeEditor,
	args: { initial, onClose: () => {} },
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CustomThemeEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Gallery: Story = {
	render: () => (
		<div className="h-screen overflow-y-auto">
			<div className="mx-auto max-w-4xl p-6">
				<SettingsSection
					title={t("ui.settings.appearance.settings_page.appearance")}
					description={t(
						"ui.settings.appearance.settings_page.customize_the_look_and_feel_of_local_operator",
					)}
					icon={Contrast}
				>
					<AppearanceLayers gallery={<ThemeSelector />} />
				</SettingsSection>
			</div>
		</div>
	),
};
export const Populated: Story = { render: () => <Editor /> };
export const Light: Story = { render: () => <Editor light /> };
export const InvalidContrast: Story = { render: () => <Editor invalid /> };
/** A real nested viewport, not a max-width wrapper: Radix portals attach to
 * the document body. Constraining a parent div would not test the drawer. */
export const Narrow: Story = {
	render: () => (
		<iframe
			title={t("ui.settings.appearance.editor.preview")}
			src="/iframe.html?id=settings-custom-theme-editor--populated&viewMode=story"
			width={480}
			height={720}
			className="h-screen max-w-full border-0"
		/>
	),
};
export const Loading: Story = {
	render: () => (
		<div className="p-6">
			<CustomThemeStatus loading error={false} count={0} onRetry={() => {}} />
		</div>
	),
};
export const Empty: Story = {
	render: () => (
		<div className="p-6">
			<CustomThemeStatus
				loading={false}
				error={false}
				count={0}
				onRetry={() => {}}
			/>
		</div>
	),
};
export const ErrorState: Story = {
	render: () => (
		<div className="p-6">
			<CustomThemeStatus loading={false} error count={0} onRetry={() => {}} />
		</div>
	),
};

export const InvalidHexBlocksSave: Story = {
	render: () => <Editor />,
	play: async () => {
		const body = within(document.body);
		const hex = await body.findByLabelText(
			t("ui.settings.appearance.editor.role.canvas"),
			{ selector: "input" },
		);
		await userEvent.clear(hex);
		await userEvent.type(hex, "#12");
		await userEvent.tab();
		await expect(
			body.getByRole("button", {
				name: t("ui.settings.appearance.editor.save"),
			}),
		).toBeDisabled();
		await expect(hex).toHaveAttribute("aria-invalid", "true");
	},
};
export const CancelDiscardsDraft: Story = {
	render: () => <Editor />,
	play: async () => {
		const body = within(document.body);
		const before = document.documentElement.dataset.theme;
		const name = await body.findByLabelText(
			t("ui.settings.appearance.editor.name"),
		);
		await userEvent.clear(name);
		await userEvent.type(name, "Unsaved colour draft");
		await expect(document.documentElement.dataset.theme).toBe(before);
		await userEvent.click(
			body.getByRole("button", {
				name: t("ui.settings.appearance.editor.cancel"),
			}),
		);
		await userEvent.click(
			await body.findByRole("button", {
				name: t("ui.settings.appearance.editor.discard"),
			}),
		);
		await waitFor(() =>
			expect(
				body.queryByLabelText(t("ui.settings.appearance.editor.name")),
			).not.toBeInTheDocument(),
		);
		await expect(useUiPreferencesStore.getState().customThemeId).not.toBe(
			initial.id,
		);
	},
};

export const ImportedPinnedEssentialCanEdit: Story = {
	render: () => (
		<CustomThemeEditor
			initial={{ ...initial, overrides: { accent: "#38C96A" } }}
			onClose={() => {}}
		/>
	),
	play: async () => {
		const body = within(document.body);
		const input = await body.findByLabelText(
			t("ui.settings.appearance.editor.role.accent"),
			{ selector: "input" },
		);
		await userEvent.clear(input);
		await userEvent.type(input, "#32CA68");
		await userEvent.tab();
		await expect(input).toHaveValue("#32CA68");
		await expect(
			body.getByRole("button", {
				name: t("ui.settings.appearance.editor.save"),
			}),
		).toBeEnabled();
	},
};
