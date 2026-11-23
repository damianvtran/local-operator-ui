import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useLayoutEffect, useState } from "react";
import sampleMp4Url from "../../../../../../scripts/fixtures/library/sample.mp4?url";
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
const videoName = "synthetic-private-caption.mp4";
const video = `/example/${videoName}`;
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

function StagingFixture({
	narrow = false,
	scenario = "standard",
}: {
	narrow?: boolean;
	scenario?: "standard" | "named-video" | "no-bridge";
}) {
	const [items, setItems] = useState(() =>
		scenario === "standard"
			? attachments
			: [{ id: scenario, path: scenario === "named-video" ? video : pending }],
	);
	useLayoutEffect(() => {
		// Freeze only this fixture's read, so the loading state is observable
		// without touching the real filesystem or depending on a delay.
		const prior = window.api.readFileBytes;
		if (scenario === "no-bridge") {
			Reflect.deleteProperty(window.api, "readFileBytes");
			return () => {
				window.api.readFileBytes = prior;
			};
		}
		window.api.readFileBytes = async (path, maxBytes) => {
			if (path === video) {
				const response = await fetch(sampleMp4Url);
				if (!response.ok) throw new Error("Missing sample video bytes");
				const data = new Uint8Array(await response.arrayBuffer());
				return { success: true, data, sizeBytes: data.byteLength };
			}
			if (path === pending) return new Promise(() => {});
			if (prior) return prior(path, maxBytes);
			return {
				success: false,
				code: "not-found",
				error: "No fixture bytes for this path",
			};
		};
		return () => {
			window.api.readFileBytes = prior;
		};
	}, [scenario]);

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

export const NamedVideo: Story = {
	render: () => <StagingFixture scenario="named-video" />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const doc = canvasElement.ownerDocument;
		const trigger = await canvas.findByRole("button", {
			name: `Expand ${videoName}`,
		});
		const expectMaskedCaption = async (root: Element) => {
			// Replay serializes attributes separately from masked text, even under ph-mask.
			for (const element of [root, ...root.querySelectorAll("*")]) {
				for (const attribute of element.attributes) {
					await expect(attribute.value).not.toContain(videoName);
				}
			}
			const label = doc.getElementById(
				root.getAttribute("aria-labelledby") ?? "",
			);
			await expect(label).toHaveTextContent(videoName);
			await expect(label?.closest(".ph-mask")).toBeInTheDocument();
		};
		await expectMaskedCaption(trigger);
		await waitFor(() =>
			expect(trigger.querySelector("video")?.readyState).toBeGreaterThan(0),
		);
		await userEvent.click(trigger);
		const dialog = await within(doc.body).findByRole("dialog", {
			name: videoName,
		});
		await expectMaskedCaption(dialog);
		await expect(dialog.querySelector("video")).toHaveAttribute("controls");
	},
};

export const NoFileBridge: Story = {
	render: () => <StagingFixture scenario="no-bridge" />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Could not be previewed"),
		).toBeVisible();
		await expect(canvas.getByText("Still loading.png")).toBeVisible();
		await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
	},
};

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
