import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionNotification } from "../../shared/desktop-companion";

export function useCompanionNotifications(
	notifications: CompanionNotification[],
	engaged: boolean,
	available = true,
) {
	const [nudging, setNudging] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const context = useRef({ notifications, engaged, available });
	const recent = useRef(new Set<string>());
	const active = useRef(
		new Map<string, { noticed: boolean; remindAt: number | null }>(),
	);
	const timer = useRef(0);
	const until = useRef(0);
	const lastStart = useRef(Number.NEGATIVE_INFINITY);
	const reducedMotion = useRef(false);
	const remember = useCallback((key: string) => {
		recent.current.delete(key);
		recent.current.add(key);
		if (recent.current.size > 128)
			recent.current.delete(recent.current.values().next().value as string);
	}, []);
	const settle = useCallback(() => {
		until.current = 0;
		setNudging(false);
		setAnnouncement("");
	}, []);
	const refresh = useCallback(
		function refresh() {
			window.clearTimeout(timer.current);
			timer.current = 0;
			const {
				notifications: notices,
				engaged: occupied,
				available: connected,
			} = context.current;
			if (!connected) {
				active.current.clear();
				settle();
				return;
			}
			const current = notices.filter((notice) => notice.kind !== "complete");
			const keys = new Set(current.map((notice) => notice.key));
			for (const key of recent.current) {
				if (!keys.has(key)) recent.current.delete(key);
			}
			for (const key of active.current.keys()) {
				if (!keys.has(key)) active.current.delete(key);
			}
			for (const key of keys) {
				if (!active.current.has(key))
					active.current.set(key, {
						noticed: recent.current.has(key),
						remindAt: null,
					});
			}
			if (!keys.size || occupied || document.hidden) {
				settle();
				return;
			}
			const now = window.performance.now();
			const later = (delay: number) => {
				timer.current = window.setTimeout(refresh, delay);
			};
			if (until.current > now) {
				later(until.current - now);
				return;
			}
			if (until.current) settle();
			const arrivals = current.filter(
				(notice) => !active.current.get(notice.key)?.noticed,
			);
			const reminders = [...active.current.values()].filter(
				(entry) => entry.remindAt !== null && entry.remindAt <= now,
			);
			if (arrivals.length || reminders.length) {
				const cooldown = lastStart.current + 20_000 - now;
				if (cooldown > 0) {
					later(cooldown);
					return;
				}
				for (const notice of arrivals) {
					remember(notice.key);
					active.current.set(notice.key, {
						noticed: true,
						remindAt: reducedMotion.current ? null : now + 90_000,
					});
				}
				for (const entry of reminders) entry.remindAt = null;
				setAnnouncement(
					arrivals.length
						? `${arrivals.length} new task notification${arrivals.length === 1 ? "" : "s"}.`
						: "",
				);
				setNudging(!reducedMotion.current);
				lastStart.current = now;
				until.current = now + 1400;
				later(1400);
				return;
			}
			const deadlines = [...active.current.values()].flatMap(({ remindAt }) =>
				remindAt === null ? [] : [remindAt],
			);
			if (deadlines.length) later(Math.min(...deadlines) - now);
		},
		[remember, settle],
	);
	const acknowledge = useCallback(() => {
		for (const notice of context.current.notifications) {
			if (notice.kind === "complete") continue;
			remember(notice.key);
			active.current.set(notice.key, { noticed: true, remindAt: null });
		}
		settle();
		refresh();
	}, [refresh, remember, settle]);
	useEffect(() => {
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => {
			reducedMotion.current = preference.matches;
			if (preference.matches) {
				for (const entry of active.current.values()) entry.remindAt = null;
				settle();
			}
			refresh();
		};
		preference.addEventListener("change", sync);
		document.addEventListener("visibilitychange", refresh);
		sync();
		return () => {
			window.clearTimeout(timer.current);
			preference.removeEventListener("change", sync);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [refresh, settle]);
	useEffect(() => {
		context.current = { notifications, engaged, available };
		refresh();
	}, [notifications, engaged, available, refresh]);
	return { nudging, announcement, acknowledge };
}
