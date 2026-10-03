/**
 * The team mark the chat surfaces draw, at the size it ships.
 *
 * WHY THIS STORY EXISTS. The sidebar's session rows are the change's real
 * surface, but a 16px mark inside a 320px panel is not a frame a reviewer can
 * read letters off, and the mark's own contract - the initials a name draws, an
 * image URL replacing them, and a FAILED image falling back - is invisible in
 * any frame the row can produce (the row's fixture teams have no icon field to
 * fail with). So the bubble is photographed on its own, once per claim, at the
 * size and on the grounds the app really draws it on.
 *
 * WHAT A FRAME HERE DOES NOT SHOW, stated rather than implied:
 *
 *   - It is not the row. The bubble's placement, the width it returns to the
 *     title, the row's height, the tooltip's own panel and the flyout it has to
 *     share the pointer with are the sidebar set's
 *     (`chat-sidebar-sections.stories.tsx`) and the PR's measurements.
 *   - It is not the header. The chip's variant (bubble leading a label that is
 *     drawn in full) is `chat-header-identity.stories.tsx`'s.
 *   - A `:focus-visible` ring is not photographed: a hidden window has no focus,
 *     the same limit the sidebar set declares for its own frames.
 */
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { TeamAvatarBubble } from "./team-avatar-bubble";

/**
 * A picture that renders, so the frame can show the IMAGE state rather than
 * describe it. Copied from this repository's own fixture blob
 * (`canvas.stories.tsx`'s `inline-thumbnail`, and `image-expand.stories.tsx`
 * carries the same kind of constant): a `data:` URL is the one image source a
 * capture run can depend on, since a frame cannot fetch anything.
 */
const PICTURE =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAbElEQVR42u2VwQkAIRADU+dVYiVWdKVcISoI4rE+hJ1fIL+VmZeJvreEeUoNc/teKL2fhNIDQS79L0inbwKCvgQQfQo4+hCg9KMg8fcJpQeC9OYQSt8EUOsJpU8B2tjyHngPvAfeA++B96CnAe59EGprIux0AAAAAElFTkSuQmCC";

/**
 * A picture that FAILS, so the fallback is photographed rather than trusted. A
 * `data:` URL whose payload is not a decodable image reports an error to Radix
 * with no network involved, which is what keeps this frame reproducible
 * offline - a `https://` fixture would photograph the network's latency as the
 * mark's behaviour.
 */
const BROKEN = "data:image/png;base64,not-a-decodable-image";

/** The fixture names, one per shape the mark's rule has to answer. */
const MARKS = [
	{ name: "Local Operator Development", note: "two words, first and last" },
	{ name: "Radient Development", note: "two words" },
	{
		name: "Hyperplane Development",
		note: "the operator's list asked for HP; the rule draws HD",
	},
	{ name: "Data Quality", note: "two words" },
	{
		name: "Delphi Quality",
		note: "COLLIDES with Data Quality - the tooltip is what tells them apart",
	},
	{ name: "Content", note: "one word, first two letters" },
	{ name: "helpdesk", note: "one word, drawn from the slug (no label)" },
	{ name: "release-crew", note: "a slug's words are words" },
	{ name: "", note: "nothing to take - the deterministic placeholder" },
];

const Row: FC<{ name: string; note: string; imageUrl?: string | null }> = ({
	name,
	note,
	imageUrl,
}) => (
	<div className="flex items-center gap-2">
		<TeamAvatarBubble name={name} imageUrl={imageUrl} />
		<span className="w-56 shrink-0 font-mono text-meta-sm text-ink">
			{name === "" ? "(empty name)" : name}
		</span>
		<span className="text-meta-sm text-ink-muted">{note}</span>
	</div>
);

const Page: FC = () => (
	<div className="flex h-screen flex-col gap-6 overflow-hidden bg-canvas p-6 text-ink">
		<section className="space-y-2">
			<p className="text-title">Initials</p>
			{MARKS.map((mark) => (
				<Row key={mark.name || "empty"} name={mark.name} note={mark.note} />
			))}
		</section>
		<section className="space-y-2">
			<p className="text-title">An image URL replaces the mark (image-ready)</p>
			<Row
				name="Local Operator Development"
				note="the generated avatar renders inside the same bubble"
				imageUrl={PICTURE}
			/>
			<Row
				name="Radient Development"
				note="no URL yet - the initials, which is today's every case"
				imageUrl={null}
			/>
			<Row
				name="Data Quality"
				note="a URL that FAILS to load falls back to the initials"
				imageUrl={BROKEN}
			/>
		</section>
		<section className="max-w-[60ch] space-y-1 text-meta-sm text-ink-muted">
			<p>
				The mark is the shared Badge's own `attentionQuiet` / `pill` / `count`
				composition - the same face as the sidebar rail's notification count -
				so it is 16px tall (`h-4`) and its width follows the initials
				(`min-w-4`, `px-1`); the rail badge beside a team's count lines is the
				frame to compare it with. The image is Radix&rsquo;s `AvatarImage`, so a
				missing, blocked, 404ing or undecodable URL is the same state as no URL
				at all: the initials, on the same 16px face. No generation flow ships
				with this - the URL is a field a team record will carry.
			</p>
		</section>
	</div>
);

const meta = {
	title: "Chat/Team avatar bubble",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Every shape the initials rule has, plus the three image states. */
export const Marks: Story = {
	render: () => <Page />,
};
