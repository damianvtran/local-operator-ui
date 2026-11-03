/* QA rig for PR #1554 round 1 — uncommitted, lives only in a throwaway worktree. */
import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeMessageList } from "../team-bridge-message-list";
import { MentionSourceContext } from "../mentions/mention-context";

const B64 = (n: number) => "Qk+/x9Zp".repeat(Math.ceil(n / 8)).slice(0, n);
const B64URL = (n: number) => "Qk-_x9Zp".repeat(Math.ceil(n / 8)).slice(0, n);
const wrap = (s: string, w: number) => s.match(new RegExp(`.{1,${w}}`, "g"))!.join("\n");
const msg = (id: string, seq: number, body: string, extra: object = {}) => ({
	id, conversation_id: "bcv_qa", seq,
	sender: { account_id: `acct_${seq}`, kind: "human" as const, display_label: `Case ${id}` },
	body, origin: "human" as const, created_at: `2026-11-02T10:${String(seq).padStart(2, "0")}:00Z`, ...extra,
});
const VARIANTS = [
	msg("svg", 1, `SVG base64: data:image/svg+xml;base64,${B64(20000)} end.`),
	msg("upper", 2, `Uppercase: DATA:IMAGE/PNG;BASE64,${B64(20000)} end.`),
	msg("wrapped76", 3, `Wrapped 76 cols:\ndata:image/png;base64,${wrap(B64(8000), 76)}\nAfter the wrapped payload.`),
	msg("wrappedsmall", 4, `Wrapped small 76 cols:\ndata:image/png;base64,${wrap(B64(1500), 76)}\nAfter the small wrapped payload.`),
	msg("short", 5, "Short legit URI: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg== is a 1x1 pixel."),
	msg("tail", 6, `Tail: data:image/jpeg;base64,${B64(20000)}AB==!!!then a non-base64 tail, still prose.`),
	msg("code", 7, "In code:\n\n```html\n<img src=\"data:image/png;base64,iVBORw0KGgo=\">\n```\n\nand inline `data:image/gif;base64,R0lGOD==` too."),
	msg("b64url", 8, `Base64url: data:image/png;base64,${B64URL(20000)} end.`),
	msg("plain", 9, "Ordinary prose, no data at all, **bold** and a [link](https://example.com)."),
];
function Harness({ only }: { only?: string[] }) {
	const rows = only ? VARIANTS.filter((m) => only.includes(m.id)) : VARIANTS;
	return (
		<div className="w-[900px] bg-surface p-4 text-ink">
			<TeamBridgeMessageList messages={rows} labelFor={(s) => s.display_label} />
		</div>
	);
}
const meta = { title: "QA1554/Variants", component: Harness } satisfies Meta<typeof Harness>;
export default meta;
export const All: StoryObj<typeof meta> = {};
export const SvgUpperShort: StoryObj<typeof meta> = { args: { only: ["svg", "upper", "short", "tail"] } };
export const Wrapped: StoryObj<typeof meta> = { args: { only: ["wrapped76", "wrappedsmall"] } };
export const CodeAndUrl: StoryObj<typeof meta> = { args: { only: ["code", "b64url", "plain"] } };
