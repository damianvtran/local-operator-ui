import { Button, Tooltip } from "@shared/components/ui";
import { ExternalLink, Key, Lock, SquarePen, Trash2 } from "lucide-react";
import type { FC } from "react";
import { getCredentialInfo } from "./credential-manifest";

type CredentialCardProps = {
	credentialKey: string;
	isConfigured?: boolean;
	onEdit?: (key: string) => void;
	onClear?: (key: string) => void;
	onAdd?: (key: string) => void;
};

/**
 * One credential in the credentials list: what it is, its key, and the actions
 * available on it.
 *
 * ## Why it draws no boundary of its own
 *
 * It used to be a bordered, filled card — inside a bordered section, inside the
 * bordered settings page. Three nested edges say nothing that one says, so the
 * single boundary belongs to the grid container in `credentials-section.tsx`
 * and this renders as a plain cell on whatever ground it lands on. It sets no
 * fill and no height: the grid already stretches its cells, so `mt-auto` on the
 * action row is what keeps the actions aligned across a row of cards whose
 * descriptions differ in length.
 *
 * Hover is a colour step to `elevated` and nothing else — no lift, no shadow
 * (branding § 5). Elevation in this system is a ground step; a shadow belongs
 * only to things that leave the flow.
 */
export const CredentialCard: FC<CredentialCardProps> = ({
	credentialKey,
	isConfigured = false,
	onEdit,
	onClear,
	onAdd,
}) => {
	const credInfo = getCredentialInfo(credentialKey);
	const StatusIcon = isConfigured ? Lock : Key;

	return (
		<div className="flex flex-col rounded-md p-3 transition-colors duration-fast ease-out-quart hover:bg-elevated">
			<div className="min-w-0">
				<h3 className="flex items-center gap-2 text-body font-medium text-ink">
					<StatusIcon className="size-3.5 shrink-0 text-ink-dim" />
					{credInfo.name}
				</h3>
				{/* The key is an identifier the user pastes into a config, so it is
				    machine voice and must break rather than overflow its column. */}
				<p className="mt-1 break-all text-mono-sm text-ink-dim">
					{credentialKey}
				</p>
				<p className="mt-2 text-body-sm text-ink-muted">
					{credInfo.description}
				</p>
			</div>

			<div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
				{isConfigured ? (
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onEdit?.(credentialKey)}
						>
							<SquarePen />
							Update
						</Button>
						{/* Destructive, but one of many rows: danger ink on a ghost box
						    rather than a red-bordered slab repeated down the list. */}
						<Button
							variant="ghost"
							size="sm"
							className="text-danger hover:bg-danger-wash hover:text-danger"
							onClick={() => onClear?.(credentialKey)}
						>
							<Trash2 />
							Clear
						</Button>
					</>
				) : (
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={() => onAdd?.(credentialKey)}
						>
							<Key />
							Configure
						</Button>
						{credInfo.url && (
							<Tooltip content={`Get your ${credInfo.name} key`}>
								<Button variant="ghost" size="icon-sm" asChild>
									<a
										href={credInfo.url}
										target="_blank"
										rel="noopener noreferrer"
										aria-label={`Get your ${credInfo.name} key`}
									>
										<ExternalLink />
									</a>
								</Button>
							</Tooltip>
						)}
					</>
				)}
			</div>
		</div>
	);
};
