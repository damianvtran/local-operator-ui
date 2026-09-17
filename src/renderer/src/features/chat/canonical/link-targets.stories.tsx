import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo, useRef } from "react";
import { MessageInput } from "../components/message-input";
import type { Message } from "../types/message";
import "../components/story-electron-shim";
import { resetProbeCache } from "../utils/link-actions";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/*
 * The transcript's link affordances, on the production transcript and with the
 * production detection pipeline: a path the agent WROTE, rendered as a link you
 * can press, and the toolbar a hover - or a highlight inside the link - raises on
 * it.
 *
 * WHY A STORY AND NOT ONLY A LIVE RUN. The claims here are about what the
 * MARKDOWN PIPELINE does to a turn's text (which tokens become anchors, which
 * must not) and about what the toolbar offers for each kind of target. Both are
 * properties of the components rather than of one session's data: a live run
 * proves them too, but only on whatever transcript that run happened to open,
 * while this fixture holds the eight shapes at once, in every palette, from the
 * diff alone.
 *
 * WHAT A `play` FUNCTION CAN AND CANNOT DRIVE HERE. `play` cannot produce a real
 * pointer, so the HOVERED frames in `docs/evidence/` are the rig's own
 * (`scripts/capture-evidence.mjs`'s `hover` option over these same stories, with
 * CDP `Input.dispatchMouseEvent` - the dispatch that exercises the path under
 * test). What a `play` can build is a real `Selection` object through the DOM's
 * own API (`highlightLink`), which is what the shipped component reads back out
 * of `window.getSelection()`; the toolbar only offers Quote if the component
 * agrees the highlight is inside THAT link, so a frame from `SelectionInLink` is
 * still a statement about the rule.
 *
 * `probeFiles` IS STUBBED, BECAUSE THE MATRIX CANNOT BE PHOTOGRAPHED WITHOUT IT.
 * The toolbar's contents follow what the path IS: a file gets Open folder, a
 * directory does not, and a path that is not there gets the reason instead of a
 * dead press. Nothing in Storybook can stat, so the stub below answers for the
 * fixture's own paths - and `resetProbeCache` is what stops a story inheriting an
 * answer a previous one cached for the same spelling.
 */

/**
 * The paths this story knows about, so the stub can answer for them.
 *
 * Spelled once and referenced by the fixtures below, because the stub and the
 * turn text disagreeing is a frame that photographs the wrong state while looking
 * perfectly normal.
 */
const REPORT =
	"~/workspace/opoint-renewal-2026-09-17/opoint_adverse_media_query_failures_2026-09-17.xlsx";
const LOG = "~/workspace/opoint-renewal-2026-09-17/run.log";
const SHOTS = "/Users/someone/Downloads/Screenshot 2026-09-17 at 10.14.02.png";
const PROJECT = "~/workspace/opoint-renewal-2026-09-17";
const GONE = "/tmp/lo-link-missing/report-2026-09-17.pdf";
const PAGE = "https://example.com/reports/adverse-media-2026-09";

const FILE_URL = `file://${SHOTS.replace(/ /g, "%20")}`;

const MISSING_MARKER = "/tmp/lo-link-missing/";

/*
 * Installed at module scope rather than in a `play`, for the reason the composer's
 * electron shim is a module: the toolbar asks on REVEAL, which happens in a later
 * commit than the render, and a stub installed by a frame component would arrive
 * after the story had already painted its optimistic matrix.
 */
resetProbeCache();
if (typeof window !== "undefined") {
	window.api = {
		...(window.api ?? {}),
		probeFiles: async (paths: string[]) =>
			paths.map((input) => ({
				input,
				resolved: input,
				exists: !input.startsWith(MISSING_MARKER),
				isFile: input !== PROJECT,
				sizeBytes: 37_000,
				mtimeMs: 1_760_000_000_000,
			})),
	} as typeof window.api;
}

const record = (
	id: string,
	kind: "user" | "assistant",
	text: string,
): TranscriptRecord =>
	kind === "user"
		? { kind, id, ts: 1_760_000_000_000, text, images: [] }
		: {
				kind,
				id,
				ts: 1_760_000_000_001,
				text,
				streaming: false,
				stopReason: null,
				error: false,
				complete: true,
			};

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	} as TranscriptState;
}

/**
 * The motivating turn, and seven more shapes beside it.
 *
 * Each paragraph is one case, and every one of them is a string this app's own
 * transcripts contain:
 *
 * 1. the operator's report, verbatim in shape - a bare `~` path with a size and a
 *    sheet count after it, which was dead text;
 * 2. the same path in backticks, which is how an agent usually quotes one;
 * 3. a `file://` URL, which the canvas hands to the OS and the transcript
 *    therefore contains;
 * 4. a bare https URL, which remark-gfm already links - the case that must NOT be
 *    linked twice;
 * 5. a path inside a table cell, where the mdast is a different node shape;
 * 6. a directory, so the toolbar's own directory rule is on screen;
 * 7. a path that does not exist, so the "no file" state is on screen;
 * 8. a path long enough to wrap, which is the case that puts the tooltip below the
 *    link rather than over the text beside it.
 */
