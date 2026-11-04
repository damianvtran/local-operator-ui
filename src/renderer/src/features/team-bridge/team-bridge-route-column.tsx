import { InLeftSidebarHost } from "@shared/components/navigation/left-sidebar-host";
import { SidebarFoot } from "@shared/components/navigation/sidebar-foot";
import { useOtherSurfacesAttention } from "@shared/components/navigation/use-other-surfaces-attention";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { BrowserSafeTooltip } from "@shared/components/ui/browser-safe-tooltip";
import { isolateLtr, t } from "@shared/i18n";
import { ShortcutText } from "@shared/i18n/shortcut-text";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	MAC_PLATFORM,
	navigationChordDirection,
	navigationMouseDirection,
	navigationShortcutLabel,
} from "@shared/navigation-gesture";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { type FC, type ReactNode, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { teamBridgeLeaveTarget } from "./team-bridge-leave";

/**
 * The way out of Team Bridge, at the top of the column it took over.
 *
 * WHY IT EXISTS. On `/team-bridge` the app navigation is replaced by the
 * bridge's own rail (operator, 2026-11-03: "the left sidebar becomes the team
 * bridge view and then there's an arrow back"), so without this row the only
 * way back to chats would be ⌘[ or the command palette.
 *
 * WHAT IT SAYS. The visible word is "Back" and the accessible name is "Leave
 * Team Bridge": the history target varies (Settings, Library, a conversation),
 * so naming a destination would be false half the time, while "leave" is
 * always true. The tooltip carries the chord.
 *
 * WHAT IT DOES. `navigate(-1)` when there is an entry to go back to - what
 * ⌘[ does everywhere - and `/chat` when the window opened on this route (a
 * notification click or a deep link). ⌘[ follows the same rule here (see the
 * listener below). `teamBridgeLeaveTarget` owns the rule and why it reads
 * `history.state.idx`.
 *
 * THE BADGE is the attention the hidden navigation carried for OTHER surfaces
 * (`useOtherSurfacesAttention`): the Slack shape, where the way back shows that
 * something is waiting elsewhere. Its number rides the control's accessible
 * name, because a badge is only a visual convenience.
 */
export const TeamBridgeBackRow: FC = () => {
	useI18nLocale();
	const navigate = useNavigate();
	/*
	 * The arrow is a picture of a direction, not a flex child, so `dir` cannot
	 * flip it: in RTL "back" points right (the same reasoning the sidebar's
	 * collapse chevrons state).
	 */
	const Arrow = useTextDirection() === "rtl" ? ArrowRight : ArrowLeft;
	const { total: attention, lines: attentionLines } =
		useOtherSurfacesAttention();
	const chord = navigationShortcutLabel(
		"back",
		MAC_PLATFORM.test(navigator.platform),
	);
	const leaveName =
		attention > 0
			? t("ui.teamBridge.leave.name_attention", { count: attention })
			: t("ui.teamBridge.leave.name");
	const leave = useCallback(() => {
		if (teamBridgeLeaveTarget(window.history.state) === "history") navigate(-1);
		else navigate("/chat");
	}, [navigate]);
	/*
	 * ⌘[ (and the mouse's back button) LEAVE THE SAME WAY THE BUTTON DOES. The
	 * app-wide gesture hook answers them with `navigate(-1)`, which is right
	 * everywhere else and a dead key here on a cold open: a notification or deep
	 * link opens the window ON this route, so there is no entry to go back to.
	 * This listener is on `document`, which the event reaches before the hook's
	 * `window` listener, and its `preventDefault` is the hook's own "already
	 * claimed" signal (`navigationChordDirection` refuses a prevented event) - so
	 * exactly one of the two moves the router, and the chord and the button can
	 * never disagree. A surface that claimed the chord first (an editor, the run
	 * reader) still keeps it, by the same rule.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (navigationChordDirection(event) !== "back") return;
			event.preventDefault();
			leave();
		};
		const onMouseUp = (event: MouseEvent) => {
			if (navigationMouseDirection(event) !== "back") return;
			event.preventDefault();
			leave();
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("mouseup", onMouseUp);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("mouseup", onMouseUp);
		};
	}, [leave]);
	return (
		/*
		 * 40px, the app's toolbar step, and the same row the navigation's brand
		 * sat in - so the eye finds the way out where the column's first row
		 * always was. `ps-2` + the control's own `px-2` puts the arrow on the
		 * 16px line every rail row's leading mark sits on.
		 */
		<div
			data-team-bridge-back-row=""
			className="flex h-10 shrink-0 items-center px-2"
		>
			<BrowserSafeTooltip
				/*
				 * The chord, then what is waiting elsewhere, one source per line (UX
				 * round 1, U4): the badge says how many, this says what - so a
				 * time-limited browser approval is told apart from notification
				 * backlog without leaving. Each line is the nav row's own name.
				 */
				content={
					<span className="flex flex-col">
						<span>
							<ShortcutText
								text={t("ui.teamBridge.leave.back_shortcut", {
									shortcut: isolateLtr(chord),
								})}
							/>
						</span>
						{attentionLines.map((line) => (
							<span key={line}>{line}</span>
						))}
					</span>
				}
				side="bottom"
			>
				<button
					type="button"
					data-team-bridge-back=""
					onClick={leave}
					aria-label={leaveName}
					aria-keyshortcuts={chord}
					className={cn(
						"inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-body-sm font-medium text-ink-muted",
						"transition-colors duration-fast ease-out-quart",
						"hover:bg-row-hover hover:text-ink",
					)}
				>
					<Arrow size={16} aria-hidden="true" />
					<span>{t("ui.teamBridge.leave.back")}</span>
					<AttentionBadge
						count={attention}
						aria-hidden="true"
						className="ms-1"
					/>
				</button>
			</BrowserSafeTooltip>
		</div>
	);
};

