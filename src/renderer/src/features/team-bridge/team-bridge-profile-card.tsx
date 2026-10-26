import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, Clock, MessageSquare, X } from "lucide-react";
import {
	type CSSProperties,
	type HTMLAttributes,
	type ReactElement,
	type ReactNode,
	cloneElement,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
import { personDisplayLabel, personInitial } from "./team-bridge-model";
import { useTeamBridgeAvatar } from "./use-team-bridge-avatar";

export function TeamBridgeAvatar({
	member,
	label,
	size = 36,
	className,
	fallback,
	selected = false,
}: {
	member: TeamBridgeDirectoryMember;
	label: string;
	size?: number;
	className?: string;
	fallback?: ReactNode;
	selected?: boolean;
}) {
	const image = useTeamBridgeAvatar(member, size <= 64 ? 64 : 256);
	const [failedImage, setFailedImage] = useState<string>();
	return (
		<span
			aria-hidden="true"
			style={{ "--profile-avatar-size": `${size}px` } as CSSProperties}
			className={cn(
				"inline-flex size-[var(--profile-avatar-size)] shrink-0 items-center justify-center overflow-hidden rounded-md font-medium text-body-sm text-ink-muted",
				selected ? "bg-surface" : "bg-media-surface",
				className,
			)}
		>
			{image && image !== failedImage ? (
				<img
					alt=""
					src={image}
					className="size-full object-cover"
					onError={() => setFailedImage(image)}
				/>
			) : (
				(fallback ?? personInitial(label))
			)}
		</span>
	);
}

/**
 * One existing focusable element is the anchor: wrapping a rail button in another
 * button would break both keyboard activation and its conversation-selection action.
 * Hover must not steal focus; keyboard users can tab from the anchor into the card.
 */
export function TeamBridgeProfileCard({
	member,
	label,
	agentName,
	onMessage,
	canMessage = true,
	children,
}: {
	member: TeamBridgeDirectoryMember;
	label: string;
	agentName?: string;
	onMessage: () => void;
	canMessage?: boolean;
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
	const isAgent = agentName !== undefined;
	const displayName = isAgent ? label : member.profile?.display_name || label;

	const clearTimer = () => {
		clearTimeout(timer.current);
		timer.current = undefined;
	};
	const changeOpen = (next: boolean) => {
		clearTimer();
		setOpen(next);
	};
	const leave = () => {
		clearTimer();
		timer.current = setTimeout(() => {
			// Do not remove the Message action while a keyboard user is using it.
			if (!content.current?.contains(document.activeElement)) setOpen(false);
		}, 200);
	};

	useEffect(() => () => clearTimeout(timer.current), []);
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
		"aria-label": t("ui.teamBridge.profile.open_profile", { name: label }),
		onMouseEnter: (event) => {
			children.props.onMouseEnter?.(event);
			if (event.defaultPrevented) return;
			clearTimer();
			timer.current = setTimeout(() => setOpen(true), 400);
		},
		onMouseLeave: (event) => {
			children.props.onMouseLeave?.(event);
			if (!event.defaultPrevented) leave();
		},
		onFocus: (event) => {
			children.props.onFocus?.(event);
			if (!event.defaultPrevented && !restoringFocus.current) changeOpen(true);
		},
		onBlur: (event) => {
			children.props.onBlur?.(event);
			if (
				!event.defaultPrevented &&
				!content.current?.contains(event.relatedTarget)
			)
				leave();
		},
		// Radix composes this unchanged handler with its own click toggle.
		onClick: children.props.onClick,
	});

	return (
		<Popover open={open} onOpenChange={changeOpen} modal={false}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
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
							label={displayName}
							size={64}
							fallback={isAgent ? <Bot size={28} /> : undefined}
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
