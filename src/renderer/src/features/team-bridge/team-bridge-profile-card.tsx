import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import {
	Popover,
	PopoverAnchor,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { useIdentityAvatar } from "@shared/hooks/use-account-avatar";
import { formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, Clock, MessageSquare, X } from "lucide-react";
import {
	type CSSProperties,
	type HTMLAttributes,
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	cloneElement,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { directoryIdentity } from "../../../../shared/identity-avatar";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
import { personDisplayLabel, personInitial } from "./team-bridge-model";

/*
 * The Bot glyph's size per plate, matching what each surface drew by hand
 * before the glyph moved in here (20 -> 12 ... 64 -> 28), so moving it changes
 * no pixel.
 */
function agentGlyphSize(plate: number): number {
	if (plate <= 20) return 12;
	if (plate <= 24) return 14;
	if (plate <= 36) return 18;
	if (plate <= 56) return 26;
	return 28;
}

/**
 * One Team Bridge identity's plate: photo, else placeholder.
 *
 * `kind` IS REQUIRED, AND THE AGENT GLYPH IS DECIDED HERE (2026-10-30). An
 * agent and its owner share one directory row, so the plate cannot tell from
 * `member` which of the two it shows. Before this, every surface passed its
 * own `agent ? <Bot/> : …` fallback, and the owner's photo, fetched by the
 * owner's account id, replaced it. That is how "Aida (Damian Tran)" wore
 * Damian's face. The picture now comes only from `resolveIdentityAvatar`
 * (`src/shared/identity-avatar.ts`), which never gives an agent an account
 * photo, and the agent placeholder is always the Bot glyph. `fallback`
 * customizes a PERSON's placeholder only, so no surface can opt an agent out.
 */
export function TeamBridgeAvatar({
	member,
	kind,
	endpointId,
	label,
	size = 36,
	className,
	fallback,
	selected = false,
}: {
	member: TeamBridgeDirectoryMember;
	kind: "human" | "agent";
	/** The agent's endpoint, when the surface knows it better than the row. */
	endpointId?: string;
	label: string;
	size?: number;
	className?: string;
	/** A person's placeholder; ignored for an agent (always the Bot glyph). */
	fallback?: ReactNode;
	selected?: boolean;
}) {
	const image = useIdentityAvatar(
		directoryIdentity(member, kind, endpointId),
		size <= 64 ? 64 : 256,
	);
	const [failedImage, setFailedImage] = useState<string>();
	const placeholder =
		kind === "agent" ? (
			<Bot size={agentGlyphSize(size)} />
		) : (
			(fallback ?? personInitial(label))
		);
	/*
	 * THE AGENT MARK THAT SURVIVES A PICTURE (design review round 1, D1/D2).
	 * An agent's plate differs from a person's only by its CONTENTS, so the day
	 * `useIdentityAvatar` can resolve an endpoint picture the plate becomes "a
	 * picture" again and says nothing about kind — the visual half of
	 * 2026-10-30's defect, with no glyph to carry it. The ring is drawn on an
	 * overlay ABOVE the image (an inset outline on the plate itself would be
	 * painted under the `<img>` child), so it is the one part of an agent plate
	 * no picture can replace. One rule, stated here and nowhere else: an agent
	 * is accent, and its glyph is accent everywhere — the pair this repo
	 * already registered for agents (`bg-media-surface` + `text-accent`,
	 * 4.23:1 light / 8.42:1 dark, above the 3:1 non-text floor), which is why
	 * the rail's chief rows and the message row's directory-less agent plate
	 * keep the ink they had (design round 1, D2: apply it, do not fork it).
	 */
	return (
		<span
			aria-hidden="true"
			/* The profile card's avatar fast path finds the avatar inside a wider
			   anchor by this marker (see `fastOpenDelayMs`). */
			data-team-bridge-avatar=""
			style={{ "--profile-avatar-size": `${size}px` } as CSSProperties}
			className={cn(
				"relative inline-flex size-[var(--profile-avatar-size)] shrink-0 items-center justify-center overflow-hidden rounded-md font-medium text-body-sm",
				kind === "agent" ? "text-accent" : "text-ink-muted",
				selected ? "bg-surface" : "bg-media-surface",
				className,
			)}
		>
			{kind === "agent" && (
				<span
					data-agent-mark=""
					className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-accent ring-inset"
				/>
			)}
			{image && image !== failedImage ? (
				<img
					alt=""
					src={image}
					className="size-full object-cover"
					onError={() => setFailedImage(image)}
				/>
			) : (
				placeholder
			)}
		</span>
	);
}

/**
 * One existing focusable element is the anchor: wrapping a rail button in another
 * button would break both keyboard activation and its conversation-selection action.
 * Hover must not steal focus; keyboard users can tab from the anchor into the card.
 *
 * TWO KINDS OF ANCHOR. By default the anchor IS the card's trigger: a message-list
 * avatar or sender name exists to show the profile, so it is named "Open profile
 * for …", opens on focus, and click toggles the card (Radix's trigger behaviour).
 *
 * A rail row is different: its click must open the conversation (operator report
 * 2026-10-26 - the click focused the row, focus opened the card, and Radix's click
 * toggle consumed the press, so selection never happened). Such a row passes
 * `toggleOnClick={false}` and `openOnFocus={false}`. It then becomes a Radix
 * `PopoverAnchor` rather than a `PopoverTrigger`, so the card is positioned on the
 * row but Radix composes no click toggle into it. The row keeps its own accessible
 * name and click action, and a click closes the card and cancels any pending dwell.
 * The pointer reaches the card through a long `openDelayMs` dwell. With
 * `fastOpenDelayMs`, the avatar inside the row opens it at the normal delay
 * instead. The avatar gets a timer rather than its own trigger because a Radix
 * trigger nested in the row button would be a control inside a control. Focus no
 * longer opens the card, so the keyboard route is the platform's "what can I do
 * with this" key: the context-menu key or Shift+F10 opens it and moves focus into
 * it, the same pairing the transcript's link toolbar and message rows use.
 */
export function TeamBridgeProfileCard({
	member,
	label,
	kind,
	onMessage,
	canMessage = true,
	openDelayMs = 400,
	fastOpenDelayMs,
	toggleOnClick = true,
	openOnFocus = true,
	children,
}: {
	member: TeamBridgeDirectoryMember;
	label: string;
	/**
	 * WHOSE CARD THIS IS, REQUIRED. An agent and its owner share one directory
	 * row, so neither the row nor an optional name can say which of the two the
	 * card pictures. This used to be inferred from an optional `agentName`
	 * prop — a pure kind proxy with no other reader — which meant a surface
	 * that pictured an agent and forgot the name fell
	 * through to `kind="human"` and drew the OWNER'S PHOTO in the popover — the
	 * reported defect, on the surface it was reported from (agent review round
	 * 1, F3). Omission is now a type error, the same guarantee the plate has.
	 */
	kind: "human" | "agent";
	onMessage: () => void;
	canMessage?: boolean;
	/** Pointer dwell on the anchor before the card opens. */
	openDelayMs?: number;
	/** Dwell when the pointer is over the anchor's avatar; unset = no fast path. */
	fastOpenDelayMs?: number;
	/** `false` makes the anchor a positioning anchor only: its click is its own. */
	toggleOnClick?: boolean;
	/** `false` = focus does not open the card; Shift+F10 / context-menu key does. */
	openOnFocus?: boolean;
	children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
	const locale = useI18nLocale();
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(() => new Date());
	const headingId = useId();
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const content = useRef<HTMLDivElement>(null);
	const restoringFocus = useRef(false);
	const contentOwnedFocus = useRef(false);
	const anchorNode = useRef<HTMLElement | null>(null);
	// Dwell bookkeeping for the avatar fast path: when the pointer entered the
	// anchor, and whether the pending timer is the avatar's shorter one.
	const hoveredSince = useRef<number | undefined>(undefined);
	const fastArmed = useRef(false);
	const focusContentOnOpen = useRef(false);
	const isAgent = kind === "agent";
	const displayName = isAgent ? label : member.profile?.display_name || label;

	const clearTimer = () => {
		clearTimeout(timer.current);
		timer.current = undefined;
	};
	const changeOpen = (next: boolean) => {
		clearTimer();
		// A dismissed card (click, Escape, Message) stays closed until the pointer
		// leaves and comes back: moving within the row must not re-arm the dwell.
		if (!next) hoveredSince.current = undefined;
		setOpen(next);
	};
	const leave = () => {
		clearTimer();
		timer.current = setTimeout(() => {
			timer.current = undefined;
			// Do not remove the Message action while a keyboard user is using it.
			if (!content.current?.contains(document.activeElement)) setOpen(false);
		}, 200);
	};

	const arm = (delay: number) => {
		clearTimer();
		timer.current = setTimeout(
			() => {
				timer.current = undefined;
				setOpen(true);
			},
			Math.max(0, delay),
		);
	};
	/*
	 * Re-arm for wherever the pointer now is inside the anchor. Leaving the avatar
	 * for the rest of the row resumes the LONG dwell from when the row was
	 * entered rather than restarting it, so the avatar does not make the row slower.
	 */
	const trackPointer = (target: EventTarget, anchor: HTMLElement) => {
		if (open || hoveredSince.current === undefined) return;
		const onAvatar =
			fastOpenDelayMs !== undefined &&
			target instanceof Element &&
			anchor.contains(target.closest("[data-team-bridge-avatar]"));
		if (onAvatar === fastArmed.current && timer.current !== undefined) return;
		fastArmed.current = onAvatar;
		const elapsed = Date.now() - hoveredSince.current;
		const remaining = openDelayMs - elapsed;
		arm(
			onAvatar && fastOpenDelayMs !== undefined
				? Math.min(fastOpenDelayMs, remaining)
				: remaining,
		);
	};

	useEffect(() => () => clearTimeout(timer.current), []);
	/*
	 * Every close forgets the pointer's entry time, not just `changeOpen(false)`.
	 * `leave()` closes through `setOpen` directly (a blur out of the card while the
	 * pointer still rests on the row), and a surviving `hoveredSince` would make
	 * the next avatar/name crossing compute a negative remaining dwell and reopen
	 * the card at 0 ms. Like any dismissal, the card then stays closed until the
	 * pointer leaves the row and comes back (review R1-2, PR #1435).
	 */
	useEffect(() => {
		if (open) return;
		clearTimeout(timer.current);
		timer.current = undefined;
		hoveredSince.current = undefined;
	}, [open]);
	useEffect(() => {
		if (!open || !focusContentOnOpen.current) return;
		focusContentOnOpen.current = false;
		// The reader pressed a key to ACT on the card, so focus lands on its
		// primary action (Message) or, without one, its Close button.
		const id = requestAnimationFrame(() => {
			const buttons = content.current?.querySelectorAll<HTMLElement>("button");
			buttons?.[buttons.length - 1]?.focus();
		});
		return () => cancelAnimationFrame(id);
	}, [open]);
	useEffect(() => {
		if (!open) return;
		setNow(new Date());
		const interval = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(interval);
	}, [open]);

	let localTime: string | undefined;
	if (member.profile?.timezone) {
		try {
			localTime = formatTime(
				now,
				{
					timeZone: member.profile.timezone,
					hour: "numeric",
					minute: "2-digit",
				},
				locale,
			);
		} catch {
			// Directory data can contain an obsolete zone; omit it rather than
			// silently presenting the viewer's clock as the member's local time.
		}
	}

	const trigger = cloneElement(children, {
		...(toggleOnClick
			? {
					"aria-label": t("ui.teamBridge.profile.open_profile", {
						name: label,
					}),
				}
			: {
					// An anchor is not a Radix trigger, so nothing else declares the
					// card: name both keys the row answers to (on a Mac keyboard F10
					// needs Fn) and expose the card's state (review R1-3, PR #1435).
					"aria-keyshortcuts": "Shift+F10 ContextMenu",
					"aria-expanded": open,
				}),
		onMouseEnter: (event: MouseEvent<HTMLElement>) => {
			children.props.onMouseEnter?.(event);
			if (event.defaultPrevented) return;
			hoveredSince.current = Date.now();
			fastArmed.current = false;
			if (open) {
				clearTimer();
				return;
			}
			arm(openDelayMs);
			trackPointer(event.target, event.currentTarget);
		},
		onMouseOver: (event: MouseEvent<HTMLElement>) => {
			children.props.onMouseOver?.(event);
			if (!event.defaultPrevented)
				trackPointer(event.target, event.currentTarget);
		},
		onMouseLeave: (event: MouseEvent<HTMLElement>) => {
			children.props.onMouseLeave?.(event);
			hoveredSince.current = undefined;
			if (!event.defaultPrevented) leave();
		},
		onFocus: (event) => {
			children.props.onFocus?.(event);
			if (!openOnFocus) return;
			if (!event.defaultPrevented && !restoringFocus.current) changeOpen(true);
		},
		onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
			children.props.onKeyDown?.(event);
			if (openOnFocus || event.defaultPrevented) return;
			if (
				event.key !== "ContextMenu" &&
				!(event.shiftKey && event.key === "F10")
			)
				return;
			// Chromium would otherwise also raise the native context menu.
			event.preventDefault();
			// Remembered so closing the card can hand focus back to this row.
			anchorNode.current = event.currentTarget;
			focusContentOnOpen.current = true;
			changeOpen(true);
		},
		onBlur: (event) => {
			children.props.onBlur?.(event);
			if (
				!event.defaultPrevented &&
				!content.current?.contains(event.relatedTarget)
			)
				leave();
		},
		onClick: toggleOnClick
			? // Radix composes this unchanged handler with its own click toggle.
				children.props.onClick
			: (event: MouseEvent<HTMLElement>) => {
					// The anchor's own action wins: a click selects, and neither an
					// open card nor a pending dwell outlives it.
					children.props.onClick?.(event);
					changeOpen(false);
				},
	});

	return (
		<Popover open={open} onOpenChange={changeOpen} modal={false}>
			{toggleOnClick ? (
				<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			) : (
				<PopoverAnchor asChild>{trigger}</PopoverAnchor>
			)}
			<PopoverContent
				ref={content}
				aria-labelledby={headingId}
				data-profile-card=""
				data-profile-kind={isAgent ? "agent" : "human"}
				collisionPadding={16}
				className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-2rem))] w-80 max-w-[min(var(--radix-popover-content-available-width),calc(100vw-2rem))] flex-col p-0"
				onMouseEnter={clearTimer}
				onMouseLeave={leave}
				onFocusCapture={() => {
					contentOwnedFocus.current = true;
					clearTimer();
				}}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) {
						contentOwnedFocus.current = false;
						leave();
					}
				}}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => {
					// A pointer-only preview never owned focus and must not take it
					// from the composer when its leave timer expires.
					if (!contentOwnedFocus.current) {
						event.preventDefault();
						return;
					}
					// Escape restores the anchor's focus. That restoration is not a
					// new request to open the card, unlike a later keyboard visit.
					contentOwnedFocus.current = false;
					if (!toggleOnClick) {
						// An anchor is not a Radix trigger, so Radix has nothing to
						// return focus to; hand it back to the row the key came from.
						event.preventDefault();
						anchorNode.current?.focus();
						return;
					}
					restoringFocus.current = true;
					queueMicrotask(() => {
						restoringFocus.current = false;
					});
				}}
			>
				{/* Collision placement alone cannot fit a card taller than the space
				    above or below its anchor. Shrink the inner scrollport to Radix's
				    measured space so the header starts in view and every action stays
				    reachable, including in narrow embedded Storybook viewports. */}
				<div
					data-profile-scroll=""
					className="min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3"
				>
					<div className="flex items-start justify-between gap-3">
						<TeamBridgeAvatar
							member={member}
							kind={kind}
							label={displayName}
							size={64}
						/>
						<PopoverClose asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("ui.teamBridge.profile.close_profile")}
							>
								<X size={16} aria-hidden="true" />
							</Button>
						</PopoverClose>
					</div>
					<div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
						<h2 id={headingId} className="text-body font-semibold text-ink">
							{displayName}
						</h2>
						{member.profile?.title && (
							<p className="text-body-sm text-ink">{member.profile.title}</p>
						)}
					</div>
					<Badge>
						{t(
							isAgent
								? "ui.teamBridge.profile.agent_badge"
								: "ui.teamBridge.profile.human_badge",
						)}
					</Badge>
					{isAgent && (
						<p className="text-body-sm text-ink-muted [overflow-wrap:anywhere]">
							{t("ui.teamBridge.profile.owned_by", {
								name: personDisplayLabel(member),
							})}
						</p>
					)}
					{member.profile?.description && (
						<p className="line-clamp-6 whitespace-pre-wrap text-body-sm text-ink [overflow-wrap:anywhere]">
							{member.profile.description}
						</p>
					)}
					{localTime && (
						<p className="flex items-center gap-2 text-body-sm text-ink-muted">
							<Clock size={14} aria-hidden="true" />
							{t("ui.teamBridge.profile.local_time", { time: localTime })}
						</p>
					)}
					{canMessage && (
						<Button
							className="w-full"
							onClick={() => {
								changeOpen(false);
								onMessage();
							}}
						>
							<MessageSquare size={16} aria-hidden="true" />
							{t("ui.teamBridge.profile.message")}
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
