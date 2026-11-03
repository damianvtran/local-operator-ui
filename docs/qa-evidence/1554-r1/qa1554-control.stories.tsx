/* QA rig for PR #1554 round 1 — uncommitted. CONTROL: origin/main's message list hands the
 * whole body to TeamBridgeMarkdown (see the PR diff); this renders exactly that, beside the
 * PR's TeamBridgeMessageList, for the same bodies. */
import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeMarkdown } from "../team-bridge-markdown";
import { TeamBridgeMessageList } from "../team-bridge-message-list";

const B64 = (n: number) => "Qk+/x9Zp".repeat(Math.ceil(n / 8)).slice(0, n);
const BODIES: Record<string, string> = {
	code: "In code:\n\n```html\n<img src=\"data:image/png;base64,iVBORw0KGgo=\">\n```\n\nand inline `data:image/gif;base64,R0lGOD==` too.",
	bigfence: `Fenced big:\n\n\`\`\`\ndata:image/png;base64,${B64(20000)}\n\`\`\`\n\nThe line after the fence.`,
};
function Harness({ which }: { which: string }) {
	const body = BODIES[which];
	return (
		<div className="flex gap-4 bg-surface p-4 text-ink">
			<div className="w-[560px]">
				<div className="mb-2 text-xs text-ink-muted">CONTROL — main's renderer (TeamBridgeMarkdown, whole body)</div>
				{which === "bigfence" ? <div className="text-xs">(skipped: 20 KB wall)</div> : (
					<TeamBridgeMarkdown className="team-bridge-message-body text-[14px]">{body}</TeamBridgeMarkdown>
				)}
			</div>
			<div className="w-[560px]">
				<div className="mb-2 text-xs text-ink-muted">PR head — TeamBridgeMessageList</div>
				<TeamBridgeMessageList
					messages={[{ id: which, conversation_id: "c", seq: 1, sender: { account_id: "a", kind: "human", display_label: "Case" }, body, origin: "human", created_at: "2026-11-02T10:00:00Z" }]}
					labelFor={(s) => s.display_label}
				/>
			</div>
		</div>
	);
}
const meta = { title: "QA1554/Control", component: Harness } satisfies Meta<typeof Harness>;
export default meta;
export const CodeFence: StoryObj<typeof meta> = { args: { which: "code" } };
export const BigInFence: StoryObj<typeof meta> = { args: { which: "bigfence" } };
