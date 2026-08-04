import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
// The tokens the component reads (--duration-slow, --ease-out-quart, the
// --lo-* colours). The app entry imports this stylesheet; Storybook stories
// do not, so stories rendering real components bring it in themselves.
import "../../../styles/index.css";
import { MarkdownRenderer, StreamingMarkdown } from "./markdown-renderer";

/**
 * Streaming performance harness — not a demo, a measuring instrument.
 *
 * The renderer's websocket protocol sends the entire accumulated message on
 * every frame, so "stream at N chars per chunk" means slicing a fixture
 * document to ever-longer prefixes and handing each one to the component —
 * exactly what the live socket does to it.
 *
 * Two renderers are on the bench:
 *
 * - **Naive**: the whole document re-parsed on every chunk. This is what
 *   showing streaming text costs if you just mount `MarkdownRenderer` — and
 *   the reason the old UI showed a one-line pill instead.
 * - **Block-split**: `StreamingMarkdown`, which parses each block once and
 *   renders the in-flight block as plain text.
 *
 * Each chunk is committed with `flushSync` so the parse and reconciliation
 * land inside the measured window instead of a later idle frame. The numbers
 * printed are main-thread milliseconds per chunk, bucketed by document size,
 * plus how many chunks blew the 16.7ms frame budget.
 */

type ChunkSample = { size: number; ms: number };

const FRAME_BUDGET_MS = 16.7;
const BUCKETS = [2_000, 6_000, 12_000, 25_000] as const;
/** Half a bucket of slack: a sample counts toward the nearest bucket it reaches. */
const BUCKET_SNAP_MS = 1_000;

/**
 * Deterministic pseudo-random generator (mulberry32) so every run of the story
 * replays the identical fixture — runs are comparable across reloads.
 */
const mulberry32 = (seed: number) => {
	let state = seed;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const WORDS = [
	"operator",
	"workspace",
	"invoice",
	"ledger",
	"parser",
	"stream",
	"receipt",
	"column",
	"folder",
	"window",
	"render",
	"account",
	"markdown",
	"channel",
	"balance",
	"summary",
	"review",
	"engine",
];

const sentence = (random: () => number, words: number): string => {
	const picked: string[] = [];
	for (let i = 0; i < words; i += 1) {
		picked.push(WORDS[Math.floor(random() * WORDS.length)]);
	}
	return `${picked.join(" ")}.`;
};

const paragraph = (random: () => number, sentences: number): string => {
	const parts: string[] = [];
	for (let i = 0; i < sentences; i += 1) {
		parts.push(sentence(random, 8 + Math.floor(random() * 10)));
	}
	return parts.join(" ");
};

const codeBlock = (random: () => number): string => {
	const lines = ["```python", "def reconcile(records):"];
	for (let i = 0; i < 6; i += 1) {
		lines.push(`    # ${sentence(random, 6)}`);
		lines.push(`    total += records[${Math.floor(random() * 100)}].amount`);
	}
	lines.push("    return total", "```");
	return lines.join("\n");
};

const table = (random: () => number): string => {
	const rows = ["| Month | Invoices | Total |", "|---|---|---|"];
	for (let i = 0; i < 4; i += 1) {
		rows.push(
			`| M${i + 1} | ${Math.floor(random() * 400)} | ${(random() * 9000).toFixed(2)} |`,
		);
	}
	return rows.join("\n");
};

const list = (random: () => number): string => {
	const items: string[] = [];
	for (let i = 0; i < 4; i += 1) {
		items.push(`- ${sentence(random, 9)}`);
	}
	return items.join("\n");
};

/**
 * A fixture that looks like an agent answer: prose, lists, fenced code and
 * tables, roughly 26,000 characters of it.
 */
const buildFixture = (): string => {
	const random = mulberry32(42);
	const blocks: string[] = [];
	let size = 0;
	let index = 0;
	while (size < 26_500) {
		index += 1;
		const kind = index % 5;
		const block =
			kind === 1
				? `## Section ${index}\n\n${paragraph(random, 4)}`
				: kind === 2
					? codeBlock(random)
					: kind === 3
						? table(random)
						: kind === 4
							? list(random)
							: paragraph(random, 5);
		blocks.push(block);
		size += block.length + 2;
	}
	return blocks.join("\n\n");
};

const bucketFor = (size: number): number | null => {
	let best: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const bucket of BUCKETS) {
		const distance = Math.abs(size - bucket);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = bucket;
		}
	}
	return bestDistance <= BUCKET_SNAP_MS ? best : null;
};

const mean = (values: number[]): number =>
	values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

type HarnessProps = {
	/** Characters revealed per chunk. */
	charsPerChunk?: number;
	/** Which renderer sits on the bench. */
	mode?: "naive" | "block-split";
	/**
	 * Stop the replay early. The naive renderer at full length replays for
	 * several minutes — that fact is itself the measurement, but a truncated
	 * run gets the same per-chunk numbers without holding the tab hostage.
	 */
	stopAt?: number;
	/**
	 * Also measure the cost of a single render at exactly this many characters.
	 * For the naive renderer that one render is what every chunk at that
	 * accumulated size costs, so it stands in for the 25k bucket the truncated
	 * replay never reaches.
	 */
	pointAt?: number;
};