/**
 * The bridge's left column: the back row, then the page's rail, then the
 * app's own foot.
 *
 * IN THE SHELL (the app on `/team-bridge`) it is portaled into the column the
 * navigation vacated, and that column owns the width, the `surface` ground, the
 * top pad and the glass region - so this draws none of them and never doubles
 * the glass alpha. OUTSIDE THE SHELL (a story or a static-markup test that
 * mounts the page alone) `inline` is drawn where the page stands instead, which
 * is the page's own 288px column exactly as it was before the swap.
 *
 * THE FOOT (account row and Settings gear) stays because the column is the
 * same column: the account menu and Settings were one press away before the
 * reader entered Team Bridge, and a column that silently dropped them would
 * read as a different pane rather than as "the same sidebar, showing the
 * bridge". It is drawn only in the shell; the inline copy is the page alone.
 */
export const TeamBridgeRouteColumn: FC<{
	/** The rail body, shared by both placements. */
	children: ReactNode;
	/** The page's own column, used when no shell column is offered. */
	inline: ReactNode;
}> = ({ children, inline }) => (
	<InLeftSidebarHost fallback={inline}>
		<TeamBridgeBackRow />
		{children}
		<SidebarFoot />
	</InLeftSidebarHost>
);

/**
 * The column with no rail yet: Back, a quiet title naming where the reader is,
 * and the foot. Drawn by the page's early states (the eligibility hold, a gate)
 * AND by the shell while the lazy page chunk loads (round 1, m2) - in both, the
 * app navigation is already gone, and an empty `surface` slab with no way out
 * is what this replaces. Outside the shell it renders nothing: the page alone
 * draws exactly the panel it always did.
 *
 * The title is visible here (the populated rail's heading is `sr-only`) because
 * this column has nothing else that names the surface.
 */
export const TeamBridgeEarlyColumn: FC = () => {
	useI18nLocale();
	return (
		<TeamBridgeRouteColumn inline={null}>
			<h1 className="flex h-10 shrink-0 items-center px-4 text-body-sm font-semibold text-ink">
				{t("ui.teamBridge.page.title")}
			</h1>
			<div className="min-h-0 flex-1" />
		</TeamBridgeRouteColumn>
	);
};
