import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	TAG_DRAG_EDGE_PX,
	TAG_DRAG_HOLD_MS,
	TAG_DRAG_SCROLL_PX,
	TAG_DROP_PREVIEW_CLASSES,
	tagDragPhase,
} from "./chat-tag-drag";

type Gesture = {
	id: string;
	pointer: number;
	x: number;
	y: number;
	lastX: number;
	lastY: number;
	started: number;
	armed: boolean;
	owner: HTMLElement;
	section: HTMLElement;
	bucket: string;
	capture: HTMLElement;
	timer: ReturnType<typeof setTimeout> | null;
};
type Options = {
	enabled: boolean;
	arm: (id: string) => void;
	move: (
		id: string,
		y: number,
		over: Element | null,
		target: string | null,
	) => void;
	settle: (id: string, target: string | null, commit: boolean) => void;
};

/** Pointer capture owns delivery, not hit testing. Resolve the underlying header
 * (or an unused tag's footer slot, which is outside every section)
 * from viewport geometry, clipped to the owning scroll list, so hidden/offscreen
 * buckets never become drop targets during auto-scroll. Only Untagged sources
 * may cross sections; tagged sources keep their existing section boundary.
 * Own-bucket bodies remain reorder space, not tag assignment targets. */
export function tagDropTargetAt(
	owner: HTMLElement,
	x: number,
	y: number,
	section: Element,
	sourceBucket?: string,
	includeBodies = true,
): HTMLElement | null {
	const rect = owner.getBoundingClientRect();
	if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
		return null;
	return (
		Array.from(
			owner.querySelectorAll<HTMLElement>(
				includeBodies
					? "[data-tag-drop-target]"
					: "[data-tag-drop-target]:not([data-tag-drop-body])",
			),
		).find((header) => {
			const box = header.getBoundingClientRect();
			return (
				(header.closest("[data-chat-section]") === section ||
					(sourceBucket === "untagged" &&
						header.dataset.tagDropTarget !== "untagged") ||
					// An unused tag's footer slot (v3 spec D3) belongs to no time
					// section - it lists tags no conversation carries - so it is a
					// target from every section. Pinned reorder never reads it.
					(includeBodies && header.dataset.tagUnusedSlot !== undefined)) &&
				!(
					header.dataset.tagDropBody !== undefined &&
					header.dataset.tagDropTarget === sourceBucket
				) &&
				box.height > 0 &&
				x >= box.left &&
				x <= box.right &&
				y >= box.top &&
				y <= box.bottom
			);
		}) ?? null
	);
}

/** Pinned reorder retains its original header-only, section-local hit test. */
export function tagHeaderAt(
	owner: HTMLElement,
	x: number,
	y: number,
	section: Element,
): HTMLElement | null {
	return tagDropTargetAt(owner, x, y, section, undefined, false);
}

/** A rejected pending gesture still consumes its completing click. Keyboard
 * activation has detail=0 and is deliberately outside this pointer latch. */
