/**
 * Evidence harness: the diff body over a REAL durable history page.
 *
 * See `diff-body-evidence.html` for why this exists. The short version: the
 * story in `tool-row.stories.tsx` renders a `TranscriptRecord` this repository
 * built, so it proves the component. This page starts one layer earlier — at
 * the bytes `/v1/desktop/sessions/{id}/history` serves — and runs them through
 * the SHIPPED `applyHistoryPage`, so a frame from here proves the wire payload
 * reaches pixels: the durable row's own encoding, the reducer's extraction of
 * `provider_payload.details.diff`, the identity gate, and the args-drop rule.
 *
 * The theme is published with the app's own `applyThemeToDocument`, not by
 * setting the attribute here: one of the things a frame must not be able to
 * fake is its own palette.
 */

import { CanonicalTranscript } from "@renderer/features/chat/canonical/canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
} from "@renderer/features/chat/canonical/transcript-reducer";
import { applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
/* The harness's own stylesheet entry: the app's CSS plus the explicit
   `@source` this root needs. See `diff-body-evidence.css`. */
import "./diff-body-evidence.css";

/** The height the frame is given before it can measure its own content. */
const PROBE_HEIGHT = 200;

/** The overflow marker this surface renders, for the driver's printout. */
const OVERFLOW_MARKER = /… \d+ more diff lines?/;

type Measured = {
	ready: boolean;
	rows: number;
	bodies: number;
	markers: string[];
	/** Every body's own box against its scroll region, for the wrap claim. */
	boxes: { scrollWidth: number; clientWidth: number }[];
	/** The first diff line painted, so a frame can be tied to its payload. */
	firstLine: string;
	height: number;
};

declare global {
	interface Window {
		__diffEvidence?: Measured;
	}
}

/** The frame: the transcript inside the app's usual padded scroll box. */
function Frame({ records }: { records: ReturnType<typeof applyHistoryPage> }) {
	const frameRef = useRef<HTMLDivElement>(null);
	/*
	 * Measured, then applied.
	 *
	 * The content height is not knowable before it renders — it depends on how
	 * many lines each real diff has and how they wrap — so the frame is mounted
	 * at a height far SHORTER than its content and its own `scrollHeight` is
	 * then the natural height. That is the same measurement the story's frame
	 * height came from; here it is taken at run time so the frame ends up
	 * exactly the size of the payload rather than of a guess, which is what
	 * keeps empty ground (and `check-evidence`'s uniformity ceiling) out of a
	 * frame whose whole job is to show lines of text.
	 */
	const [height, setHeight] = useState(PROBE_HEIGHT);
	/* Opening is a one-shot: the triggers are real toggles, so a second pass
	   would CLOSE the rows the first one opened. Publishing is one-shot for the
	   same reason — the numbers are read once the frame has stopped growing. */
	const opened = useRef(false);
	const published = useRef(false);

	/*
	 * Open the rows the way a reader does, then size the frame to what the OPEN
	 * rows measure.
	 *
	 * The diff body is behind the row's own disclosure and the shipped transcript
	 * takes no "start open" prop, so this clicks the real triggers — which is also
	 * what makes the frame evidence about the disclosure rather than about a
	 * story-only prop.
	 *
	 * The order is load-bearing and the first version got it wrong: measuring in
	 * the same pass as the click reads the COLLAPSED height, so the frame stayed
	 * the size of closed rows, the opened bodies overflowed it and the capture
	 * photographed a 1400px window onto ~2400px of content — three real diff
	 * bodies with the third cut off mid-line. A click's state update is committed
	 * by the next frame, so the measurement happens there, and the effect runs
	 * again on the height it just set until the frame and its content agree.
	 */
	/*
	 * Deliberately unkeyed: it re-runs on every parent render and stops at the
	 * fixed point where the frame and its content agree.
	 */
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		let settle = 0;
		const raf = requestAnimationFrame(() => {
			if (!opened.current) {
				opened.current = true;
				for (const trigger of frame.querySelectorAll<HTMLButtonElement>(
					'button[aria-expanded="false"]',
				)) {
					trigger.click();
				}
			}
			settle = requestAnimationFrame(() => {
				const natural = frame.scrollHeight;
				if (natural > height) {
					setHeight(natural);
					return;
				}
				if (published.current) return;
				published.current = true;
				/*
				 * Publish what the DOM actually contains, for the driver to print. A
				 * still cannot say how many rows it holds or what the overflow marker
				 * reads; those numbers are the measured half of the claim the frame
				 * only illustrates.
				 */
				const bodies = [...frame.querySelectorAll("div")].filter((el) =>
					String(el.className).includes("whitespace-pre-wrap"),
				);
				window.__diffEvidence = {
					ready: true,
					rows: frame.querySelectorAll("button[aria-expanded]").length,
					bodies: bodies.length,
					markers: bodies
						.map((body) => String(body.textContent).match(OVERFLOW_MARKER)?.[0])
						.filter((line): line is string => Boolean(line)),
					boxes: bodies.map((body) => ({
						scrollWidth: body.scrollWidth,
						clientWidth: body.clientWidth,
					})),
					firstLine: String(bodies[0]?.textContent ?? "").slice(0, 40),
					height: frame.scrollHeight,
				};
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			cancelAnimationFrame(settle);
		};
	});

	return (
		<div className="overflow-y-auto p-6" ref={frameRef} style={{ height }}>
			<CanonicalTranscript
				transcript={records}
				gate={null}
				waiting={false}
				loadingOlder={false}
				onLoadOlder={() => undefined}
				containerRef={frameRef}
				isSmallView={false}
				status="live"
				error={null}
			/>
		</div>
	);
}

function App() {
	const [page, setPage] = useState<{ entries: unknown[] } | null>(null);
	const params = new URLSearchParams(window.location.search);
	const theme = (params.get("theme") ?? "localOperatorDark") as ThemeName;

	useEffect(() => {
		applyThemeToDocument(theme);
		fetch("/__diff-payload")
			.then((response) => response.json())
			.then((payload) => setPage(payload))
			.catch(() => setPage({ entries: [] }));
	}, [theme]);

	if (!page) return null;
	// `replace`: an empty base, so the page IS the transcript rather than a
	// merge onto whatever a live session left behind.
	const transcript = applyHistoryPage(EMPTY_TRANSCRIPT, page as never, {
		replace: true,
	});
	return <Frame records={transcript} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
