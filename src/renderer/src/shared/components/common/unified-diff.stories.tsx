import type { Meta, StoryObj } from "@storybook/react";
import { UnifiedDiff } from "./unified-diff";

const meta: Meta<typeof UnifiedDiff> = {
	title: "Common/Unified diff",
	component: UnifiedDiff,
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-3xl p-6">
				<Story />
			</div>
		),
	],
	args: { labels: { before: "Current", after: "Proposed" }, maxHeight: 480 },
};
export default meta;
type Story = StoryObj<typeof UnifiedDiff>;
export const EditedWords: Story = {
	args: {
		before: "Keep replies short and direct.\nCite sources.",
		after: "Keep replies concise and direct.\nCite primary sources.",
	},
};
const paragraphs = Array.from(
	{ length: 30 },
	(_, i) =>
		`Section ${i + 1}: Follow the operator's request, preserve context and explain the constraints. A long instruction paragraph wraps inside the available pane rather than clipping its last words.`,
);
const edited = [...paragraphs];
edited[4] =
	"Section 5: Follow the operator's request, preserve context and explain the trade-offs. A long instruction paragraph wraps inside the available pane rather than clipping its last words.";
edited[24] = "Section 25: Cite primary sources and report observable evidence.";
export const LongInstructions: Story = {
	args: { before: paragraphs.join("\n\n"), after: edited.join("\n\n") },
};
export const NoChange: Story = {
	args: { before: "Unchanged instructions.", after: "Unchanged instructions." },
};
export const AddOnly: Story = {
	args: {
		before: "",
		after: "# Marketing\n\nPrepare launch plans.\nUse primary sources.",
	},
};
export const DeleteOnly: Story = {
	args: { before: "Remove this instruction.\nAnd this line.", after: "" },
};
export const HugeText: Story = {
	args: {
		before: Array.from({ length: 1200 }, (_, i) => `before ${i}`).join("\n"),
		after: Array.from({ length: 1200 }, (_, i) => `after ${i}`).join("\n"),
		wordLevel: false,
	},
};
