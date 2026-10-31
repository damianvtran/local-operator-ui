import { visit } from "unist-util-visit";
import { type MessageMentionRun, splitMentions } from "./message-mentions";

/**
 * A remark plugin that turns `@label` runs in TEXT nodes into highlighted
 * spans. Text nodes only: a mention inside inline code, a code block or a link
 * stays as the author wrote it. The span is produced through `data.hName`, so
 * no raw HTML is involved and `TeamBridgeMarkdown`'s no-raw-HTML rule holds.
 */
type TextNode = { type: "text"; value: string };
type Parent = { children: unknown[] };

/*
 * Others' mentions are ACCENT TEXT (design D3): the wash measures 1.01-1.05:1
 * against the canvas and weight alone did not separate a name from prose;
 * accent text is 4.81:1 light / 7.54:1 dark there (4.85 / 7.18 on the wash).
 */
export const MENTION_CLASS =
	"team-bridge-mention rounded-sm px-0.5 font-medium bg-accent-wash text-accent";
/*
 * THE READER'S OWN MENTION is louder (Slack's yellow-ish token). `warning-wash`
 * is the theme's warm wash in both light and dark; the warning ink on it keeps
 * the name readable without a second colour scheme.
 */
export const VIEWER_MENTION_CLASS =
	"team-bridge-mention rounded-sm px-0.5 font-medium bg-warning-wash text-warning";

export function remarkTeamBridgeMentions(runs: readonly MessageMentionRun[]) {
	return () => (tree: unknown) => {
		visit(
			tree as Parameters<typeof visit>[0],
			"text",
			(
				node: TextNode,
				index: number | undefined,
				parent: Parent | undefined,
			) => {
				if (!parent || index === undefined || !node.value.includes("@")) return;
				const segments = splitMentions(node.value, runs);
				if (!segments.some((s) => s.kind === "mention")) return;
				parent.children.splice(
					index,
					1,
					...segments.map((segment) =>
						segment.kind === "text"
							? { type: "text", value: segment.text }
							: {
									type: "mention",
									data: {
										hName: "span",
										hProperties: {
											className: segment.viewer
												? VIEWER_MENTION_CLASS
												: MENTION_CLASS,
											"data-mention": segment.viewer ? "viewer" : "other",
										},
									},
									children: [{ type: "text", value: segment.text }],
								},
					),
				);
				return index + segments.length;
			},
		);
	};
}
