import { fetchMcpList, mcpKeys } from "@shared/api/local-operator/mcp-list";
import {
	BaseDialog,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Button } from "@shared/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { McpAuthDialog } from "../components/run-details/mcp-auth-dialog";
import { deriveMcpServers } from "../components/run-details/run-detail-model";
import { useMcpRemedy } from "../components/run-details/use-mcp-remedy";
import type { PickerContext } from "./destination-pickers";
import { parseMcpIntent } from "./mcp-command";

/** Mounted by the existing destination registry, retaining the command's own
 * session and verb. No Settings navigation, URL intent, or duplicate registry. */
export function McpPicker({ sessionId, action, onClose }: PickerContext) {
	const query = useQuery({
		queryKey: mcpKeys.list(sessionId),
		queryFn: () => fetchMcpList(sessionId),
	});
	const remedy = useMcpRemedy({ sessionId });
	const [selected, setSelected] = useState<string | null>(null);
	const rows = deriveMcpServers(query.data?.servers ?? []);
	const intent = parseMcpIntent(
		action.args,
		rows.map((row) => row.name),
	);
	const target = rows.find(
		(row) =>
			row.name === (selected ?? (intent.kind === "auth" ? intent.name : null)),
	);
	if (!query.isLoading && !query.error && target)
		return (
			<McpAuthDialog
				key={`${sessionId}:${target.name}`}
				row={target}
				action={intent.kind === "error" ? "login" : intent.action}
				remedy={remedy}
				onClose={onClose}
			/>
		);
	return (
		<BaseDialog
			open
			onClose={onClose}
			title="MCP servers"
			maxWidth="sm"
			actions={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}
		>
			<div className="flex flex-col gap-2 p-1.5 text-body text-ink-muted">
				{query.isLoading ? (
					<p>Loading configured MCP servers…</p>
				) : query.error ? (
					<>
						<p role="alert">Could not load MCP servers.</p>
						<Button onClick={() => void query.refetch()}>Retry</Button>
					</>
				) : intent.kind === "error" ? (
					<p role="alert">{intent.message}</p>
				) : rows.length === 0 ? (
					<p>No MCP servers are configured for this conversation.</p>
				) : (
					rows.map((row) => (
						<Button
							key={row.name}
							variant="ghost"
							className="justify-start"
							onClick={() => setSelected(row.name)}
						>
							{row.name} — {row.status}
						</Button>
					))
				)}
			</div>
		</BaseDialog>
	);
}
