import type { Meta, StoryObj } from "@storybook/react";
import { usePostHog } from "posthog-js/react";
import { Profiler, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;
const assistant = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});
const tool = (id: string): TranscriptRecord => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "read",
	intent: "Reading the fixture",
	args: { path: `fixture-${id}.md` },
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	durationS: 0.1,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});
const longRecords = (): TranscriptRecord[] =>
	Array.from({ length: 200 }, (_, index) =>
		index % 2 === 0
			? {
					kind: "user",
					id: `smooth-u-${index}`,
					ts: TS + index,
					text: `Checkpoint ${index}: keep this ordered transcript stable while reading.`,
					images: [],
				}
			: assistant(
					`smooth-a-${index}`,
					`Answer ${index}. This is a deterministic plain-text transcript entry. The reader may stay in older history while new output arrives at the tail. No media, code editor or hidden tool-body state is represented by this fixture.`,
				),
	);
const mixedRecords = (): TranscriptRecord[] =>
	Array.from({ length: 40 }, (_, index) => [
		{
			id: `mixed-u-${index}`,
			ts: TS + index * 5,
			kind: "user" as const,
			text: `Review the implementation of synthetic module ${index}.`,
			images:
				index === 37
					? [
							{
								id: "mixed-artifact:0",
								data: "iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAIAAABdtOgoAAAAqUlEQVR4nO3TMREAIBDEwAdxeMEVUpGxTdbAFZlb576Js+F2CuD1AKwAWAGwAmAFwAqAFQArAFYArABYAbACYAXACoAVACsAVgCsAFgBsAJgBcAKgBUAKwBWAKwAWAGwAmAFwAqAFQArAFYArABYAbACYAXACoAVACsAVgCsAFgBsAJgBcAKgBUAKwBWAKwAWAGwAmAFwAqAFQArAFYArABYAbACYAUY6wNp0gHPxbZcbgAAAABJRU5ErkJggg==",
								attachment: null,
								mimeType: "image/png",
								width: 128,
								height: 64,
								name: "synthetic-artifact.png",
							},
						]
					: [],
		},
		...Array.from({ length: 3 }, (_, action) => ({
			...tool(`mixed-t-${index}-${action}`),
			ts: TS + index * 5 + action + 1,
		})),
		{
			...assistant(
				`mixed-a-${index}`,
				index === 31
					? "The mixed fixture includes a real fenced-code renderer.\n\n```ts\nconst result = await readFixture();\nconsole.log(result);\n```"
					: index === 39
						? "The live mixed tail continues streaming without unmounting the media or fenced-code islands."
						: `Module ${index} is complete. The three settled reads stay folded.`,
			),
			ts: TS + index * 5 + 4,
			complete: index !== 39,
			streaming: index === 39,
		},
	]).flat();

const stateOf = (records: TranscriptRecord[]): TranscriptState => ({
	records,
	index: new Map(records.map((record, index) => [record.id, index])),
	generation: 1,
	compacting: false,
	compactingSince: 0,
	viewEpoch: 0,
	oldestId: null,
	oldestTs: 0,
	hasMore: false,
	argsByCall: new Map(),
});

/**
 * Controls operate on the shipped transcript, not a facsimile. Numeric output
 * is part of the story so the authorized browser can read geometry without
 * injecting a second browser stack. Synthetic wheel attribution is named here;
 * it is not evidence of hardware momentum, touch or scrollbar-drag behaviour.
 */
