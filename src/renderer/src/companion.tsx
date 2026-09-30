import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { Bell, CircleAlert, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { COMPANION_OFFLINE } from "../../shared/desktop-companion";
import type {
	CompanionBridge,
	CompanionChatView,
	CompanionMotion,
} from "../../shared/desktop-companion";
import "./assets/fonts/fonts.css";
import "./styles/index.css";
import "./companion.css";
import {
	type CompanionAppearance,
	isBuiltinCompanion,
} from "../../shared/companion-skin";
import { CompanionArt, type CompanionReaction } from "./companion-art";
import { CompanionChat } from "./companion-chat";
import { useCompanionInteraction } from "./companion-interaction";
import { useCompanionNotifications } from "./companion-notifications";
import { useCompanionPlay } from "./companion-play";
import {
	CompanionAffection,
	CompanionDream,
	CompanionPlayArt,
} from "./companion-play-art";

declare global {
	interface Window {
		companion: CompanionBridge;
	}
}

const reactionMessages: Partial<Record<CompanionReaction, string>> = {
	cuddle: "gives you a little hug.",
	loved: "sends you a heart.",
	starstruck: "lights up with delight.",
	happy: "looks happy.",
};
const playHints = {
	guess: {
		label: "Left / Right",
		description:
			"Choose a side. Click left or right, or use Left or Right. Escape ends play.",
	},
	bounce: {
		label: "Enter to bounce",
		description: "Click or press Enter to keep the ball up. Escape ends play.",
	},
	snack: {
		label: "Enter to share",
		description: "Click or press Enter to offer the treat. Escape ends play.",
	},
};

function syncTheme(): void {
	try {
		const saved = JSON.parse(
			localStorage.getItem("ui-preferences-storage") ?? "null",
		);
		applyThemeToDocument(
			(saved?.state?.themeName ?? DEFAULT_THEME) as ThemeName,
		);
	} catch {
		applyThemeToDocument(DEFAULT_THEME);
	}
}
syncTheme();
window.addEventListener("storage", syncTheme);

function useCompanionValue<T>(
	initial: T,
	read: () => Promise<T>,
	subscribe: (listener: (value: T) => void) => () => void,
) {
	const [value, setValue] = useState(initial);
	useEffect(() => {
		let received = false;
		const unsubscribe = subscribe((next) => {
			received = true;
			setValue(next);
		});
		void read().then((next) => {
			if (!received && next) setValue(next);
		});
		return () => {
			received = true;
			unsubscribe();
		};
	}, [read, subscribe]);
	return value;
}

function Companion() {
	const state = useCompanionValue(
		COMPANION_OFFLINE,
		window.companion.getState,
		window.companion.onState,
	);
	const appearance = useCompanionValue<CompanionAppearance>(
		{
			id: "sprout",
			name: "Sprout",
		},
		window.companion.getAppearance,
		window.companion.onAppearance,
	);
	const chat = useCompanionValue<CompanionChatView>(
		{
			open: false,
			snapshot: {
				sessionId: null,
				title: "Companion chat",
				messages: [],
				status: "idle",
				error: null,
				canSend: true,
			},
		},
		window.companion.getChat,
		window.companion.onChat,
	);
	const [chatFocused, setChatFocused] = useState(false);
	const [chatEngaged, setChatEngaged] = useState(false);
	useEffect(() => {
		if (!chat.open || chatFocused) {
			setChatEngaged(chat.open && chatFocused);
			return;
		}
		const timer = window.setTimeout(() => setChatEngaged(false), 1200);
		return () => window.clearTimeout(timer);
	}, [chat.open, chatFocused]);
	const [motion, setMotion] = useState<CompanionMotion>("rest");
	const play = useCompanionPlay(
		!chat.open &&
			motion === "rest" &&
			["idle", "complete", "offline"].includes(state.mood),
		appearance.id,
	);
	const playing = play.scene !== null;
	const interaction = useCompanionInteraction(
		state.mood,
		chat.open || playing,
		appearance.id,
		chatEngaged || playing,
	);
	useEffect(() => {
		if (playing)
			document
				.querySelector<HTMLButtonElement>(".companion-character")
				?.focus({ preventScroll: true });
	}, [playing]);
	useEffect(() => {
		if (["grabbed", "dragging", "struggling"].includes(interaction.reaction))
			play.cancel();
	}, [interaction.reaction, play.cancel]);
	const character = isBuiltinCompanion(appearance.id)
		? appearance.id
		: "sprout";
	const reaction =
		motion !== "rest"
			? motion
			: (play.reaction ??
				(chat.open &&
				chatFocused &&
				(interaction.reaction === "rest" || interaction.reaction === "curious")
					? "listening"
					: interaction.reaction));
	const notifications = state.notifications;
	const urgentCount = notifications.filter(
		(item) => item.kind !== "complete",
	).length;
	const notice = useCompanionNotifications(
		notifications,
		chatEngaged || playing || interaction.isEngaged || motion !== "rest",
		state.mood !== "offline",
	);
	const notificationLabel = `${notifications.length} ${notifications.length === 1 ? "task" : "tasks"} with notifications${urgentCount ? `, ${urgentCount} ${urgentCount === 1 ? "needs" : "need"} you` : ""}`;
	const sleeping = reaction === "dozing";
	const [failedArt, setFailedArt] = useState({
		id: appearance.id,
		sources: [] as string[],
	});
	const failedImages = failedArt.id === appearance.id ? failedArt.sources : [];
	const customImage = [
		sleeping ? appearance.frames?.sleeping : undefined,
		appearance.frames?.[play.scene ? "idle" : state.mood],
		appearance.frames?.idle,
	].find((source) => source && !failedImages.includes(source));
	const reactionMessage = reactionMessages[reaction];
	const acknowledgment = playing
		? play.announcement
		: reaction === "found"
			? `You found ${appearance.name}.`
			: reactionMessage
				? `${appearance.name} ${reactionMessage}`
				: "";
	const playHint = play.scene ? playHints[play.scene.kind] : undefined;
	const petHint = sleeping
		? "Sleeping. Click to wake."
		: `${state.label}. Click to pet.`;
	const characterHint =
		playHint?.description ??
		`${petHint} Use the chat button to talk. Drag or use arrow keys to move. Right-click for options.`;
	const showMenu = () => {
		play.cancel();
		interaction.reset();
		window.companion.showMenu();
	};
	useEffect(() => {
		const unsubscribe = window.companion.onMotion(setMotion);
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => window.companion.setReducedMotion(preference.matches);
		const focus = () =>
			setChatFocused(!!document.activeElement?.closest(".companion-chat"));
		const blur = () => setChatFocused(false);
		window.addEventListener("focus", focus);
		window.addEventListener("blur", blur);
		preference.addEventListener("change", sync);
		sync();
		return () => {
			unsubscribe();
			window.removeEventListener("focus", focus);
			window.removeEventListener("blur", blur);
			preference.removeEventListener("change", sync);
		};
	}, []);
	const wasChatOpen = useRef(false);
	useEffect(() => {
		if (wasChatOpen.current && !chat.open)
			document
				.querySelector<HTMLButtonElement>(".companion-character")
				?.focus({ preventScroll: true });
		wasChatOpen.current = chat.open;
	}, [chat.open]);
	useEffect(() => {
		const hover = (event: PointerEvent) => {
			window.companion.setInteractive(
				event.target instanceof Element &&
					!!event.target.closest("button, .companion-chat"),
			);
		};
		const leave = () => window.companion.setInteractive(false);
		document.addEventListener("pointermove", hover);
		document.addEventListener("pointerleave", leave);
		return () => {
			document.removeEventListener("pointermove", hover);
			document.removeEventListener("pointerleave", leave);
		};
	}, []);

	useEffect(() => {
		if (!chat.open) return;
		const root = document.querySelector<HTMLElement>(".companion");
		const card = document.querySelector<HTMLElement>(".companion-chat");
		const pet = document.querySelector<HTMLElement>(".companion-character");
		if (!root || !card || !pet) return;
		const measure = () => {
			const styles = getComputedStyle(root);
			window.companion.resizeChat(
				Math.ceil(
					card.getBoundingClientRect().height +
						pet.getBoundingClientRect().height +
						Number.parseFloat(styles.paddingTop) +
						Number.parseFloat(styles.paddingBottom) +
						Number.parseFloat(styles.rowGap),
				),
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(card);
		observer.observe(pet);
		measure();
		return () => observer.disconnect();
	}, [chat.open]);

	return (
		<main
			className={cn("companion")}
			data-mood={state.mood}
			data-play={play.scene?.kind}
			onFocusCapture={(event) =>
				setChatFocused(!!event.target.closest(".companion-chat"))
			}
			onBlurCapture={(event) =>
				setChatFocused(
					event.relatedTarget instanceof Element &&
						!!event.relatedTarget.closest(".companion-chat"),
				)
			}
		>
			<div
				className={cn("companion-pet")}
				data-engaged={interaction.isEngaged}
				data-notifying={notice.nudging || undefined}
			>
				<button
					type="button"
					className={cn("companion-character")}
					{...interaction.handlers}
					data-reaction={reaction}
					aria-label={`${appearance.name}. ${characterHint}`}
					title={state.mood === "offline" ? state.label : undefined}
					onContextMenu={(event) => {
						event.preventDefault();
						showMenu();
					}}
					onPointerDown={(event) => {
						if (
							event.button !== 0 ||
							event.ctrlKey ||
							event.isPrimary === false
						)
							return;
						interaction.handlers.onPointerDown(event);
						event.currentTarget.setPointerCapture(event.pointerId);
						window.companion.setReducedMotion(
							window.matchMedia("(prefers-reduced-motion: reduce)").matches,
						);
						window.companion.drag("start");
					}}
					onPointerMove={(event) => {
						interaction.handlers.onPointerMove(event);
						if (event.currentTarget.hasPointerCapture(event.pointerId))
							window.companion.drag("move");
					}}
					onPointerUp={(event) => {
						const gesture = interaction.handlers.onPointerUp(event, !playing);
						if (gesture === null) return;
						if (gesture === "tap" && play.scene) {
							const bounds = event.currentTarget.getBoundingClientRect();
							play.tap(
								event.clientX < bounds.left + bounds.width / 2
									? "left"
									: "right",
							);
						} else if (gesture === "tap") play.discover();
						else if (gesture === "drag") play.cancel();
						if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
						window.companion.drag("end");
						event.currentTarget.releasePointerCapture(event.pointerId);
					}}
					onPointerCancel={() => {
						play.cancel();
						interaction.handlers.onPointerCancel();
						window.companion.drag("cancel");
					}}
					onLostPointerCapture={() => {
						interaction.handlers.onLostPointerCapture();
						window.companion.drag("cancel");
					}}
					onClick={(event) => {
						if (event.detail !== 0) return;
						if (playing) play.tap();
						else {
							interaction.tap();
							play.discover();
						}
					}}
					onKeyDown={(event) => {
						interaction.handlers.onKeyDown();
						if (event.repeat && (event.key === "Enter" || event.key === " ")) {
							event.preventDefault();
							return;
						}
						if (
							event.key === "ContextMenu" ||
							(event.shiftKey && event.key === "F10")
						) {
							event.preventDefault();
							showMenu();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							play.cancel();
							interaction.reset();
							if (chat.open) window.companion.collapseChat();
						}
						if (
							play.scene?.kind === "guess" &&
							(event.key === "ArrowLeft" || event.key === "ArrowRight")
						) {
							event.preventDefault();
							if (!event.repeat)
								play.tap(event.key === "ArrowLeft" ? "left" : "right");
							return;
						}
						if (
							event.key === "ArrowLeft" ||
							event.key === "ArrowRight" ||
							event.key === "ArrowUp" ||
							event.key === "ArrowDown"
						) {
							event.preventDefault();
							play.cancel();
							interaction.wake();
							window.companion.nudge(event.key);
						}
					}}
				>
					{customImage ? (
						<>
							<img
								className={cn(
									"companion-custom-art",
									appearance.pixelated && "companion-custom-pixel",
									sleeping && "companion-custom-sleeping",
								)}
								src={customImage}
								onError={() =>
									setFailedArt((failed) => ({
										id: appearance.id,
										sources: [
											...(failed.id === appearance.id ? failed.sources : []),
											customImage,
										],
									}))
								}
								alt=""
								draggable={false}
							/>
							{sleeping && customImage !== appearance.frames?.sleeping && (
								<svg
									className={cn("companion-custom-sleep")}
									viewBox="0 0 26 30"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M2 17h8l-8 8h8m4-21h9l-9 9h9" />
								</svg>
							)}
							{!playing &&
								(reaction === "loved" || reaction === "starstruck") && (
									<CompanionAffection reaction={reaction} />
								)}
						</>
					) : (
						<CompanionArt
							character={character}
							mood={play.scene ? "idle" : state.mood}
							gaze={interaction.gaze}
							reaction={reaction}
						/>
					)}
					{play.scene && (
						<CompanionPlayArt scene={play.scene} character={character} />
					)}
					{play.scene?.phase === "offer" && (
						<span className={cn("companion-play-hint")} aria-hidden="true">
							{playHint?.label}
						</span>
					)}
					{sleeping && !customImage && <CompanionDream character={character} />}
				</button>
				{notifications.length > 0 && (
					<Button
						type="button"
						variant={urgentCount ? "primary" : "secondary"}
						size="icon-sm"
						className={cn(
							"companion-task-toggle rounded-full text-meta font-medium tabular-nums",
						)}
						aria-label={notificationLabel}
						aria-haspopup={notifications.length > 1 ? "menu" : undefined}
						title={
							notifications.length === 1
								? `${notifications[0].title} — ${notifications[0].label}`
								: notificationLabel
						}
						onClick={() => {
							notice.acknowledge();
							play.cancel();
							interaction.reset();
							window.companion.showNotifications();
						}}
					>
						{notifications.length > 1 ? (
							notifications.length > 99 ? (
								"99+"
							) : (
								notifications.length
							)
						) : urgentCount ? (
							<CircleAlert aria-hidden="true" />
						) : (
							<Bell aria-hidden="true" />
						)}
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					size="icon-sm"
					className={cn("companion-chat-toggle rounded-full")}
					hidden={chat.open}
					aria-label={`Chat with ${appearance.name}`}
					title="Chat"
					onClick={() => window.companion.openChat()}
				>
					<MessageCircle aria-hidden="true" />
				</Button>
			</div>
			<output className={cn("sr-only")} aria-live="polite">
				{acknowledgment}
			</output>
			<output
				className={cn("companion-notice-announcement sr-only")}
				aria-live="polite"
				aria-atomic="true"
			>
				{notice.announcement}
			</output>
			<CompanionChat
				snapshot={chat.snapshot}
				open={chat.open}
				onSend={window.companion.sendMessage}
				onShowConversations={window.companion.showChatMenu}
				onCollapse={() => window.companion.collapseChat()}
				onExpand={() => window.companion.expandChat()}
			/>
		</main>
	);
}

const container = document.getElementById("companion");
if (container) createRoot(container).render(<Companion />);
