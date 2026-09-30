import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";
import {
	COMPANION_DRAG_THRESHOLD,
	type CompanionMood,
} from "../../shared/desktop-companion";
import type { CompanionReaction } from "./companion-art";
import {
	type CompanionTimedReaction,
	getCompanionIdleScenes,
	getCompanionReactionDuration,
	getCompanionScene,
} from "./companion-scenes";

export function useCompanionInteraction(
	mood: CompanionMood = "idle",
	chatOpen = false,
	character = "sprout",
	chatEngaged = chatOpen,
) {
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [pointerReaction, setPointerReaction] = useState<
		"pressed" | "grabbed" | "dragging" | "struggling" | null
	>(null);
	const [dozing, setDozing] = useState(false);
	const [delight, setDelight] = useState<CompanionTimedReaction | null>(null);
	const [gaze, setGaze] = useState({ x: 0, y: 0 });
	const origin = useRef<{
		x: number;
		y: number;
		pointerId: number;
		target: HTMLButtonElement;
		moved: boolean;
		finding: boolean;
		waking: boolean;
	} | null>(null);
	const rub = useRef<{
		x: number;
		direction: number;
		turns: number;
		updated: number;
	} | null>(null);
	const lastPetAt = useRef(Number.NEGATIVE_INFINITY);
	const lastLovedAt = useRef(Number.NEGATIVE_INFINITY);
	const lastRewardAt = useRef(Number.NEGATIVE_INFINITY);
	const affection = useRef<number[]>([]);
	const taps = useRef({ count: 0, started: 0 });
	const attention = useRef({ hovered: false, focused: false });
	const ambient = useRef<CompanionTimedReaction | null>(null);
	const nextScene = useRef(0);
	const cuddles = useRef(0);
	const currentCharacter = useRef(character);
	const reducedMotion = useRef(false);
	const sleeping = useRef(false);
	const chatVisible = useRef(chatOpen);
	const chatActive = useRef(chatEngaged);
	const timers = useRef({ idle: 0, hold: 0, reaction: 0 });
	const frame = useRef<number | null>(null);
	const nextGaze = useRef({ x: 0, y: 0 });
	const currentMood = useRef(mood);

	const clear = useCallback((timer: keyof typeof timers.current) => {
		window.clearTimeout(timers.current[timer]);
		timers.current[timer] = 0;
	}, []);
	const cancelFrame = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
	}, []);
	const play = useCallback(
		(reaction: CompanionTimedReaction) => {
			clear("reaction");
			ambient.current =
				reaction === "stretching" ||
				reaction === "yawning" ||
				reaction === "daydream" ||
				reaction === "peekaboo" ||
				reaction === "peeking" ||
				reaction === "playful" ||
				(reaction !== "cuddle" &&
					getCompanionScene(currentCharacter.current, reaction))
					? reaction
					: null;
			setDelight(reaction);
			timers.current.reaction = window.setTimeout(
				() => {
					timers.current.reaction = 0;
					ambient.current = null;
					setDelight(null);
				},
				getCompanionReactionDuration(currentCharacter.current, reaction),
			);
		},
		[clear],
	);
	const cancelAmbient = useCallback(() => {
		if (!ambient.current) return;
		ambient.current = null;
		clear("reaction");
		setDelight(null);
	}, [clear]);
	const wake = useCallback(
		(stretch = true) => {
			clear("idle");
			cancelAmbient();
			if (sleeping.current && stretch) play("waking");
			sleeping.current = false;
			setDozing(false);
			const canRest = () =>
				(currentMood.current === "idle" ||
					currentMood.current === "complete") &&
				!chatActive.current &&
				!document.hidden;
			if (!canRest()) return;
			const started = window.performance.now();
			const dozeAt = started + 90_000;
			const opportunities = [28_000, 66_000];
			const schedule = () => {
				const now = window.performance.now();
				const next =
					reducedMotion.current || chatVisible.current
						? undefined
						: opportunities.find((at) => started + at > now);
				timers.current.idle = window.setTimeout(
					() => {
						timers.current.idle = 0;
						if (!canRest()) return;
						const remaining = dozeAt - window.performance.now();
						if (remaining <= 0) {
							if (!origin.current) {
								sleeping.current = true;
								setDozing(true);
							}
							return;
						}
						const hour = new Date().getHours();
						const timeOfDay =
							hour >= 5 && hour <= 10
								? "stretching"
								: hour >= 11 && hour <= 20
									? "daydream"
									: "yawning";
						const [signature, ...discoveries] = getCompanionIdleScenes(
							currentCharacter.current,
						);
						const scenes: CompanionTimedReaction[] = signature
							? [
									"peekaboo",
									signature,
									...discoveries.flatMap(
										(scene, i): CompanionTimedReaction[] => [
											i % 2 === 0 ? timeOfDay : "daydream",
											scene,
										],
									),
									"daydream",
									"playful",
								]
							: ["peekaboo", timeOfDay, "playful", "daydream"];
						const scene = scenes[nextScene.current % scenes.length];
						const duration = getCompanionReactionDuration(
							currentCharacter.current,
							scene,
						);
						if (
							!origin.current &&
							!chatVisible.current &&
							!attention.current.hovered &&
							!attention.current.focused &&
							!reducedMotion.current &&
							duration !== undefined &&
							remaining >= duration
						) {
							play(scene);
							nextScene.current++;
						}
						schedule();
					},
					Math.max(0, (next === undefined ? dozeAt : started + next) - now),
				);
			};
			schedule();
		},
		[cancelAmbient, clear, play],
	);
	const approach = useCallback(
		(passive = false) => {
			if (sleeping.current) return;
			if (ambient.current === "peekaboo") play("peeking");
			else if (ambient.current !== "peeking" && (!passive || !ambient.current))
				wake();
		},
		[play, wake],
	);
	const love = useCallback(() => {
		const time = window.performance.now();
		if (time - lastLovedAt.current < 2000) {
			play("happy");
			return;
		}
		lastLovedAt.current = time;
		if (currentMood.current === "idle" || currentMood.current === "complete") {
			affection.current = affection.current
				.filter((at) => time - at <= 20_000)
				.slice(-3);
			affection.current.push(time);
			if (
				affection.current.length === 4 &&
				time - lastRewardAt.current >= 60_000
			) {
				lastRewardAt.current = time;
				affection.current = [];
				play("starstruck");
				return;
			}
		}
		if (
			currentCharacter.current === "inky" &&
			(currentMood.current === "idle" || currentMood.current === "complete") &&
			!chatVisible.current &&
			!document.hidden &&
			!reducedMotion.current &&
			++cuddles.current % 2 === 0
		) {
			play("cuddle");
			return;
		}
		play("loved");
	}, [play]);
	const tap = useCallback(
		(finding = false, waking = false) => {
			const found =
				finding ||
				ambient.current === "peekaboo" ||
				ambient.current === "peeking";
			const wasSleeping = waking || sleeping.current;
			wake();
			if (found || wasSleeping) {
				taps.current.count = 0;
				play(found ? "found" : "waking");
				return;
			}
			const time = window.performance.now();
			if (time - taps.current.started > 1000)
				taps.current = { count: 0, started: time };
			if (++taps.current.count >= 3) {
				taps.current.count = 0;
				love();
			} else play("happy");
		},
		[love, play, wake],
	);
	const cleanup = useCallback(() => {
		clear("idle");
		clear("hold");
		clear("reaction");
		cancelFrame();
		const gesture = origin.current;
		origin.current = null;
		rub.current = null;
		taps.current.count = 0;
		affection.current = [];
		attention.current = { hovered: false, focused: false };
		ambient.current = null;
		sleeping.current = false;
		if (currentCharacter.current === "inky") cuddles.current = 0;
		if (gesture?.target.hasPointerCapture(gesture.pointerId))
			gesture.target.releasePointerCapture(gesture.pointerId);
	}, [cancelFrame, clear]);
	const reset = useCallback(
		(preserveSleep = false) => {
			const wasSleeping = preserveSleep && sleeping.current;
			cleanup();
			sleeping.current = wasSleeping;
			setPointerReaction(null);
			setDelight(null);
			setDozing(wasSleeping);
			setHovered(false);
			setFocused(false);
			setGaze({ x: 0, y: 0 });
			if (!document.hidden && !wasSleeping) wake(false);
		},
		[cleanup, wake],
	);

	function pet(event: PointerEvent<HTMLButtonElement>) {
		const bounds = event.currentTarget.getBoundingClientRect();
		const time = window.performance.now();
		if (
			origin.current ||
			sleeping.current ||
			ambient.current === "peeking" ||
			(currentMood.current !== "idle" && currentMood.current !== "complete") ||
			event.pointerType === "touch" ||
			event.clientY > bounds.top + bounds.height * 0.6
		) {
			rub.current = null;
			return;
		}
		if (time - lastPetAt.current < 1800) return;
		const stroke = rub.current;
		if (!stroke || time - stroke.updated > 900) {
			rub.current = { x: event.screenX, direction: 0, turns: 0, updated: time };
			return;
		}
		const delta = event.screenX - stroke.x;
		if (Math.abs(delta) < 10) return;
		const direction = Math.sign(delta);
		if (stroke.direction && direction !== stroke.direction) stroke.turns++;
		stroke.direction = direction;
		stroke.x = event.screenX;
		stroke.updated = time;
		if (stroke.turns >= 3) {
			lastPetAt.current = time;
			rub.current = null;
			love();
		}
	}

	function look(event: PointerEvent<HTMLButtonElement>) {
		if (event.pointerType === "touch") return;
		const bounds = event.currentTarget.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		nextGaze.current = {
			x: Math.max(
				-1,
				Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
			),
			y: Math.max(
				-1,
				Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
			),
		};
		if (frame.current === null)
			frame.current = requestAnimationFrame(() => {
				frame.current = null;
				setGaze(nextGaze.current);
			});
	}

	useEffect(() => {
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => {
			reducedMotion.current = preference.matches;
			if (preference.matches) cancelAmbient();
		};
		sync();
		preference.addEventListener("change", sync);
		return () => preference.removeEventListener("change", sync);
	}, [cancelAmbient]);
	useEffect(() => {
		if (currentCharacter.current === character) return;
		currentCharacter.current = character;
		nextScene.current = 0;
		cuddles.current = 0;
		lastLovedAt.current = Number.NEGATIVE_INFINITY;
		lastPetAt.current = Number.NEGATIVE_INFINITY;
		reset();
	}, [character, reset]);
	useEffect(() => {
		currentMood.current = mood;
		chatVisible.current = chatOpen;
		chatActive.current = chatEngaged;
		rub.current = null;
		if (chatOpen || (mood !== "idle" && mood !== "complete")) {
			if (currentCharacter.current === "inky") {
				cuddles.current = 0;
				affection.current = [];
				taps.current.count = 0;
			}
			clear("reaction");
			setDelight(null);
			if (origin.current) {
				origin.current.finding = false;
				origin.current.waking = false;
			}
		}
		wake(chatEngaged);
		return () => clear("idle");
	}, [mood, chatOpen, chatEngaged, wake, clear]);
	useEffect(() => {
		const visibility = () => (document.hidden ? reset() : wake());
		const blur = () => reset(true);
		const focus = () => {
			if (
				!sleeping.current &&
				ambient.current !== "peekaboo" &&
				ambient.current !== "peeking"
			)
				wake();
		};
		window.addEventListener("blur", blur);
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			window.removeEventListener("blur", blur);
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", visibility);
			cleanup();
		};
	}, [cleanup, reset, wake]);

	const dragging = pointerReaction === "pressed" ? null : pointerReaction;
	const reaction: CompanionReaction =
		dragging ??
		delight ??
		pointerReaction ??
		(dozing && (mood === "idle" || mood === "complete")
			? "dozing"
			: hovered || focused
				? "curious"
				: "rest");
	return {
		reaction,
		gaze,
		tap,
		wake,
		reset,
		isEngaged: hovered || (focused && !dozing) || pointerReaction !== null,
		handlers: {
			onFocus: (event: FocusEvent<HTMLButtonElement>) => {
				const keyboard =
					!origin.current && event.currentTarget.matches(":focus-visible");
				attention.current.focused = keyboard;
				if (keyboard) {
					if (sleeping.current) wake();
					else approach();
				}
				setFocused(keyboard);
			},
			onBlur: (event: FocusEvent<HTMLButtonElement>) =>
				reset(!event.relatedTarget && !document.hasFocus()),
			onKeyDown: () => {
				attention.current.focused = true;
				setFocused(true);
			},
			onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
				approach(true);
				if (event.pointerType !== "touch") {
					attention.current.hovered = true;
					setHovered(true);
				}
				if (!sleeping.current) look(event);
			},
			onPointerLeave: () => {
				rub.current = null;
				attention.current.hovered = false;
				setHovered(false);
				cancelFrame();
				if (!origin.current) setGaze({ x: 0, y: 0 });
			},
			onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
				if (
					event.button !== 0 ||
					event.ctrlKey ||
					event.isPrimary === false ||
					origin.current
				)
					return;
				attention.current.focused = false;
				setFocused(false);
				rub.current = null;
				const finding =
					ambient.current === "peekaboo" || ambient.current === "peeking";
				const waking = sleeping.current;
				wake(false);
				clear("reaction");
				if (finding) play("peeking");
				else setDelight(null);
				origin.current = {
					x: event.screenX,
					y: event.screenY,
					pointerId: event.pointerId,
					target: event.currentTarget,
					moved: false,
					finding,
					waking,
				};
				setPointerReaction("pressed");
				look(event);
				timers.current.hold = window.setTimeout(() => {
					timers.current.hold = 0;
					if (
						origin.current &&
						!origin.current.moved &&
						!origin.current.finding &&
						!origin.current.waking
					)
						setDelight("happy");
				}, 450);
			},
			onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
				if (
					event.isPrimary === false ||
					(origin.current && origin.current.pointerId !== event.pointerId)
				)
					return;
				approach(true);
				if (!sleeping.current) look(event);
				pet(event);
				if (
					origin.current &&
					!origin.current.moved &&
					Math.hypot(
						event.screenX - origin.current.x,
						event.screenY - origin.current.y,
					) > COMPANION_DRAG_THRESHOLD
				) {
					const gesture = origin.current;
					gesture.moved = true;
					taps.current.count = 0;
					clear("hold");
					cancelAmbient();
					setDelight(null);
					setPointerReaction("grabbed");
					timers.current.hold = window.setTimeout(() => {
						timers.current.hold = 0;
						if (origin.current !== gesture) return;
						setPointerReaction("dragging");
						timers.current.hold = window.setTimeout(() => {
							timers.current.hold = 0;
							if (origin.current === gesture) setPointerReaction("struggling");
						}, 950);
					}, 250);
				}
			},
			onPointerUp: (
				event?: PointerEvent<HTMLButtonElement>,
				greet = true,
			): "tap" | "drag" | null => {
				const gesture = origin.current;
				if (
					!gesture ||
					(event &&
						(event.button !== 0 || event.pointerId !== gesture.pointerId))
				)
					return null;
				origin.current = null;
				clear("hold");
				setPointerReaction(null);
				if (gesture.moved) {
					wake();
					play("landing");
				} else if (greet) tap(gesture.finding, gesture.waking);
				else {
					clear("reaction");
					setDelight(null);
					taps.current.count = 0;
				}
				return gesture.moved ? "drag" : "tap";
			},
			onLostPointerCapture: () => {
				if (origin.current) reset();
			},
			onPointerCancel: () => reset(),
		},
	};
}