const StreamingPerfHarness = ({
	charsPerChunk = 20,
	mode = "block-split",
	stopAt,
	pointAt,
}: HarnessProps) => {
	const fixture = useMemo(buildFixture, []);
	const [text, setText] = useState("");
	const [samples, setSamples] = useState<ChunkSample[]>([]);
	const [pointSample, setPointSample] = useState<ChunkSample | null>(null);
	const [running, setRunning] = useState(false);
	const runningRef = useRef(false);

	const end = Math.min(stopAt ?? fixture.length, fixture.length);

	const run = () => {
		if (runningRef.current) return;
		runningRef.current = true;
		setRunning(true);
		setText("");
		setSamples([]);
		setPointSample(null);

		let position = 0;
		const collected: ChunkSample[] = [];

		const finish = () => {
			setSamples([...collected]);

			if (pointAt) {
				// Fresh mount, one cold render — the same work a chunk of that
				// accumulated size forces the naive renderer through.
				setText("");
				const target = fixture.slice(0, pointAt);
				window.setTimeout(() => {
					const start = performance.now();
					flushSync(() => setText(target));
					setPointSample({
						size: target.length,
						ms: performance.now() - start,
					});
					runningRef.current = false;
					setRunning(false);
				}, 0);
				return;
			}

			runningRef.current = false;
			setRunning(false);
		};

		const step = () => {
			position = Math.min(end, position + charsPerChunk);
			const next = fixture.slice(0, position);

			const start = performance.now();
			flushSync(() => setText(next));
			const elapsed = performance.now() - start;
			collected.push({ size: next.length, ms: elapsed });

			if (position < end && runningRef.current) {
				// setTimeout rather than requestAnimationFrame: rAF stops firing in
				// a background tab, and the bench must keep running when the browser
				// is not in focus.
				window.setTimeout(step, 0);
			} else {
				finish();
			}
		};

		window.setTimeout(step, 0);
	};

	const overBudget = samples.filter((s) => s.ms > FRAME_BUDGET_MS).length;
	const totalMs = samples.reduce((a, s) => a + s.ms, 0);
	const to12k = samples.filter((s) => s.size <= 12_000);
	const totalTo12k = to12k.reduce((a, s) => a + s.ms, 0);

	return (
		<div className="p-4">
			<div className="mb-4 flex items-center gap-3 text-body-sm">
				<button
					type="button"
					onClick={run}
					disabled={running}
					className="rounded-sm bg-accent px-3 py-1.5 text-on-accent disabled:opacity-60"
				>
					{running ? "Replaying..." : `Replay ${mode} stream`}
				</button>
				<span className="text-ink-muted">
					{charsPerChunk} chars/chunk, fixture {fixture.length} chars
				</span>
			</div>

			{samples.length > 0 && (
				<table className="mb-4 border-collapse text-body-sm">
					<thead>
						<tr>
							<th className="border border-hairline px-3 py-1 text-left">
								Accumulated
							</th>
							<th className="border border-hairline px-3 py-1 text-left">
								Mean ms/chunk
							</th>
							<th className="border border-hairline px-3 py-1 text-left">
								Worst ms
							</th>
						</tr>
					</thead>
					<tbody>
						{BUCKETS.map((bucket) => {
							const bucketSamples = samples.filter(
								(s) => bucketFor(s.size) === bucket,
							);
							if (bucketSamples.length === 0) return null;
							return (
								<tr key={bucket}>
									<td className="border border-hairline px-3 py-1">
										{(bucket / 1000).toFixed(0)}k chars
									</td>
									<td className="border border-hairline px-3 py-1">
										{mean(bucketSamples.map((s) => s.ms)).toFixed(2)}
									</td>
									<td className="border border-hairline px-3 py-1">
										{Math.max(...bucketSamples.map((s) => s.ms)).toFixed(2)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}

			{samples.length > 0 && (
				<div className="mb-4 text-body-sm">
					<p>Total main-thread time: {totalMs.toFixed(1)} ms</p>
					<p>Main-thread time to 12k chars: {totalTo12k.toFixed(1)} ms</p>
					<p>
						Chunks over the {FRAME_BUDGET_MS}ms frame budget: {overBudget} of{" "}
						{samples.length}
					</p>
					{pointSample && (
						<p>
							Single cold render at {(pointSample.size / 1000).toFixed(1)}k
							chars: {pointSample.ms.toFixed(2)} ms
						</p>
					)}
				</div>
			)}

			<div className="max-w-[720px] rounded-md border border-hairline bg-surface p-4">
				{mode === "naive" ? (
					<MarkdownRenderer content={text} />
				) : (
					<StreamingMarkdown content={text} />
				)}
			</div>
		</div>
	);
};

const meta: Meta<typeof StreamingPerfHarness> = {
	title: "Chat/Streaming performance",
	component: StreamingPerfHarness,
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof StreamingPerfHarness>;

/**
 * The reason the old UI hid the stream: the whole document re-parses per chunk.
 * Truncated at 13k — the full replay takes minutes, which is the point — with
 * a point measurement standing in for the 25k bucket.
 */
export const NaiveFullDocument: Story = {
	args: { mode: "naive", charsPerChunk: 20, stopAt: 13_000, pointAt: 25_000 },
};

/** The shipped path: per-chunk cost is bounded by the tail, not the document. */
export const BlockSplit: Story = {
	args: { mode: "block-split", charsPerChunk: 20 },
};

/** A faster stream, closer to what a quick model actually delivers. */
export const BlockSplitFast: Story = {
	args: { mode: "block-split", charsPerChunk: 80 },
};
