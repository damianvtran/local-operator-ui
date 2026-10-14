import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { ScrollLayoutCoordinator } from "./transcript-scroll-layout";

export type SlotExtent = {
	recordIds: readonly string[];
	height: number;
	gap: number;
	width: number;
	font: string;
	representation: string;
};

/**
 * The scalar extent, never an outgoing React tree, bridges structural swaps.
 * The gap is outside the interpolated shell; the sole new child supplies its
 * own natural target even while the shell is locked. Media always swaps once.
 */
export function TranscriptEntrySlot({
	entryKey,
	signature,
	sessionKey,
	expanded,
	anchorHeader,
	recordIds,
	representation,
	gap,
	media,
	live,
	arrival,
	fromHeight,
	fromFirstHeight,
	layout,
	extents,
	children,
}: {
	entryKey: string;
	signature: string;
	sessionKey: string;
	expanded: boolean;
	anchorHeader: boolean;
	recordIds: readonly string[];
	representation: string;
	gap: number;
	media: boolean;
	live: boolean;
	arrival: boolean;
	fromHeight: number | null;
	fromFirstHeight: number | null;
	layout: ScrollLayoutCoordinator;
	extents: Map<string, SlotExtent>;
	children: ReactNode;
}) {
	const shellRef = useRef<HTMLDivElement>(null);
	const payloadRef = useRef<HTMLDivElement>(null);
	const previous = useRef(representation);
	const previousExpanded = useRef(expanded);
	const previousSignature = useRef(signature);
	const previousSession = useRef(sessionKey);
	const firstMount = useRef(true);
	const deadline = useRef<number | null>(null);
	const previousLive = useRef(live);
	const runningTarget = useRef<number | null>(null);
	const entered = useRef(arrival);
	const stop = useRef<(() => void) | null>(null);
	useLayoutEffect(() => {
		const shell = shellRef.current;
		const payload = payloadRef.current;
		if (!shell || !payload) return;
		const save = () => {
			const rect = payload.getBoundingClientRect();
			extents.set(entryKey, {
				recordIds,
				height: rect.height,
				gap,
				width: rect.width,
				font: window.getComputedStyle(payload).font,
				representation,
			});
		};
		if (previousSession.current !== sessionKey) {
			stop.current?.();
			previousSession.current = sessionKey;
			previous.current = representation;
			previousExpanded.current = expanded;
			entered.current = false;
			payload.classList.remove("lo-transcript-arrival");
			save();
			return;
		}
		const signatureChanged = previousSignature.current !== signature;
		previousSignature.current = signature;
		const toggled = previousExpanded.current !== expanded;
		previousExpanded.current = expanded;
		const changed = previous.current !== representation;
		previous.current = representation;
		const wasLive = previousLive.current;
		previousLive.current = live;
		if (!changed && !toggled && !stop.current) {
			if (firstMount.current) {
				save();
				firstMount.current = false;
			} else if (signatureChanged) {
				const cached = extents.get(entryKey);
				if (cached)
					extents.set(entryKey, { ...cached, recordIds, gap, representation });
			}
			return;
		}
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (toggled && !media && !preference.matches) {
			stop.current?.();
			layout.begin();
			const release = layout.retainMotion();
			let done = false;
			let timer = 0;
			const finish = () => {
				if (done) return;
				done = true;
				observer.disconnect();
				clearTimeout(timer);
				preference.removeEventListener("change", finish);
				shell.dataset.loTransitionPhase = "settled";
				save();
				release();
				layout.commit();
				stop.current = null;
			};
			const observer = new ResizeObserver(() => {
				const cached = extents.get(entryKey);
				if (cached)
					extents.set(entryKey, {
						...cached,
						height: shell.getBoundingClientRect().height,
					});
				layout.commit(true);
			});
			shell.dataset.loTransitionPhase = "disclosure";
			observer.observe(payload);
			preference.addEventListener("change", finish);
			timer = window.setTimeout(finish, 240);
			stop.current = finish;
		}
		if (!changed) {
			if (
				stop.current &&
				(media ||
					(runningTarget.current !== null &&
						Math.abs(
							payload.getBoundingClientRect().height - runningTarget.current,
						) > 0.01))
			)
				stop.current();
			// Plain rows do not read layout on every streaming commit. Their old
			// scalar is read on-demand BEFORE a structural swap; the window's shared
			// observer owns exact geometry while enabled. Membership is cheap state.
			if (firstMount.current) {
				save();
				firstMount.current = false;
			} else if (signatureChanged) {
				const cached = extents.get(entryKey);
				if (cached)
					extents.set(entryKey, { ...cached, recordIds, gap, representation });
			}
			return;
		}
		const oldHeight = shell.getBoundingClientRect().height;
		const interrupted = stop.current !== null;
		const inheritedDeadline = deadline.current;
		const cached = extents.get(entryKey);
		stop.current?.();
		const region = shell.closest<HTMLElement>("[data-lo-transcript-scroll]");
		const rect = shell.getBoundingClientRect();
		const viewport = region?.getBoundingClientRect();
		const visible =
			viewport !== undefined &&
			rect.bottom > viewport.top &&
			rect.top < viewport.bottom;
		const natural = payload.getBoundingClientRect();
		const target = natural.height;
		const compatibleRegime =
			cached?.width === natural.width &&
			cached.font === window.getComputedStyle(payload).font &&
			cached.gap === gap;
		const knownBefore = new Set(
			[...extents.values()].flatMap((extent) => extent.recordIds),
		);
		const knownSpan = recordIds.every((id) => knownBefore.has(id));
		if (
			(!live && !wasLive && !knownSpan) ||
			media ||
			preference.matches ||
			!visible ||
			fromHeight === null ||
			!compatibleRegime
		) {
			save();
			layout.commit();
			return;
		}
		const from = interrupted
			? fromHeight - (fromFirstHeight ?? oldHeight) + oldHeight
			: fromHeight;
		deadline.current = inheritedDeadline ?? performance.now() + 240;
		const remaining = Math.max(0, deadline.current - performance.now());
		if (remaining === 0) {
			save();
			layout.commit();
			return;
		}
		layout.begin();
		const release = layout.retainMotion();
		let sampler = 0;
		let timer = 0;
		let done = false;
		const geometry = new ResizeObserver(() => {
			const next = payload.getBoundingClientRect();
			if (
				Math.abs(next.height - target) > 0.01 ||
				next.width !== cached.width
			) {
				finish();
				return;
			}
			const current = extents.get(entryKey);
			if (current)
				extents.set(entryKey, {
					...current,
					height: shell.getBoundingClientRect().height,
				});
			layout.commit(true);
		});
		geometry.observe(shell);
		geometry.observe(payload);
		runningTarget.current = target;
		const finish = () => {
			if (done) return;
			done = true;
			geometry.disconnect();
			runningTarget.current = null;
			deadline.current = null;
			cancelAnimationFrame(sampler);
			clearTimeout(timer);
			preference.removeEventListener("change", finish);
			shell.removeEventListener("transitionend", complete);
			for (const property of ["height", "overflow", "transition"])
				shell.style.removeProperty(property);
			for (const property of ["opacity", "transition"])
				payload.style.removeProperty(property);
			shell.dataset.loTransitionPhase = "settled";
			save();
			release();
			layout.commit();
			stop.current = null;
		};
		const complete = (event: TransitionEvent) => {
			if (event.target === shell && event.propertyName === "height") finish();
		};
		shell.dataset.loTransitionPhase = "locked";
		shell.dataset.loFromHeight = String(from);
		shell.dataset.loTargetHeight = String(target);
		shell.style.overflow = "clip";
		shell.style.height = `${from}px`;
		payload.style.opacity = "0";
		extents.set(entryKey, {
			recordIds,
			height: from,
			gap,
			width: natural.width,
			font: window.getComputedStyle(payload).font,
			representation,
		});
		layout.commit(true);
		// Flush the scalar lock, not an old/duplicate payload. This starts the
		// real CSS transition without a two-rAF delay on background pages.
		shell.getBoundingClientRect();
		const duration = interrupted
			? `${Math.min(180, remaining)}ms`
			: "var(--duration-base)";
		shell.style.transition = `height ${duration} var(--ease-out-quart)`;
		payload.style.transition = `opacity ${duration} var(--ease-out-quart)`;
		shell.style.height = `${target}px`;
		payload.style.opacity = "1";
		shell.dataset.loTransitionPhase = "interpolating";
		const frame = () => {
			if (done) return;
			layout.commit(true);
			sampler = requestAnimationFrame(frame);
		};
		sampler = requestAnimationFrame(frame);
		timer = window.setTimeout(finish, remaining);
		preference.addEventListener("change", finish);
		shell.addEventListener("transitionend", complete);
		stop.current = finish;
	});
	useLayoutEffect(() => () => stop.current?.(), []);
	return (
		<div
			data-lo-entry-key={entryKey}
			data-lo-entry-signature={signature}
			className="flex shrink-0 flex-col"
			style={{ paddingTop: gap }}
		>
			<div
				ref={shellRef}
				data-lo-layout-anchor={anchorHeader ? recordIds[0] : undefined}
				data-lo-transition-phase="settled"
				className="shrink-0"
			>
				<div
					ref={payloadRef}
					data-lo-slot-payload
					className={
						entered.current
							? "lo-transcript-arrival flex flex-col [&>*:first-child]:mt-0"
							: "flex flex-col [&>*:first-child]:mt-0"
					}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