function Frame({
	formation = false,
	mixed = false,
	longFormation = false,
	durable = false,
}: {
	formation?: boolean;
	mixed?: boolean;
	longFormation?: boolean;
	durable?: boolean;
}) {
	const analytics = usePostHog();
	// Storybook's older shared decorator initializes analytics unconditionally;
	// the fixture must opt out on that actual client, not trust a main-process
	// telemetry variable which the standalone Vite preview does not consume.
	useLayoutEffect(() => analytics?.opt_out_capturing(), [analytics]);
	const regionRef = useRef<HTMLDivElement>(null);
	const seed = () =>
		mixed
			? mixedRecords()
			: formation
				? [
						// Stay within the existing 60-row MODEL cap while exercising a long
						// DOM canvas. Head trimming is an independent model-origin change,
						// not a representation-motion displacement.
						...(longFormation ? longRecords().slice(-54) : []),
						assistant(
							"smooth-context",
							"Upstream context stays at the same document-space origin.",
						),
						tool("smooth-t1"),
						tool("smooth-t2"),
						...(longFormation
							? [
									{
										...assistant(
											"smooth-after",
											Array.from(
												{ length: 12 },
												(_, index) =>
													`Downstream live line ${index}: preserve the reader above this continuing response.`,
											).join("\n\n"),
										),
										streaming: true,
										complete: false,
									},
								]
							: []),
					]
				: durable
					? longRecords().slice(-60)
					: longRecords();
	const [records, setRecords] = useState(seed);
	const currentRecords = useRef(records);
	currentRecords.current = records;
	const extendCandidate = (current: TranscriptRecord[]) => {
		const suffix = current.findIndex((record) => record.id === "smooth-after");
		return suffix < 0
			? [...current, tool("smooth-t3")]
			: [
					...current.slice(0, suffix),
					tool("smooth-t3"),
					...current.slice(suffix),
				];
	};
	const [hasMore, setHasMore] = useState(durable);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const fetchedPages = useRef(0);
	const loadOlder = async () => {
		if (!durable || !hasMore) return false;
		fetchedPages.current += 1;
		setLoadingOlder(true);
		await new Promise((resolve) => window.setTimeout(resolve, 50));
		setRecords((current) => [...longRecords().slice(120, 140), ...current]);
		setHasMore(false);
		setLoadingOlder(false);
		return true;
	};
	const [mount, setMount] = useState(0);
	useEffect(() => {
		if (!new URLSearchParams(location.search).has("reducedMotion")) return;
		// Story-local JS preference fixture, not native OS/browser media emulation.
		// This exercises the slot's immediate-swap policy; CSS media rules still
		// follow the browser preference and are outside this fixture's proof.
		const original = window.matchMedia.bind(window);
		window.matchMedia = (query) =>
			query === "(prefers-reduced-motion: reduce)"
				? Object.defineProperty(original(query), "matches", { value: true })
				: original(query);
		return () => {
			window.matchMedia = original;
		};
	}, []);
	useEffect(() => {
		if (!new URLSearchParams(location.search).has("fastFormation")) return;
		const timer = window.setTimeout(
			() =>
				document
					.querySelector<HTMLButtonElement>("[data-fast-formation]")
					?.click(),
			0,
		);
		return () => window.clearTimeout(timer);
	}, []);
	const parked = useRef<{ id: string; y: number } | null>(null);
	const [report, setReport] = useState("No measurement yet.");
	const [busy, setBusy] = useState(false);
	const commits = useRef<number[]>([]);
	const inspect = () => {
		const region = regionRef.current;
		if (!region) return {};
		const slot = region.querySelector<HTMLElement>(
			"[data-lo-entry-key=smooth-t1] [data-lo-transition-phase]",
		);
		const context = region.querySelector<HTMLElement>(
			"[data-record-id=smooth-context]",
		);
		return {
			telemetryOptedOut: analytics?.has_opted_out_capturing(),
			fontsStatus: document.fonts.status,
			reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
				.matches,
			mountedRecordIds: Array.from(
				region.querySelectorAll<HTMLElement>("[data-record-id]"),
				(node) => node.dataset.recordId,
			),
			parkedAnchor: parked.current,
			parkedAnchorDelta: parked.current
				? (() => {
						const node = region.querySelector<HTMLElement>(
							`[data-record-id="${parked.current.id}"]`,
						);
						return node
							? node.getBoundingClientRect().top - parked.current.y
							: null;
					})()
				: null,
			window: region.dataset.loDomWindow,
			reason: region.dataset.loDomWindowReason,
			fetchedRecords: currentRecords.current.length,
			fetchedPages: fetchedPages.current,
			pinned: region.dataset.loDomPinned,
			images: region.querySelectorAll("img").length,
			codeBlocks: region.querySelectorAll("pre").length,
			mountedEntries: region.querySelectorAll("[data-lo-entry-key]").length,
			mountedRows: region.querySelectorAll("[data-record-id]").length,
			domNodes: region.querySelectorAll("*").length,
			spacers: region.querySelectorAll("[data-lo-transcript-spacer]").length,
			spacerHeights: [
				...region.querySelectorAll<HTMLElement>("[data-lo-transcript-spacer]"),
			].map((node) => node.getBoundingClientRect().height),
			entryHeights: [
				...region.querySelectorAll<HTMLElement>("[data-lo-entry-key]"),
			].map((node) => node.getBoundingClientRect().height),
			scrollTop: region.scrollTop,
			scrollHeight: region.scrollHeight,
			clientHeight: region.clientHeight,
			slotHeight: slot?.getBoundingClientRect().height,
			fromHeight: slot?.dataset.loFromHeight,
			targetHeight: slot?.dataset.loTargetHeight,
			phase: slot?.dataset.loTransitionPhase,
			inlineTools: region.querySelectorAll('[data-record-kind="tool"]').length,
			aggregateHeaders: region.querySelectorAll("[data-fold-ids]").length,
			contextDocumentY: context
				? context.getBoundingClientRect().top -
					(region
						.querySelector<HTMLElement>("[data-lo-transcript-content]")
						?.getBoundingClientRect().top ?? 0)
				: null,
			reactCommitMs: commits.current.slice(-10),
		};
	};

	const pausedCleanup = useRef<(() => void) | null>(null);
	useEffect(() => () => pausedCleanup.current?.(), []);
	const freezeFormation = () => {
		const region = regionRef.current;
		if (!region) return;
		pausedCleanup.current?.();
		const nativeTimeout = window.setTimeout.bind(window);
		const heldTimers: { id: number; finish: () => void }[] = [];
		const animations: Animation[] = [];
		// Story-only deterministic evidence: the shipped 240ms missing-event
		// cleanup is suspended while CSS time is sampled. Normal probes above
		// keep the actual ceiling. Restore the timer function on capture/release.
		window.setTimeout = ((
			callback: TimerHandler,
			delay?: number,
			...args: unknown[]
		) => {
			if (
				delay === undefined ||
				delay > 240 ||
				typeof callback !== "function" ||
				!callback.name.startsWith("finish")
			)
				return nativeTimeout(callback, delay, ...args);
			const finish = () => callback(...args);
			const id = nativeTimeout(finish, 60_000);
			heldTimers.push({ id, finish });
			return id;
		}) as typeof window.setTimeout;
		const release = () => {
			window.setTimeout = nativeTimeout;
			region.removeEventListener("transitionrun", freeze);
			for (const animation of animations) animation.play();
			for (const timer of heldTimers) {
				clearTimeout(timer.id);
				timer.finish();
			}
			pausedCleanup.current = null;
		};
		const freezeAt = (shell: HTMLElement) => {
			animations.push(...shell.getAnimations({ subtree: true }));
			for (const animation of animations) animation.pause();
			const samples = [0, 90, 180].map((time) => {
				for (const animation of animations) animation.currentTime = time;
				return {
					cssTimeMs: time,
					computedHeight: getComputedStyle(shell).height,
					...inspect(),
				};
			});
			for (const animation of animations) animation.currentTime = 90;
			window.setTimeout = nativeTimeout;
			region.removeEventListener("transitionrun", freeze);
			setReport(
				JSON.stringify(
					{
						pausedCSS: true,
						cleanupBoundSuspended: true,
						animations: animations.length,
						samples,
					},
					null,
					2,
				),
			);
		};
		const freeze = (event: TransitionEvent) => {
			if (event.propertyName === "height")
				freezeAt(event.target as HTMLElement);
		};
		pausedCleanup.current = release;
		region.addEventListener("transitionrun", freeze);
		flushSync(() => setRecords(extendCandidate));
		const shell = region.querySelector<HTMLElement>(
			"[data-lo-entry-key=smooth-t1] [data-lo-transition-phase]",
		);
		if (shell) freezeAt(shell);
	};

	const measure = () => setReport(JSON.stringify(inspect(), null, 2));
	const park = () => {
		const region = regionRef.current;
		if (!region) return;
		region.scrollTop = -(region.scrollHeight - region.clientHeight) / 2;
		region.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
		requestAnimationFrame(() => {
			const edge = region.getBoundingClientRect().top + region.clientTop;
			const node = Array.from(
				region.querySelectorAll<HTMLElement>("[data-record-id]"),
			).find((row) => row.getBoundingClientRect().bottom > edge);
			parked.current = node?.dataset.recordId
				? { id: node.dataset.recordId, y: node.getBoundingClientRect().top }
				: null;
			measure();
		});
	};
	const probe = (change: () => void) => {
		const region = regionRef.current;
		if (!region) return;
		setBusy(true);
		commits.current = [];
		const edge = region.getBoundingClientRect().top + region.clientTop;
		const anchor = [
			...region.querySelectorAll<HTMLElement>("[data-record-id]"),
		].find((node) => node.getBoundingClientRect().bottom > edge);
		const anchorId = anchor?.dataset.recordId;
		const beforeY = anchor?.getBoundingClientRect().top ?? 0;
		const before = inspect();
		const frames: object[] = [];
		const deltas: number[] = [];
		const intervals: number[] = [];
		let previous = performance.now();
		change();
		const sample = (time: number) => {
			intervals.push(time - previous);
			previous = time;
			const node = anchorId
				? region.querySelector<HTMLElement>(`[data-record-id="${anchorId}"]`)
				: null;
			const delta = node ? node.getBoundingClientRect().top - beforeY : null;
			if (delta !== null) deltas.push(delta);
			const geometry = inspect();
			frames.push({ frame: frames.length, anchorDelta: delta, ...geometry });
			if (frames.length < 20) requestAnimationFrame(sample);
			else {
				setBusy(false);
				setReport(
					JSON.stringify(
						{
							before,
							anchorId,
							maxAnchorFrameDeltaPx: Math.max(0, ...deltas.map(Math.abs)),
							frameIntervalsMs: intervals,
							first: frames[0],
							mid: frames[5],
							after: frames[19],
							heights: frames.map(
								(frame) => (frame as { slotHeight?: number }).slotHeight,
							),
						},
						null,
						2,
					),
				);
			}
		};
		requestAnimationFrame(sample);
	};
	const profileBurst = () => {
		const region = regionRef.current;
		if (!region) return;
		const originalRect = HTMLElement.prototype.getBoundingClientRect;
		const originalStyle = window.getComputedStyle;
		let rectReads = 0;
		let styleReads = 0;
		HTMLElement.prototype.getBoundingClientRect = function () {
			if (region.contains(this)) rectReads += 1;
			return originalRect.call(this);
		};
		window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
			if (region.contains(element)) styleReads += 1;
			return originalStyle.call(window, element, pseudo);
		}) as typeof window.getComputedStyle;
		commits.current = [];
		const samples: number[] = [];
		const start = performance.now();
		try {
			for (let index = 0; index < 20; index += 1) {
				const before = performance.now();
				flushSync(() =>
					setRecords((current) =>
						current.map((record, position) =>
							position === current.length - 1 && record.kind === "assistant"
								? {
										...record,
										text: `${record.text} Token${index}.`,
										complete: false,
										streaming: true,
									}
								: record,
						),
					),
				);
				samples.push(performance.now() - before);
			}
		} finally {
			HTMLElement.prototype.getBoundingClientRect = originalRect;
			window.getComputedStyle = originalStyle;
		}
		const wallMs = performance.now() - start;
		setReport(
			JSON.stringify(
				{
					...inspect(),
					flushes: 20,
					wallMs,
					maxFlushMs: Math.max(...samples),
					meanFlushMs: wallMs / 20,
					rectReads,
					styleReads,
					reactCommitMs: commits.current,
					timingScope:
						"synchronous React flush and layout effects only; deferred observer/paint work excluded",
				},
				null,
				2,
			),
		);
	};
	const toggle = (enabled: boolean) => {
		window.localStorage.setItem(
			"canonicalTranscriptDomWindow",
			enabled ? "on" : "off",
		);
		pausedCleanup.current?.();
		setRecords(seed());
		setHasMore(durable);
		setLoadingOlder(false);
		fetchedPages.current = 0;
		setBusy(false);
		setMount((value) => value + 1);
		setReport("Remounted same source and fixture; measure after settling.");
	};
	return (
		<div className="bg-surface text-ink p-4">
			<div className="mb-3 flex flex-wrap gap-3">
				<button type="button" onClick={() => toggle(false)}>
					Flag off
				</button>
				<button type="button" onClick={() => toggle(true)}>
					Flag on
				</button>
				<button
					data-fast-formation
					type="button"
					onClick={() => {
						flushSync(() => toggle(true));
						(() => {
							const region = regionRef.current;
							if (!region) return;
							region.scrollTop = -100;
							region.dispatchEvent(
								new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
							);
							const before = inspect();
							freezeFormation();
							requestAnimationFrame(() => {
								const mid = inspect();
								// Font completion is asynchronous and used to discard omitted
								// measurements AFTER the formation's first apparently-good frame.
								void document.fonts.ready.then(() =>
									requestAnimationFrame(() =>
										requestAnimationFrame(() =>
											setReport(
												JSON.stringify(
													{
														fastSequence: true,
														before,
														mid,
														afterFonts: inspect(),
													},
													null,
													2,
												),
											),
										),
									),
								);
							});
						})();
					}}
				>
					Fast formation sequence
				</button>
				<button type="button" onClick={freezeFormation}>
					Freeze formation at 90ms
				</button>
				<button type="button" onClick={() => pausedCleanup.current?.()}>
					Release CSS capture
				</button>
				<button type="button" onClick={measure}>
					Measure
				</button>
				<button type="button" disabled={busy} onClick={park}>
					Park reader
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						probe(() =>
							setRecords((current) => [
								...current,
								assistant(
									`smooth-new-${current.length}`,
									"A new answer arrives at the tail while the reader is parked.",
								),
							]),
						)
					}
				>
					Append tail
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => probe(() => setRecords(extendCandidate))}
				>
					Two to three
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						probe(() => {
							const region = regionRef.current;
							const entries = [
								...(region?.querySelectorAll<HTMLElement>(
									"[data-lo-entry-key]",
								) ?? []),
							];
							const top = region?.getBoundingClientRect().top ?? 0;
							const firstVisible = entries.findIndex(
								(entry) => entry.getBoundingClientRect().bottom > top,
							);
							const prefix = entries[firstVisible - 1];
							const suffix = entries
								.slice(firstVisible + 1)
								.find(
									(entry) => Number.parseFloat(entry.style.paddingTop) >= 30,
								);
							if (!prefix || !suffix) {
								setReport(
									"BLOCKED: park with a measurable prefix and 32px suffix gap first.",
								);
								return;
							}
							prefix.style.paddingTop = `${Number.parseFloat(prefix.style.paddingTop) + 30}px`;
							suffix.style.paddingTop = `${Number.parseFloat(suffix.style.paddingTop) - 30}px`;
						})
					}
				>
					Equal extent redistribution
				</button>
				<button type="button" onClick={profileBurst}>
					Profile 20 token flushes
				</button>
				<button
					type="button"
					onClick={() => {
						const region = regionRef.current;
						if (region) {
							region.scrollTop = -100;
							region.dispatchEvent(
								new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
							);
						}
					}}
				>
					Read near formation
				</button>
				<button
					type="button"
					onClick={() => {
						const region = regionRef.current;
						if (region) {
							region.scrollTop = region.clientHeight - region.scrollHeight;
							region.dispatchEvent(
								new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
							);
						}
					}}
				>
					Request older at head
				</button>
			</div>
			<div className="flex flex-col" style={{ width: 1024, height: 560 }}>
				<Profiler
					id="real-transcript"
					onRender={(_id, _phase, duration) => {
						commits.current.push(duration);
					}}
				>
					<CanonicalTranscript
						key={mount}
						transcript={{ ...stateOf(records), hasMore }}
						gate={null}
						waiting={false}
						starting={false}
						startingAfterId={null}
						loadingOlder={loadingOlder}
						onLoadOlder={loadOlder}
						containerRef={regionRef}
						isSmallView={false}
						status="live"
						failure={null}
						awaitingHydration={false}
						onReconnect={() => {}}
						workingLine={{
							activity: "Working on the synthetic fixture",
							phase: "thinking",
							clock: false,
						}}
					/>
				</Profiler>
			</div>
			<pre
				data-lo-smoothness-report
				className="mt-4 whitespace-pre-wrap text-code-sm"
			>
				{report}
			</pre>
		</div>
	);
}
const meta: Meta = {
	title: "Chat/Streaming smoothness",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;
export const LongTranscript: Story = { render: () => <Frame /> };
export const TwoToThree: Story = { render: () => <Frame formation /> };
export const MixedTranscript: Story = { render: () => <Frame mixed /> };
export const WindowedFormation: Story = {
	render: () => <Frame formation longFormation />,
};
export const DurableOlder: Story = { render: () => <Frame durable /> };
