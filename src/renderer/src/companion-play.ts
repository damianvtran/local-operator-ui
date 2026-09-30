import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionActivity } from "../../shared/desktop-companion";
import type { CompanionReaction } from "./companion-art";

export const COMPANION_BOUNCE_DURATION = 1800;

export interface CompanionPlayScene {
	kind: CompanionActivity;
	phase: "offer" | "playing" | "reveal" | "finish";
	step: number;
	side: "left" | "right";
	choice?: "left" | "right";
	shiny: boolean;
}

export function useCompanionPlay(available: boolean, characterId: string) {
	const [scene, setScene] = useState<CompanionPlayScene | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const current = useRef<CompanionPlayScene | null>(null);
	const context = useRef({ available, characterId });
	const owner = useRef(characterId);
	const timer = useRef(0);
	const reducedMotion = useRef(false);
	const lastTap = useRef(Number.NEGATIVE_INFINITY);
	const pokes = useRef({ count: 0, last: Number.NEGATIVE_INFINITY });
	const nextToy = useRef(0);
	const discoverAfter = useRef(0);
	const completed = useRef(0);
	const sparkled = useRef(false);
	context.current = { available, characterId };

	const clear = useCallback(() => {
		window.clearTimeout(timer.current);
		timer.current = 0;
	}, []);
	const update = useCallback((next: CompanionPlayScene | null) => {
		current.current = next;
		setScene(next);
	}, []);
	const cancel = useCallback(() => {
		if (current.current)
			discoverAfter.current = window.performance.now() + 2000;
		pokes.current.count = 0;
		clear();
		update(null);
		setAnnouncement("");
	}, [clear, update]);
	const canPlay = useCallback(
		() =>
			context.current.available &&
			owner.current === context.current.characterId &&
			!document.hidden,
		[],
	);
	const later = useCallback(
		(callback: () => void, delay: number) => {
			clear();
			timer.current = window.setTimeout(() => {
				timer.current = 0;
				if (canPlay()) callback();
				else cancel();
			}, delay);
		},
		[canPlay, cancel, clear],
	);
	const finish = useCallback(
		(round: CompanionPlayScene, message: string) => {
			const shiny = ++completed.current === 3 && !sparkled.current;
			if (shiny) sparkled.current = true;
			update({ ...round, phase: "finish", shiny });
			setAnnouncement(
				shiny ? "A little sparkle. Same little friend." : message,
			);
			later(cancel, shiny ? 2200 : 1400);
		},
		[cancel, later, update],
	);
	const endBounce = useCallback(() => {
		const round = current.current;
		if (!round || round.kind !== "bounce") return;
		update({ ...round, phase: "reveal" });
		setAnnouncement("All done.");
		later(cancel, 1000);
	}, [cancel, later, update]);
	const start = useCallback(
		(kind: CompanionActivity) => {
			if (
				!context.current.available ||
				document.hidden ||
				(kind !== "snack" && kind !== "bounce" && kind !== "guess")
			)
				return;
			owner.current = context.current.characterId;
			pokes.current.count = 0;
			lastTap.current = Number.NEGATIVE_INFINITY;
			update({
				kind,
				phase: "offer",
				step: 0,
				side: Math.random() < 0.5 ? "left" : "right",
				shiny: false,
			});
			setAnnouncement(
				kind === "snack"
					? "Tap to share a snack."
					: kind === "guess"
						? "Choose a side: left or right."
						: reducedMotion.current
							? "Tap the ball five times."
							: "Tap to keep the ball up.",
			);
			later(cancel, 20_000);
		},
		[cancel, later, update],
	);
	const discover = useCallback(() => {
		if (!context.current.available || document.hidden || current.current)
			return;
		const now = window.performance.now();
		if (now < discoverAfter.current) return;
		if (now - pokes.current.last > 1400) pokes.current.count = 0;
		pokes.current.last = now;
		if (++pokes.current.count < 5) return;
		const toys: CompanionActivity[] = ["snack", "bounce", "guess"];
		start(toys[nextToy.current++ % toys.length]);
	}, [start]);
	const tap = useCallback(
		(side?: "left" | "right") => {
			const round = current.current;
			if (!round || !canPlay()) return;
			if (round.phase !== "offer" && round.phase !== "playing") return;
			if (round.kind === "guess") {
				if (side !== "left" && side !== "right") return;
				const revealed = { ...round, phase: "reveal" as const, choice: side };
				update(revealed);
				setAnnouncement(side === round.side ? "Found it." : "There it is.");
				if (side === round.side)
					later(() => finish(revealed, "Found it."), 700);
				else later(cancel, 2100);
				return;
			}
			if (round.kind === "snack") {
				if (round.phase !== "offer") return;
				const nibbling = { ...round, phase: "playing" as const, step: 1 };
				update(nibbling);
				setAnnouncement("");
				later(() => finish(nibbling, "A happy little nibble."), 1500);
				return;
			}
			const now = window.performance.now();
			if (now - lastTap.current < 300) return;
			lastTap.current = now;
			const bounced: CompanionPlayScene = {
				...round,
				phase: "playing",
				step: round.step + 1,
				side: round.side === "left" ? "right" : "left",
			};
			if (bounced.step === 5) finish(bounced, "Five little bounces.");
			else {
				update(bounced);
				setAnnouncement(reducedMotion.current ? `${bounced.step} of 5.` : "");
				later(
					endBounce,
					reducedMotion.current ? 20_000 : COMPANION_BOUNCE_DURATION,
				);
			}
		},
		[canPlay, cancel, endBounce, finish, later, update],
	);

	useEffect(() => {
		if (!available || owner.current !== characterId) cancel();
	}, [available, characterId, cancel]);
	useEffect(() => {
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		reducedMotion.current = motion.matches;
		const changeMotion = () => {
			reducedMotion.current = motion.matches;
			if (
				current.current?.kind === "bounce" &&
				current.current.phase === "playing"
			)
				later(endBounce, motion.matches ? 20_000 : COMPANION_BOUNCE_DURATION);
		};
		const hide = () => {
			if (document.hidden) cancel();
		};
		const dismiss = (event: KeyboardEvent) => {
			if (event.key === "Escape") cancel();
		};
		motion.addEventListener("change", changeMotion);
		document.addEventListener("visibilitychange", hide);
		window.addEventListener("blur", cancel);
		window.addEventListener("keydown", dismiss);
		return () => {
			clear();
			motion.removeEventListener("change", changeMotion);
			document.removeEventListener("visibilitychange", hide);
			window.removeEventListener("blur", cancel);
			window.removeEventListener("keydown", dismiss);
		};
	}, [cancel, clear, endBounce, later]);

	const visible = available && owner.current === characterId ? scene : null;
	const reaction: CompanionReaction | undefined = !visible
		? undefined
		: visible.shiny
			? "starstruck"
			: visible.phase === "offer"
				? "curious"
				: visible.phase === "finish" ||
						(visible.kind === "guess" && visible.choice === visible.side)
					? "loved"
					: "happy";

	return {
		scene: visible,
		discover,
		start,
		tap,
		cancel,
		reaction,
		announcement,
	};
}