export function useChatTagDrag(options: Options) {
	const latest = useRef(options);
	latest.current = options;
	const live = useRef<Gesture | null>(null);
	const suppress = useRef<string | null>(null);
	const [armedId, setArmedId] = useState<string | null>(null);
	const [target, setTarget] = useState<HTMLElement | null>(null);
	const frame = useRef<number | null>(null);
	const finish = useRef<(commit: boolean) => void>(() => {});
	const refresh = useCallback(() => {
		const gesture = live.current;
		if (!gesture?.armed) return;
		const header = tagDropTargetAt(
			gesture.owner,
			gesture.lastX,
			gesture.lastY,
			gesture.section,
			gesture.bucket,
		);
		setTarget(header);
		latest.current.move(
			gesture.id,
			gesture.lastY,
			document.elementFromPoint(gesture.lastX, gesture.lastY),
			header?.dataset.tagDropTarget ?? null,
		);
	}, []);
	const tick = () => {
		const gesture = live.current;
		if (!gesture?.armed) return;
		const rect = gesture.owner.getBoundingClientRect();
		const y = gesture.lastY;
		if (
			y >= rect.top &&
			y <= rect.bottom &&
			gesture.lastX >= rect.left &&
			gesture.lastX <= rect.right
		) {
			if (y - rect.top < TAG_DRAG_EDGE_PX)
				gesture.owner.scrollTop -= TAG_DRAG_SCROLL_PX;
			else if (rect.bottom - y < TAG_DRAG_EDGE_PX)
				gesture.owner.scrollTop += TAG_DRAG_SCROLL_PX;
		}
		refresh();
		frame.current = requestAnimationFrame(tick);
	};
	const armGesture = useRef<(gesture: Gesture) => void>(() => {});
	armGesture.current = (gesture) => {
		if (live.current !== gesture || gesture.armed) return;
		gesture.armed = true;
		suppress.current = gesture.id;
		try {
			gesture.capture.setPointerCapture(gesture.pointer);
		} catch {
			// Synthetic Storybook pointers have no native capture owner. Window
			// delivery still exercises the lifecycle, as on the existing pin grip.
		}
		setArmedId(gesture.id);
		latest.current.arm(gesture.id);
		refresh();
		frame.current = requestAnimationFrame(tick);
	};
	finish.current = (commit) => {
		const gesture = live.current;
		if (!gesture) return;
		live.current = null;
		if (!commit) suppress.current = gesture.id;
		if (gesture.timer !== null) clearTimeout(gesture.timer);
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		const header =
			commit && gesture.armed
				? tagDropTargetAt(
						gesture.owner,
						gesture.lastX,
						gesture.lastY,
						gesture.section,
						gesture.bucket,
					)
				: null;
		if (gesture.capture.hasPointerCapture(gesture.pointer))
			gesture.capture.releasePointerCapture(gesture.pointer);
		setTarget(null);
		if (gesture.armed) {
			latest.current.settle(
				gesture.id,
				header?.dataset.tagDropTarget ?? null,
				commit,
			);
			// Keep hover/menu surfaces latched through the render that remounts a moved row.
			requestAnimationFrame(() => setArmedId(null));
		}
	};
	useEffect(() => {
		const move = (event: PointerEvent) => {
			const gesture = live.current;
			if (!gesture || gesture.pointer !== event.pointerId) return;
			// Timers can be delayed by a busy frame. The last observed movement was
			// within slop (otherwise this candidate was already cancelled), so a
			// movement arriving after the hold belongs to the armed gesture.
			if (
				!gesture.armed &&
				tagDragPhase(
					performance.now() - gesture.started,
					Math.hypot(gesture.lastX - gesture.x, gesture.lastY - gesture.y),
				) === "armed"
			)
				armGesture.current(gesture);
			gesture.lastX = event.clientX;
			gesture.lastY = event.clientY;
			if (!gesture.armed) {
				if (
					tagDragPhase(
						performance.now() - gesture.started,
						Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y),
					) === "cancelled"
				) {
					suppress.current = gesture.id;
					finish.current(false);
				}
				return;
			}
			event.preventDefault();
			refresh();
		};
		const up = (event: PointerEvent) => {
			if (live.current?.pointer !== event.pointerId) return;
			const gesture = live.current;
			if (
				!gesture.armed &&
				tagDragPhase(
					performance.now() - gesture.started,
					Math.hypot(gesture.lastX - gesture.x, gesture.lastY - gesture.y),
				) === "armed"
			)
				armGesture.current(gesture);
			live.current.lastX = event.clientX;
			live.current.lastY = event.clientY;
			if (
				!live.current.armed &&
				tagDragPhase(
					performance.now() - live.current.started,
					Math.hypot(
						event.clientX - live.current.x,
						event.clientY - live.current.y,
					),
				) === "cancelled"
			) {
				finish.current(false);
				return;
			}
			refresh();
			finish.current(true);
		};
		// touch-action is decided at pointerdown. Keep pending touches scrollable,
		// then cancel touchmove's default only after the hold has claimed the gesture.
		const touchMove = (event: TouchEvent) => {
			if (live.current?.armed) event.preventDefault();
		};
		const cancel = () => finish.current(false);
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape" && live.current) {
				event.preventDefault();
				cancel();
			}
		};
		window.addEventListener("pointermove", move, { passive: false });
		window.addEventListener("touchmove", touchMove, { passive: false });
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("blur", cancel);
		window.addEventListener("keydown", key);
		return () => {
			cancel();
			window.removeEventListener("pointermove", move);
			window.removeEventListener("touchmove", touchMove);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("blur", cancel);
			window.removeEventListener("keydown", key);
		};
	}, [refresh]);
	useEffect(() => {
		if (!options.enabled) finish.current(false);
	}, [options.enabled]);
	useEffect(() => {
		if (!target) return;
		const group =
			target.closest<HTMLElement>("[data-chat-tag-group]") ?? target;
		// A single group marker paints opaque row grounds too, without replacing
		// their selection classes. Keep the hit element marked for existing headers.
		group.dataset.tagDropPreview = "true";
		group.classList.add(...TAG_DROP_PREVIEW_CLASSES);
		target.classList.add("bg-row-selected");
		return () => {
			delete group.dataset.tagDropPreview;
			group.classList.remove(...TAG_DROP_PREVIEW_CLASSES);
			target.classList.remove("bg-row-selected");
		};
	}, [target]);
	return {
		armedId,
		consumeClick(id: string, detail: number) {
			if (detail === 0 || suppress.current !== id) return false;
			suppress.current = null;
			return true;
		},
		start(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
			if (!latest.current.enabled || event.button !== 0 || !event.isPrimary)
				return;
			const element = event.target as Element;
			if (
				element.closest(
					"a,input,select,textarea,[role=button],[role=checkbox],[data-pin-grip],[data-tag-chip]",
				) ||
				element.closest("button") !== event.currentTarget
			)
				return;
			const owner = event.currentTarget.closest<HTMLElement>(
				"[data-tag-drag-list]",
			);
			const section = event.currentTarget.closest<HTMLElement>(
				"[data-chat-section]",
			);
			if (
				!owner ||
				!section ||
				!event.currentTarget.closest("[data-chat-tag-group]")
			)
				return;
			finish.current(false);
			suppress.current = null;
			const gesture: Gesture = {
				id,
				pointer: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				lastX: event.clientX,
				lastY: event.clientY,
				started: performance.now(),
				armed: false,
				owner,
				section,
				bucket:
					event.currentTarget.closest<HTMLElement>("[data-chat-tag-group]")
						?.dataset.chatTagGroup ?? "",
				capture: event.currentTarget,
				timer: null,
			};
			gesture.timer = setTimeout(() => {
				if (
					tagDragPhase(
						performance.now() - gesture.started,
						Math.hypot(gesture.lastX - gesture.x, gesture.lastY - gesture.y),
					) === "armed"
				)
					armGesture.current(gesture);
			}, TAG_DRAG_HOLD_MS);
			live.current = gesture;
		},
	};
}