const ANSWER = [
	`Saved it to ${REPORT} (37 KB, 8 sheets).`,
	"",
	`The run log is \`${LOG}\`, and the screenshot is at ${FILE_URL}.`,
	"",
	`The upstream page is ${PAGE} - see it for the totals.`,
	"",
	"| artifact | path |",
	"| --- | --- |",
	`| report | ${PROJECT}/summary.pdf |`,
	"",
	`Two more things: ${GONE} is gone, and ${PROJECT} is the folder everything landed in.`,
	"",
	"And a long one for the wrap: ~/workspace/opoint-renewal-2026-09-17/exports/2026-09-17/adverse-media-review-full-corpus-with-annotations.xlsx",
].join("\n");

const CONVERSATION: TranscriptRecord[] = [
	record(
		"u1",
		"user",
		"Where did the adverse-media run put everything? Save the paths.",
	),
	record("a1", "assistant", ANSWER),
];

/** The pane's own sentinel, as `chat-content.tsx` hands it one. */
const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

const conversationId = "story";

/**
 * Clear the staged chips before every story.
 *
 * The conversation input store is `persist`ed, so a story that left a chip behind
 * would hand the next one a composer with a quote already in it, and the frame
 * would show a state the story did not produce.
 */
function useCleanReplies() {
	useEffect(() => {
		useConversationInputStore.getState().clearReplies(conversationId);
	}, []);
}

/**
 * The transcript, and optionally the production composer under it.
 *
 * The pane's own height is what the control is clamped inside, so the harness
 * box is the pane's - the reason `quote.stories.tsx` gives for the same shape.
 * The composer's own `ReplyPreview` is where a staged quote paints, and it is in
 * this frame only for the story that presses Quote: a story that showed a chip in
 * a composer would be claiming a wiring (`conversationId`) that only `ChatContent`
 * holds.
 */
const Frame = ({
	height = 720,
	width = 1024,
	composer = false,
}: {
	height?: number;
	width?: number;
	composer?: boolean;
}) => {
	useCleanReplies();
	const containerRef = useRef<HTMLDivElement>(null);
	const transcript = useMemo(() => transcriptOf(CONVERSATION), []);
	return (
		<div className="flex flex-col bg-canvas" style={{ width, height }}>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={transcript}
					frontend={null}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					/*
					 * The same identity the composer below reads its replies by. The two are one
					 * value in the app (`chat-content.tsx` hands both of them its local
					 * `conversationId` const), and a story that gave them different ones would
					 * photograph a Quote press that goes nowhere.
					 */
					conversationId={conversationId}
					onReconnect={() => {}}
				/>
			</div>
			{composer && (
				<div className="shrink-0 p-4 pt-0">
					<MessageInput
						isLoading={false}
						messages={NONEMPTY}
						conversationId={conversationId}
						onSendMessage={async () => true}
					/>
				</div>
			)}
		</div>
	);
};

const rowOf = (rowId: string) =>
	document.querySelector(`[data-record-id="${rowId}"]`);

/** The file link whose target ends with this text. */
const linkFor = (rowId: string, endsWith: string): HTMLAnchorElement => {
	const links = rowOf(rowId)?.querySelectorAll<HTMLAnchorElement>(
		'a[data-lo-kind="file"]',
	);
	for (const link of links ?? []) {
		if ((link.getAttribute("data-lo-target") ?? "").endsWith(endsWith)) {
			return link;
		}
	}
	throw new Error(`no link ending in ${endsWith} on row ${rowId}`);
};

/**
 * Highlight the whole of one link, through the DOM's own `Selection` API.
 *
 * A real selection object read back by the shipped component, so the press that
 * follows only exists if the component agrees the highlight lies inside THAT
 * link - which is the rule this story exists to photograph.
 */
async function highlightLink(link: HTMLAnchorElement) {
	const range = document.createRange();
	range.selectNodeContents(link);
	const selection = window.getSelection();
	if (!selection) throw new Error("no Selection API in this browser");
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
	await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

const meta: Meta = {
	title: "Chat/Canonical links",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The eight shapes at rest, which is also the case the operator reported from the
 * other side: before this change every path here was dead text, and the frame
 * that shows them plain is the "before" half of that comparison.
 */
export const DetectedTargets: Story = {
	render: () => <Frame />,
};

/**
 * The same shapes in the narrow column, where a long path WRAPS.
 *
 * The width is the point rather than a second look at the same thing: a path that
 * wraps puts the link on two lines, and where the toolbar lands for one is what
 * the placement is asked about (`quote-anchor.ts`'s first-line rule, reused for a
 * link's own boxes).
 */
export const DetectedTargetsNarrow: Story = {
	render: () => <Frame width={420} height={900} />,
};

/**
 * A highlight inside a link, which is the operator's second ask: the Quote
 * button appears IN the link's own toolbar, ahead of Copy, rather than as a
 * second strip floating over the same highlight.
 */
export const SelectionInLink: Story = {
	render: () => <Frame />,
	play: async () => {
		await highlightLink(linkFor("a1", "run.log"));
	},
};

/**
 * The same highlight, and then a press of the toolbar's OWN Quote.
 *
 * The press is driven through the button rather than through the store, so the
 * frame proves the toolbar reaches the composer the way a reader does - and the
 * link's text is what the staged chip carries.
 */
export const SelectionInLinkStaged: Story = {
	render: () => <Frame composer height={820} />,
	play: async () => {
		const link = linkFor("a1", "run.log");
		await highlightLink(link);
		const quote = link
			.closest("[data-lo-canonical-transcript]")
			?.querySelector<HTMLButtonElement>(
				'[data-lo-link-toolbar] button[aria-label="Quote"]',
			);
		if (!quote) throw new Error("no Quote button on the link toolbar");
		quote.click();
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
	},
};
