import { useCallback, useEffect, useRef, useState } from "react";
import { approvalsDockFullWidth } from "./approvals-dock-layout";

/**
 * The width of the row the page and the approvals dock share.
 *
 * A CALLBACK ref, not a one-shot mount effect: the row only exists on the
 * surface's ready return, and the availability branch (cold start, host retry)
 * unmounts it. An effect with `[]` observes null and never fires again, leaving
 * a narrow pane on the 24px side form after the host becomes ready. The
 * callback runs on every attach, including that remount.
 */
export function useApprovalsDockWidth(): {
	fullWidth: boolean;
	attachDockRow: (node: HTMLDivElement | null) => void;
} {
	const [fullWidth, setFullWidth] = useState(false);
	const observerRef = useRef<ResizeObserver | null>(null);
	const attachDockRow = useCallback((node: HTMLDivElement | null): void => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		if (!node) return;
		const report = (): void =>
			setFullWidth(approvalsDockFullWidth(node.clientWidth));
		report();
		const observer = new ResizeObserver(report);
		observer.observe(node);
		observerRef.current = observer;
	}, []);
	useEffect(
		() => () => {
			observerRef.current?.disconnect();
			observerRef.current = null;
		},
		[],
	);
	return { fullWidth, attachDockRow };
}
