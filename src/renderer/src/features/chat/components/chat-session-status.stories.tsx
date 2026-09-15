import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatSessionStatus } from "./chat-session-status";

/** Read/unread specimens, not a receipt transition. The receipt flow is the
 * isolated browser fixture; this matrix keeps every neighbouring status legible
 * under all twelve Storybook themes without inventing a second glyph renderer.
 */
const meta = {
	title: "Chat/Session status",
	component: ChatSessionStatus,
} satisfies Meta<typeof ChatSessionStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Neighbours: Story = {
	args: { row: { session_id: "specimen" } },
	render: () => (
		<div className="bg-surface text-ink p-6 grid grid-cols-2 gap-4">
			{[true, false].flatMap((unseen) =>
				[
					"complete",
					"error",
					"busy",
					"answer",
					"approval",
					"wedged",
					"interrupted",
					"scheduled",
					"attached",
					"idle",
					"dormant",
					"unknown",
				].map((code) => {
					const row = {
						session_id: "specimen",
						status: { code, label: code },
						attention: { unseen },
					} as CanonicalSessionRow;
					return (
						<div className="flex items-center gap-2" key={`${code}-${unseen}`}>
							<ChatSessionStatus row={row} />
							<span>
								{code} — {unseen ? "unread" : "read"}
							</span>
						</div>
					);
				}),
			)}
		</div>
	),
};
