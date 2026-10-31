import type { AnchorSample } from "./scroll-paging";

/** Exact sizes belong to one content signature and width, never just a key. */
export type EntryMeasurement = {
	signature: string;
	width: number;
	height: number;
	kind?: string;
	gap?: number;
};
export type EntryDescriptor = {
	key: string;
	signature: string;
	estimate: number;
	recordIds: readonly string[];
	active?: boolean;
	unsafe?: boolean;
	omitted?: boolean;
	collapsed?: boolean;
	estimateKind?: string;
	gapPx?: number;
	estimateType?: string;
	estimateText?: string;
};

/**
 * The facts one entry slot's signature states. Structural, so the transcript
 * passes its own fact objects without a cast - and so a test can hand this
 * function two facts that differ in ONE bit.
 */
export type SlotSignatureFact = {
	key: string;
	ids: readonly string[];
	representation: string;
	gap: string;
	userExpanded: boolean;
	media: boolean;
	unsafe: boolean;
	/** Whether this slot draws the turn's mark (24px the estimate adds). */
	marksHead: boolean;
	renderSignature: string;
};

/**
 * The per-entry invalidation key: everything a cached HEIGHT depends on.
 *
 * WHY IT IS A FUNCTION AND NOT A TEMPLATE INSIDE THE COMPONENT (agent review
 * round 2, R2-4 on #1518). The pins for the turn mark's height used to
 * `assert.match` the component's source text, which proved the string existed,
 * not that the signature MOVES when a picture arrives. Running this over two
 * facts that differ only in `marksHead` is the property itself.
 *
 * `isSmallView` is part of the key because the same slot measures differently
 * at the small breakpoint.
 */
export function entrySlotSignature(
	facts: readonly SlotSignatureFact[],
	isSmallView: boolean,
): string {
	return `${facts
		.map(
			(fact) =>
				`${fact.key}:${fact.ids.join(",")}:${fact.representation}:${fact.gap}:${fact.userExpanded}:${fact.media}:${fact.unsafe}:${fact.marksHead ? 1 : 0}:${fact.renderSignature}`,
		)
		.join("|")}:${isSmallView}`;
}

/** O(n) batched rebuild, O(log n) lookup; modest model windows do not need a tree. */
export function buildHeightIndex(
	entries: readonly Pick<EntryDescriptor, "key" | "signature" | "estimate">[],
	measurements: ReadonlyMap<string, EntryMeasurement>,
	width: number,
): number[] {
	const seen = new Set<string>();
	const prefix = [0];
	for (const entry of entries) {
		if (seen.has(entry.key))
			throw new Error(`Duplicate transcript entry: ${entry.key}`);
		seen.add(entry.key);
		const measured = measurements.get(entry.key);
		const height =
			measured?.signature === entry.signature && measured.width === width
				? measured.height
				: entry.estimate;
		if (!Number.isFinite(height) || height < 0)
			throw new Error(`Invalid transcript extent: ${entry.key}`);
		prefix.push(prefix[prefix.length - 1] + height);
	}
	return prefix;
}

/**
 * A font/style notification invalidates exactness, not the last known extent.
 * Omitted entries cannot be remeasured in this commit. Demoting their cached
 * heights to estimates avoids replacing the whole prefix with cold heuristics;
 * signature/width checks still reject incompatible estimates on the next build.
 * Mounted entries are measured afresh and replace these estimates normally.
 */
export function invalidateEntryMeasurements(
	measured: Map<string, EntryMeasurement>,
	frozen: Map<string, EntryMeasurement>,
): void {
	for (const [key, value] of measured) frozen.set(key, { ...value });
	measured.clear();
}

export type WindowPiece =
	| { kind: "entry"; index: number }
	| { kind: "spacer"; start: number; end: number; height: number };

