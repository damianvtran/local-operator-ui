import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useRef, useState } from "react";
import { caretRect } from "./caret-coordinates";
import { MentionSourceContext } from "./mention-context";
import { MentionHighlightOverlay } from "./mention-highlight-overlay";
import type { MentionToken } from "./tokens";

const text =
	"Ask @Sherman Tsui and @My agent to review this draft.\nThen ask @Viewer and @Aida (Ben Tran) without notifying.";
const tokens: MentionToken[] = [
	{ label: "Viewer", kind: "human", accountId: "acct_me", notify: true },
	{
		label: "Sherman Tsui",
		kind: "human",
		accountId: "acct_sherman",
		notify: true,
	},
	{ label: "My agent", kind: "agent", accountId: "acct_me", notify: true },
	{
		label: "Aida (Ben Tran)",
		kind: "agent",
		accountId: "acct_ben",
		notify: false,
	},
]
	.map((token) => ({
		...token,
		start: text.indexOf(`@${token.label}`),
		end: text.indexOf(`@${token.label}`) + token.label.length + 1,
	}))
	.sort((a, b) => a.start - b.start) as MentionToken[];

function Harness() {
	const field = useRef<HTMLTextAreaElement>(null);
	const [highlight, setHighlight] = useState(false);
	return (
		<MentionSourceContext.Provider
			value={{
				conversationId: "bcv_story",
				conversationKind: "group",
				candidates: [],
				sendMentions: true,
				self: { accountId: "acct_me", label: "Viewer" },
			}}
		>
			<div className="w-[320px] space-y-3 bg-canvas p-4 text-ink">
				<button
					type="button"
					onClick={() => setHighlight((current) => !current)}
				>
					Toggle highlights
				</button>
				<div className="group/mention-field relative rounded-md bg-elevated focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2">
					<MentionHighlightOverlay
						fieldRef={field}
						text={text}
						tokens={highlight ? tokens : []}
					/>
					<textarea
						aria-label="Mention alignment draft"
						ref={field}
						value={text}
						readOnly
						className="relative block h-40 w-full resize-none border-0 bg-transparent p-3 text-sm leading-6 text-ink outline-none"
					/>
				</div>
				<output data-alignment-proof="" className="block text-xs" />
			</div>
		</MentionSourceContext.Provider>
	);
}

/**
 * Capture normal/hover/focus by leaving the pointer outside/over the field and
 * tabbing into the native textarea. The same text is measured before and after
 * highlighting; Range boxes check the mirror's actual browser glyph layout,
 * not jsdom's zero rectangles. Numeric output stays visible for capture/QA.
 */
const meta = {
	title: "Team Bridge/Mention highlight",
	component: Harness,
	parameters: { layout: "centered" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const field = canvas.getByRole("textbox") as HTMLTextAreaElement;
		const before = tokens.map((token) => caretRect(field, token.start));
		await userEvent.click(canvas.getByRole("button"));
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		const after = tokens.map((token) => caretRect(field, token.start));
		const spans = canvasElement.querySelectorAll("[data-mention-pill]");
		const readings = tokens.map((token, index) => {
			const span = spans[index];
			const range = field.ownerDocument.createRange();
			range.setStart(span.firstChild as Node, 0);
			range.setEnd(span.firstChild as Node, 1);
			const glyph = range.getBoundingClientRect();
			const delta = after[index].left - before[index].left;
			// caretRect rounds its native mirror's offsetLeft to whole pixels.
			const overlayDelta = glyph.left - after[index].left;
			expect(delta).toBe(0);
			expect(Math.abs(overlayDelta)).toBeLessThanOrEqual(1);
			// Check every glyph, including wrapped fragments, not only each @.
			for (let offset = 0; offset < token.end - token.start; offset++) {
				range.setStart(span.firstChild as Node, offset);
				range.setEnd(span.firstChild as Node, offset + 1);
				const character = range.getBoundingClientRect();
				const caret = caretRect(field, token.start + offset);
				expect(Math.abs(character.left - caret.left)).toBeLessThanOrEqual(1);
				expect(Math.abs(character.top - caret.top)).toBeLessThanOrEqual(1);
			}
			return `${token.label}: caret ${before[index].left} → ${after[index].left}; overlay Δx ${overlayDelta.toFixed(3)}px`;
		});
		const output = canvasElement.querySelector("output");
		if (output) output.textContent = readings.join("; ");
		await userEvent.unhover(field);
	},
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = {
	args: { theme: "localOperatorLight" } as Story["args"],
};
export const Dark: Story = {
	args: { theme: "localOperatorDark" } as Story["args"],
};
export const HoverLight: Story = {
	...Light,
	play: async (context) => {
		await meta.play(context);
		await userEvent.hover(within(context.canvasElement).getByRole("textbox"));
	},
};
export const HoverDark: Story = { ...Dark, play: HoverLight.play };
export const FocusLight: Story = {
	...Light,
	play: async (context) => {
		await meta.play(context);
		within(context.canvasElement).getByRole("textbox").focus();
	},
};
export const FocusDark: Story = { ...Dark, play: FocusLight.play };
