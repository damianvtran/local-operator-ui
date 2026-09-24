/**
 * One integration, as one line a person can act on.
 *
 * Left to right: a status dot, the name over quiet meta (how it runs, where it
 * applies, where it came from), then the status in words, the ONE action this
 * state calls for, and an overflow holding everything else. That is the shape
 * the design audit's § 4 table specifies, and the reason each part is where it
 * is:
 *
 * - The dot is never the only signal. It always sits beside the status words,
 *   so a colour-blind reader, or a theme whose warning and success are close,
 *   loses nothing.
 * - One primary action, chosen from the backend's `actions` by
 *   `primaryAction`. Every row used to draw Connect/Disconnect, Reload, Sign in
 *   and Remove whatever it needed, which is how a local command got a Sign in
 *   that could only fail (UX walk U6).
 * - Remove lives in the overflow as the one destructive item and still asks
 *   first (design D9: four danger-ink buttons on one screen).
 * - Transport and source are meta, not badges, and never the wire's own words:
 *   "Local command", "Imported from Codex CLI" rather than `stdio`, `codex`.
 */

import { compactPath } from "@features/chat/components/trace/tool-row-model";
import { Spinner } from "@shared/components/common/spinner";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { MoreHorizontal } from "lucide-react";
import type { FC, Ref } from "react";
import type { McpCatalogOperation } from "../../../../../../shared/desktop-control-contract";
import {
	type IntegrationRow as IntegrationRowData,
	type OverflowItem,
	type PrimaryAction,
	READY_EXPLANATION,
	type StatusTone,
	integrationMeta,
	integrationStatus,
	overflowItems,
	primaryAction,
} from "./integration-model";

/**
 * Dot fill per tone. `ink-dim` for Ready: present, asking for nothing. Not
 * `control` - that measured under the 3:1 graphic floor on a deep-linked
 * row's `row-selected` ground in eleven palettes (`scripts/contrast-contract.mjs`,
 * "integration status dot").
 */
const DOT_FILL: Record<StatusTone, string> = {
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
	info: "bg-info",
	neutral: "bg-ink-dim",
};

/**
 * Status words per tone. Only states that ask for attention are coloured; a
 * healthy or idle row reads in muted ink so the page's colour points at work.
 */
const STATUS_INK: Record<StatusTone, string> = {
	success: "text-ink-muted",
	warning: "text-warning",
	danger: "text-danger",
	info: "text-ink-muted",
	neutral: "text-ink-muted",
};

/** A question the row asks inline before a destructive or account change. */
export type RowConfirm = { kind: "remove" | "sign_out" } | null;

export type IntegrationRowProps = {
	row: IntegrationRowData;
	operations: readonly McpCatalogOperation[];
	projectScopeAvailable: boolean;
	/** The row a `/mcp <name>` deep link named. A colour step, never a ring. */
	highlighted?: boolean;
	rowRef?: Ref<HTMLLIElement>;
	/** A control on this row is in flight, so its controls are disabled. */
	pending: boolean;
	/** The last failure for THIS row, already worded, or null. */
	failure: string | null;
	confirm: RowConfirm;
	onPrimary: (action: PrimaryAction) => void;
	onOverflow: (item: OverflowItem) => void;
	onConfirm: () => void;
	onCancelConfirm: () => void;
};

