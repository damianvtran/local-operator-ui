import type { Meta, StoryObj } from "@storybook/react";
import { BridgeAttachmentGroup } from "./bridge-attachment-group";

const metadata = {
	id: "synthetic-receipt",
	mime: "image/png",
	size: 2048,
	width: 640,
	height: 480,
	state: "bound",
};
const meta = {
	title: "Team Bridge/Shared attachment cards",
	component: BridgeAttachmentGroup,
	parameters: { layout: "padded" },
	args: { attachments: [metadata] },
} satisfies Meta<typeof BridgeAttachmentGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

// These are descriptors only: no relay or upload is simulated. Existing member
// image stories exercise the same anatomy through the authenticated member seam.
export const AuditMetadata: Story = {};
export const FileMetadata: Story = {
	args: { attachments: [{ ...metadata, mime: "application/octet-stream" }] },
};
export const CountOnlyAudit: Story = { args: { attachments: [], count: 3 } };
export const Empty: Story = { args: { attachments: [] } };
export const Unavailable: Story = {
	args: {
		compact: true,
		attachments: ["expired", "withheld", "deleted", "unknown", "revoked"].map(
			(state) => ({ ...metadata, id: state, state }),
		),
	},
};
export const NarrowAudit: Story = {
	args: {
		compact: true,
		attachments: [metadata, { ...metadata, id: "second" }],
	},
	decorators: [
		(Story) => (
			<div style={{ width: 272 }}>
				<Story />
			</div>
		),
	],
};