function lowerBound(values: readonly number[], target: number): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (values[mid] < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Chronological intervals INSIDE the normal-flow column, not the reversed parent. */
export function windowSegments(
	prefix: readonly number[],
	top: number,
	bottom: number,
	overscan: number,
	leases: readonly number[],
): WindowPiece[] {
	const count = prefix.length - 1;
	const mounted = new Set(
		leases.filter((index) => index >= 0 && index < count),
	);
	const lo = Math.max(0, lowerBound(prefix, top - overscan) - 1);
	const hi = Math.min(count, lowerBound(prefix, bottom + overscan));
	for (let index = lo; index < hi; index++) {
		if (prefix[index + 1] > top - overscan && prefix[index] < bottom + overscan)
			mounted.add(index);
	}
	const pieces: WindowPiece[] = [];
	let start = 0;
	for (const index of [...mounted].sort((a, b) => a - b)) {
		if (start < index)
			pieces.push({
				kind: "spacer",
				start,
				end: index,
				height: prefix[index] - prefix[start],
			});
		pieces.push({ kind: "entry", index });
		start = index + 1;
	}
	if (start < count)
		pieces.push({
			kind: "spacer",
			start,
			end: count,
			height: prefix[count] - prefix[start],
		});
	return pieces;
}

/** Trusted layout revision only: ordinary paging must retain its extent guard. */
export function layoutTransactionDrift(
	before: AnchorSample | null,
	after: AnchorSample | null,
	capturedInput: number,
	currentInput: number,
): number | null {
	if (
		!before ||
		!after ||
		before.id !== after.id ||
		capturedInput !== currentInput
	)
		return null;
	return after.viewportOffset - before.viewportOffset;
}

export type SlotInput = {
	key: string;
	firstId: string;
	candidate: boolean;
	boundary: boolean;
	representation: "inline" | "aggregate";
};
export type CandidateSlot = {
	key: string;
	indices: number[];
	representation: "inline" | "aggregate";
};

/** A/B already share A's owner before C makes the model fold; no third-row flash. */
export function candidateSlots(entries: readonly SlotInput[]): CandidateSlot[] {
	const slots: CandidateSlot[] = [];
	let candidate: CandidateSlot | null = null;
	entries.forEach((entry, index) => {
		if (!entry.candidate || entry.boundary) candidate = null;
		if (entry.candidate && candidate) candidate.indices.push(index);
		else {
			const slot = {
				key: entry.firstId,
				indices: [index],
				representation: entry.representation,
			};
			slots.push(slot);
			candidate = entry.candidate ? slot : null;
		}
	});
	return slots;
}

/** A model run can reach three while its inline editor/selection still owns focus. */
export function deferAggregateFormation(
	previous: string | undefined,
	interacting: boolean,
): boolean {
	return previous === "inline" && interacting;
}

/** Cold estimates are heuristics, not native measurements; wrapping cannot be constant. */
export function estimateEntryHeight(
	kind: string,
	text: string,
	gap: number,
	width: number,
): number {
	const columns = Math.max(24, Math.floor((width || 810) / 7.2));
	const lines = text
		.split("\n")
		.reduce(
			(sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)),
			0,
		);
	if (kind === "fold" || kind === "turn") return gap + Math.max(20, lines * 20);
	if (kind === "tool" || kind === "custom")
		return gap + Math.max(20, lines * 20);
	return gap + lines * 22.4 + (kind === "user" ? 48 : 32);
}

/**
 * Matching recent medians seed cold entries once. Subsequent samples cannot
 * resize all omitted history; width/signature changes explicitly start a new
 * regime. Last exact height may be carried as an ESTIMATE for compatible ink
 * revisions, never labelled exact by buildHeightIndex.
 */
export function seedEntryEstimates<
	T extends Pick<
		EntryDescriptor,
		| "key"
		| "signature"
		| "estimate"
		| "estimateKind"
		| "gapPx"
		| "estimateType"
		| "estimateText"
		| "omitted"
	>,
>(
	entries: readonly T[],
	measured: ReadonlyMap<string, EntryMeasurement>,
	frozen: Map<string, EntryMeasurement>,
	width: number,
): T[] {
	const current = new Map(entries.map((entry) => [entry.key, entry]));
	const samples = new Map<string | undefined, number[]>();
	for (const [key, value] of measured) {
		if (
			value.width !== width ||
			current.get(key)?.signature !== value.signature
		)
			continue;
		const bucket = samples.get(value.kind) ?? [];
		bucket.push(value.height - (value.gap ?? 0));
		if (bucket.length > 31) bucket.shift();
		samples.set(value.kind, bucket);
	}
	return entries.map((entry) => {
		if (entry.omitted) return { ...entry, estimate: 0 };
		let value = frozen.get(entry.key);
		if (value?.signature !== entry.signature || value.width !== width) {
			const ordered = [...(samples.get(entry.estimateKind) ?? [])].sort(
				(a, b) => a - b,
			);
			const previous = measured.get(entry.key);
			const height =
				previous?.width === width && previous.kind === entry.estimateKind
					? previous.height - (previous.gap ?? 0) + (entry.gapPx ?? 0)
					: ordered.length
						? ordered[Math.floor(ordered.length / 2)] + (entry.gapPx ?? 0)
						: entry.estimateType
							? estimateEntryHeight(
									entry.estimateType,
									entry.estimateText ?? "",
									entry.gapPx ?? 0,
									width,
								)
							: entry.estimate;
			value = {
				signature: entry.signature,
				width,
				height,
				kind: entry.estimateKind,
				gap: entry.gapPx,
			};
			frozen.set(entry.key, value);
		}
		return { ...entry, estimate: value.height };
	});
}
