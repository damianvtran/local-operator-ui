import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import parse, {
	type DOMNode,
	Element,
	type HTMLReactParserOptions,
	domToReact,
} from "html-react-parser";
import { createElement, useRef, useState } from "react";
import { create } from "zustand";
import type {
	CombinedUpdateFailure,
	CombinedUpdateTargets,
} from "../../../../../shared/combined-update";

export type CombinedOffer = {
	targets: CombinedUpdateTargets;
	appNotes: string | null;
	serverNotes: string | null;
};

// Settings and the update cards are in separate trees. Only the app-root
// updater receives both events; there is one transient offer and one dialog.
// Keep the offer that was reviewed so a feed refresh cannot substitute a new
// target beneath the user's confirmation.
export const useCombinedUpdateSurface = create<{
	offer: CombinedOffer | null;
	review: CombinedOffer | null;
	trigger: HTMLButtonElement | null;
	setOffer: (offer: CombinedOffer | null) => void;
	open: (trigger: HTMLButtonElement) => void;
	close: () => void;
}>((set) => ({
	offer: null,
	review: null,
	trigger: null,
	setOffer: (offer) => set({ offer }),
	open: (trigger) =>
		set((state) =>
			state.review || !state.offer ? state : { review: state.offer, trigger },
		),
	close: () => set({ review: null }),
}));

export function CombinedUpdateTrigger({
	className,
	settings = false,
}: { className?: string; settings?: boolean }) {
	useI18nLocale();
	const available = useCombinedUpdateSurface((state) => state.offer !== null);
	const open = useCombinedUpdateSurface((state) => state.open);
	if (!available) return null;
	return (
		<Button
			variant={settings ? "primary" : "tonal"}
			size={settings ? undefined : "sm"}
			className={className}
			aria-haspopup="dialog"
			onClick={(event) => open(event.currentTarget)}
		>
			{t("ui.common.updates.combined.install_all")}
		</Button>
	);
}

const noteElements = new Set([
	"p",
	"ul",
	"ol",
	"li",
	"strong",
	"em",
	"b",
	"i",
	"code",
	"pre",
	"br",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]);
const noteHeading = /^h[1-6]$/;
const noteOptions: HTMLReactParserOptions = {
	replace(node) {
		if (!(node instanceof Element)) return;
		// The feed is data, not app HTML. Keep formatting without event handlers,
		// images, arbitrary links, or other active elements/attributes. The only
		// links in this dialog are to the two official repos, built below.
		if (node.name === "script" || node.name === "style") return <></>;
		const children = domToReact(node.children as DOMNode[], noteOptions);
		if (node.name === "br") return <br />;
		if (!noteElements.has(node.name)) return <>{children}</>;
		const name = noteHeading.test(node.name) ? "strong" : node.name;
		return createElement(name, null, children);
	},
};

export function CombinedUpdateDialog() {
	useI18nLocale();
	const review = useCombinedUpdateSurface((state) => state.review);
	const offer = useCombinedUpdateSurface((state) => state.offer);
	const close = useCombinedUpdateSurface((state) => state.close);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<
		CombinedUpdateFailure | "request_failed" | null
	>(null);
	const activeAttempt = useRef(false);
	const cancelButton = useRef<HTMLButtonElement>(null);
	if (!review) return null;
	const { targets, appNotes, serverNotes } = review;
	const current =
		offer?.targets.app === targets.app &&
		offer.targets.server === targets.server;
	const displayFailure =
		failure ?? (!pending && !current ? "offer_changed" : null);

	const dismiss = () => {
		if (activeAttempt.current) return;
		setFailure(null);
		close();
	};
	const confirm = async () => {
		if (activeAttempt.current || !current) return;
		activeAttempt.current = true;
		setPending(true);
		setFailure(null);
		let handedOff = false;
		try {
			const result = await window.api.updater.installCombinedUpdate(targets);
			handedOff = result.status === "handoff";
			if (result.status !== "handoff") setFailure(result.status);
		} catch {
			setFailure("request_failed");
		} finally {
			// Once handed off the normal install path owns closure and relaunch.
			// Never repaint a live confirm button in the few frames before quit.
			if (!handedOff) {
				activeAttempt.current = false;
				setPending(false);
			}
		}
	};
	const notesSection = (
		heading: string,
		notes: string | null,
		repo: string,
		version: string,
		html = false,
	) => (
		<section className="min-w-0 space-y-1">
			<h3 className="text-heading text-ink">{heading}</h3>
			{notes ? (
				<div className="break-words whitespace-pre-wrap text-body text-ink-muted [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc [&_pre]:whitespace-pre-wrap">
					{html ? parse(notes, noteOptions) : notes}
				</div>
			) : (
				<p className="text-body text-ink-muted">
					{t("ui.common.updates.combined.notes_unavailable")}
				</p>
			)}
			<a
				className="text-body-sm text-accent underline"
				href={`https://github.com/damianvtran/${repo}/releases/tag/v${encodeURIComponent(version)}`}
				target="_blank"
				rel="noopener noreferrer"
			>
				{t("ui.common.updates.update_notification.view_full_release_notes")}
			</a>
		</section>
	);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) dismiss();
			}}
		>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl"
				showClose={false}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					cancelButton.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					const trigger = useCombinedUpdateSurface.getState().trigger;
					if (trigger?.isConnected) {
						event.preventDefault();
						trigger.focus();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{t("ui.common.updates.combined.install_all")}
					</DialogTitle>
					<DialogDescription>
						{t("ui.common.updates.combined.description")}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 space-y-4 overflow-y-auto">
					{notesSection(
						t("ui.common.updates.combined.app_version", {
							version: targets.app,
						}),
						appNotes,
						"local-operator-ui",
						targets.app,
						true,
					)}
					{notesSection(
						t("ui.common.updates.combined.server_version", {
							version: targets.server,
						}),
						serverNotes,
						"local-operator",
						targets.server,
					)}
				</div>
				{displayFailure && (
					<p role="alert" className="text-body text-danger">
						{t(`ui.common.updates.combined.${displayFailure}`)}
					</p>
				)}
				{pending && (
					<output className="text-body text-ink-muted">
						{t("ui.common.updates.combined.in_progress")}
					</output>
				)}
				<DialogFooter>
					<Button
						ref={cancelButton}
						variant="tonal"
						disabled={pending}
						onClick={dismiss}
					>
						{displayFailure
							? t("ui.common.actions.close")
							: t("ui.common.actions.cancel")}
					</Button>
					<Button
						variant="primary"
						disabled={
							pending ||
							!current ||
							(displayFailure !== null && displayFailure !== "busy")
						}
						onClick={() => void confirm()}
					>
						{t("ui.common.updates.combined.install_both")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
