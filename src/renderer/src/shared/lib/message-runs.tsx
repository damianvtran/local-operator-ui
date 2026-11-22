/**
 * A catalogue message as prose plus its code spans: backticks become `<code>`.
 *
 * WHY IT EXISTS. `ui.chat.device.sentence.pairing_guidance` names two terminal
 * commands, and its own context note asks for them verbatim inside backticks
 * (`src/i18n/catalogues/en/ui.chat.device.context.json`). All seven catalogues
 * carry the markers, so drawing `{guidance}` into a plain `<p>` printed the
 * markers themselves - the picker's only instruction for a device in no network
 * read as punctuation instead of as commands. `docs/branding.md` owns the rule
 * that decides the treatment: "Monospace is machine voice", so a command is a
 * mono run, and a mono run in the middle of a sentence is a `<code>` element.
 *
 * IT IS NOT A MARKDOWN RENDERER, deliberately. This is one catalogue sentence
 * with two pairs of markers; pulling the chat's markdown pipeline in would let a
 * catalogue value emit arbitrary markup, which is the class of bug
 * `ledger-check` and the string scanner exist to keep out of the catalogues.
 *
 * `dir="ltr"` IS LOAD-BEARING IN `ur`. The commands are Latin and have to stay
 * readable inside an RTL paragraph; the explicit direction is also what keeps a
 * trailing neutral in the run from being resolved to the paragraph's direction,
 * the bidi class this repo already fixes with an isolate elsewhere.
 *
 * AN UNCLOSED MARKER IS TEXT. `split` on one delimiter yields an even number of
 * pieces only when the marker count is odd - one span opened and never closed -
 * and that renders the message exactly as written rather than crashing or
 * drawing half a span. A render path does not throw on a catalogue defect
 * (`t()` does not either); the catalogue checks own that failure.
 *
 * TWO CALLERS, ONE TREATMENT: the pairing paragraph
 * (`chat/device/chat-header-device.tsx`) and the Radient row's remedy line
 * (`remote-compute/remote-compute-picker.tsx`), which printed the same markers
 * as grave accents until design round 2's D6. Both import this function rather
 * than splitting on backticks of their own; a second splitter beside this one is
 * the defect that finding was about.
 *
 * IT LIVES IN `shared/lib` RATHER THAN BEHIND THE HEADER (agent review round 3,
 * MINOR-2). It is five lines of string splitting with no component dependency,
 * and it sat in the header - which imports the peer-move flow, the device store
 * and the whole UI kit - so the picker's module graph carried all of that to
 * reach it. A pure helper behind a component module is how a genuine cycle gets
 * invited the next time the header wants a row helper.
 */
import type { ReactNode } from "react";

export const messageRuns = (text: string): ReactNode[] => {
	const parts = text.split("`");
	if (parts.length % 2 === 0) return [text];
	return parts.map((part, index) =>
		index % 2 === 1 ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: a run's position in its own sentence is its identity; runs are derived per render from one string and never reordered in place.
			<code key={index} dir="ltr" className="font-mono text-ink">
				{part}
			</code>
		) : (
			part
		),
	);
};