export const IntegrationRow: FC<IntegrationRowProps> = ({
	row,
	operations,
	projectScopeAvailable,
	highlighted = false,
	rowRef,
	pending,
	failure,
	confirm,
	onPrimary,
	onOverflow,
	onConfirm,
	onCancelConfirm,
}) => {
	const status = integrationStatus(row, operations);
	/*
	 * On a deep-linked row, "Couldn't start" drops to `ink`: `danger` as text
	 * measured 4.23-4.47:1 on `row-selected` in six palettes, and the red dot
	 * beside the words still carries the tone.
	 */
	const statusInk =
		highlighted && status.tone === "danger"
			? "text-ink"
			: STATUS_INK[status.tone];
	const primary = primaryAction(row, operations);
	const items = overflowItems(row, operations);
	const meta = integrationMeta(row, projectScopeAvailable);
	const destructiveAt = items.findIndex(
		(item) => item.kind === "remove" || item.kind === "remove_elsewhere",
	);

	return (
		<li
			ref={rowRef}
			data-integration={row.name}
			data-status={row.status}
			className={cn(
				"flex min-h-14 flex-col justify-center gap-1 px-4 py-2.5",
				highlighted && "bg-row-selected",
			)}
		>
			<div className="flex items-center gap-3">
				<span className="flex size-4 shrink-0 items-center justify-center">
					{status.busy ? (
						<Spinner size="xs" />
					) : (
						<span
							aria-hidden="true"
							data-tone={status.tone}
							className={cn("size-2 rounded-full", DOT_FILL[status.tone])}
						/>
					)}
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium text-body text-ink">
						{row.name}
					</span>
					<span className="truncate text-ink-dim text-meta">
						{meta.map((part, index) => (
							<span key={part}>
								{index > 0 ? " · " : null}
								{/* The source file is the tooltip of the "Imported from" part:
								    the path is where it is fixed, and quiet until asked for. */}
								{part.startsWith("Imported from") && row.source.path ? (
									<Tooltip content={compactPath(row.source.path)}>
										<span className="underline decoration-dotted underline-offset-2">
											{part}
										</span>
									</Tooltip>
								) : (
									part
								)}
							</span>
						))}
					</span>
				</div>
				{status.label === "Ready" ? (
					<Tooltip content={READY_EXPLANATION}>
						<span
							className={cn("shrink-0 text-body-sm", STATUS_INK[status.tone])}
						>
							{status.label}
						</span>
					</Tooltip>
				) : (
					<span className={cn("shrink-0 text-body-sm", statusInk)}>
						{status.label}
					</span>
				)}
				{primary ? (
					<Button
						variant="secondary"
						size="sm"
						disabled={pending}
						data-integration-action={primary.kind}
						onClick={() => onPrimary(primary)}
					>
						{pending ? <Spinner size="xs" /> : null}
						{primary.label}
					</Button>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`More actions for ${row.name}`}
							disabled={pending}
						>
							<MoreHorizontal aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-48">
						{items.map((item, index) => (
							<OverflowEntry
								key={item.kind}
								item={item}
								separated={index === destructiveAt && index > 0}
								onSelect={() => onOverflow(item)}
							/>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{status.detail ? (
				<p
					className={cn(
						"pl-7 text-body-sm",
						status.tone === "danger" ? "text-ink-muted" : "text-ink-dim",
					)}
				>
					{status.detail}
				</p>
			) : null}
			{failure ? (
				<p
					className={cn(
						"pl-7 text-body-sm",
						// Same rule as the status words: `danger` text is under 4.5:1 on
						// a deep-linked row's ground in six palettes.
						highlighted ? "text-ink" : "text-danger",
					)}
					role="alert"
				>
					{failure}
				</p>
			) : null}
			{confirm ? (
				<div className="flex flex-wrap items-center gap-2 pl-7">
					<span className="text-body-sm text-ink">
						{confirm.kind === "remove"
							? `Remove ${row.name}?`
							: `Sign out of ${row.name}?`}
					</span>
					<Button
						variant="danger"
						size="sm"
						onClick={onConfirm}
						data-integration-confirm={confirm.kind}
					>
						{confirm.kind === "remove" ? "Remove" : "Sign out"}
					</Button>
					<Button variant="ghost" size="sm" onClick={onCancelConfirm}>
						Keep
					</Button>
				</div>
			) : null}
		</li>
	);
};

const OverflowEntry: FC<{
	item: OverflowItem;
	separated: boolean;
	onSelect: () => void;
}> = ({ item, separated, onSelect }) => (
	<>
		{separated ? <DropdownMenuSeparator /> : null}
		{item.kind === "remove_elsewhere" ? (
			<DropdownMenuItem disabled className="flex-col items-start gap-0.5">
				<span>{item.label}</span>
				<span className="text-meta">{item.hint}</span>
			</DropdownMenuItem>
		) : (
			<DropdownMenuItem
				destructive={item.kind === "remove"}
				onSelect={onSelect}
				data-integration-menu={item.kind}
			>
				{item.label}
			</DropdownMenuItem>
		)}
	</>
);
