import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useLayoutEffect, useState } from "react";
import { AttachmentsPreview } from "./attachments-preview";

const meta = {
	title: "Chat/Attachments preview",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const portrait = new URL(
	"../../../assets/images/storybook-avatar-portrait.jpg",
	import.meta.url,
).href;
const report = "/example/Board Pack and Appendices — Final Reviewed.pdf";
const audio = "/example/Meeting notes.mp3";
const pending = "/example/Still loading.png";
const attachments = [
	{ id: "image", path: portrait },
	{ id: "report", path: report },
	{ id: "audio", path: audio },
	{ id: "loading", path: pending },
	{ id: "broken", path: "data:image/png;base64,bm90IGFuIGltYWdl" },
];
const byteSizes = { [report]: 2_411_520, [audio]: 380_000 };
const expandPortrait = /Expand .*portrait/;
const portraitTitle = /portrait/;

function StagingFixture({ narrow = false }: { narrow?: boolean }) {
	const [items, setItems] = useState(attachments);
	useLayoutEffect(() => {
		// Freeze only this fixture's read, so the loading state is observable
		// without touching the real filesystem or depending on a delay.
		const prior = window.api.readFileBytes;
		window.api.readFileBytes = (path, maxBytes) =>
			path === pending
				? new Promise(() => {})
				: prior
					? prior(path, maxBytes)
					: Promise.resolve({
							success: false,
							code: "not-found",
							error: "No fixture bytes for this path",
						});
		return () => {
			window.api.readFileBytes = prior;
		};
	}, []);

	return (
		<div className={narrow ? "w-full max-w-[19rem]" : "w-full max-w-3xl"}>
			<div className="max-h-60 overflow-y-auto rounded-lg bg-surface px-3">
				<AttachmentsPreview
					attachments={items}
					byteSizes={byteSizes}
					onRemoveAttachment={(id) =>
						setItems((current) => current.filter((item) => item.id !== id))
					}
				/>
			</div>
		</div>
	);
}

export const Staged: Story = { render: () => <StagingFixture /> };
export const Narrow: Story = { render: () => <StagingFixture narrow /> };

export const KeyboardAndRemoval: Story = {
	render: () => <StagingFixture narrow />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const body = within(canvasElement.ownerDocument.body);
		const trigger = canvas.getByRole("button", { name: expandPortrait });
		await expect(canvas.getByRole("status")).toHaveTextContent(
			"Loading preview",
		);
		await expect(
			await canvas.findByText("Could not be previewed"),
		).toBeVisible();
		await expect(
			canvas.queryByRole("button", { name: "Expand Pasted image" }),
		).not.toBeInTheDocument();

		await userEvent.tab();
		await expect(trigger).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		const dialog = await body.findByRole("dialog", { name: portraitTitle });
		await expect(dialog).toBeVisible();
		await expect(
			within(dialog).getByRole("button", { name: "Close" }),
		).toHaveFocus();
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(trigger).toHaveFocus());
		await expect(body.queryByRole("dialog")).not.toBeInTheDocument();

		await userEvent.tab();
		const remove = canvas.getAllByRole("button", { name: "Remove attachment" });
		await expect(remove[0]).toHaveFocus();
		await expect(remove[0]).not.toHaveStyle({ opacity: "0" });
		await userEvent.keyboard("{Enter}");
		await expect(trigger).not.toBeInTheDocument();
		await expect(remove[1]).toBeInTheDocument();
		await expect(
			canvas.getAllByRole("button", { name: "Remove attachment" }),
		).toHaveLength(4);
	},
};
