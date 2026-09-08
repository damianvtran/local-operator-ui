import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ReusableProfile,
	type ReusableTeam,
	type TeamMember,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Users } from "lucide-react";
import { type FormEvent, Suspense, lazy, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

// Old UUID links remain ordinary chat-agent settings, not reusable profiles.
// Loading them explicitly preserves compatibility without contaminating the
// canonical catalogue or silently converting somebody's saved conversation.
const LegacyAgentsPage = lazy(() =>
	import("./legacy-agents-page").then((module) => ({
		default: module.LegacyAgentsPage,
	})),
);
const field =
	"w-full rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-ink";

function ProfileEditor({
	profile,
	creating,
	onSaved,
}: {
	profile?: ReusableProfile;
	creating: boolean;
	onSaved: (name: string) => void;
}) {
	const [extending, setExtending] = useState(false);
	const [editing, setEditing] = useState(creating);
	const [name, setName] = useState(profile?.name ?? "");
	const [kind, setKind] = useState<"role" | "specialist">(
		profile?.kind ?? "role",
	);
	const [description, setDescription] = useState(profile?.description ?? "");
	const [instructions, setInstructions] = useState(profile?.instructions ?? "");
	const [tools, setTools] = useState(profile?.tools?.join(", ") ?? "");
	const [effort, setEffort] = useState(profile?.effort ?? "inherit");
	const [delegate, setDelegate] = useState(profile?.delegate ?? false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef<{ id: string; body: string } | null>(null);
	const navigate = useNavigate();
	const fresh = creating || extending;
	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		const fields = {
			kind,
			description,
			instructions,
			tools: tools
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
			effort,
			delegate,
		};
		const body = JSON.stringify({ name, fields, fresh });
		if (request.current && request.current.body !== body) {
			setError(
				"The previous save has not been confirmed. Retry it unchanged or reload the profile to reconcile before editing again.",
			);
			return;
		}
		request.current ??= { id: crypto.randomUUID(), body };
		setPending(true);
		setError(null);
		try {
			const result = await desktopResult<ReusableProfile>({
				op: fresh ? "profiles.create" : "profiles.update",
				requestId: request.current.id,
				name,
				fields,
			});
			request.current = null;
			setEditing(false);
			onSaved(result.name);
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Profile could not be saved.",
			);
		} finally {
			setPending(false);
		}
	};
	const install = async () => {
		if (!profile || pending) return;
		setPending(true);
		setError(null);
		try {
			const result = await desktopResult<ReusableProfile>({
				op: "profiles.install",
				name: profile.name,
				requestId: crypto.randomUUID(),
			});
			onSaved(result.name);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Profile could not be installed.",
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<div className="max-w-3xl space-y-6">
			<header>
				<h1 className="text-title">
					{fresh
						? extending
							? "Extend agent"
							: "Create agent"
						: profile?.name}
				</h1>
				<p className="mt-2 text-body-sm text-ink-muted">
					Reusable instructions shared by agent commands, subagents and teams.
					Chats remain separate.
				</p>
			</header>
			{profile && !fresh && (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-meta text-ink-muted">
						{profile.source === "builtin"
							? "Built-in"
							: profile.source === "installed"
								? "Installed"
								: "Custom"}
						{profile.divergent_fields?.length ? " · Modified" : ""} ·{" "}
						{profile.kind}
					</span>
					{profile.source === "builtin" ? (
						<Button variant="outline" onClick={install} disabled={pending}>
							Install
						</Button>
					) : (
						<Button variant="outline" onClick={() => setEditing(true)}>
							Edit
						</Button>
					)}
					<Button
						variant="outline"
						onClick={() => {
							setExtending(true);
							setEditing(true);
							setName("");
							request.current = null;
						}}
					>
						Extend
					</Button>
					<Button
						onClick={() => {
							useCanonicalSessionsStore
								.getState()
								.stageDraft({ kind: "agent", name: profile.name });
							navigate("/chat");
						}}
					>
						New chat
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="text-body-sm text-danger">
					{error}
				</p>
			)}
			<form onSubmit={save} className="space-y-4">
				<fieldset disabled={!editing || pending} className="space-y-4">
					<label className="block space-y-1 text-body-sm">
						<span>Name</span>
						<input
							className={field}
							value={name}
							disabled={!fresh}
							required
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label className="block space-y-1 text-body-sm">
						<span>Kind</span>
						<select
							className={field}
							value={kind}
							disabled={!fresh}
							onChange={(event) =>
								setKind(event.target.value as "role" | "specialist")
							}
						>
							<option value="role">Role</option>
							<option value="specialist">Specialist</option>
						</select>
					</label>
					<label className="block space-y-1 text-body-sm">
						<span>When to use this agent</span>
						<input
							className={field}
							value={description}
							maxLength={8000}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
					<label className="block space-y-1 text-body-sm">
						<span>Instructions</span>
						<textarea
							className={cn(field, "min-h-52")}
							value={instructions}
							required
							maxLength={8000}
							onChange={(event) => setInstructions(event.target.value)}
						/>
					</label>
					{kind === "role" && (
						<>
							<label className="block space-y-1 text-body-sm">
								<span>Allowed tools</span>
								<input
									className={field}
									value={tools}
									onChange={(event) => setTools(event.target.value)}
									placeholder="All tools when empty; otherwise comma-separated names"
								/>
							</label>
							<label className="block space-y-1 text-body-sm">
								<span>Effort tier</span>
								<input
									className={field}
									value={effort}
									onChange={(event) => setEffort(event.target.value)}
									aria-describedby="effort-help"
								/>
								<span id="effort-help" className="text-meta text-ink-muted">
									Use inherit, or a tier configured in backend settings.
									Unsupported tiers are rejected before saving.
								</span>
							</label>
							<label className="flex items-center gap-2 text-body-sm">
								<input
									type="checkbox"
									checked={delegate}
									onChange={(event) => setDelegate(event.target.checked)}
								/>
								May delegate to subagents
							</label>
						</>
					)}
				</fieldset>
				{editing && (
					<Button type="submit" disabled={pending}>
						{pending ? "Saving…" : fresh ? "Create agent" : "Save changes"}
					</Button>
				)}
			</form>
			{!editing &&
			profile?.packaged_instructions &&
			profile.divergent_fields?.length ? (
				<details className="text-body-sm">
					<summary>Compare packaged instructions</summary>
					<pre className="mt-2 whitespace-pre-wrap text-body-sm text-ink-muted">
						{profile.packaged_instructions}
					</pre>
				</details>
			) : null}
		</div>
	);
}

function TeamEditor({
	team,
	onSaved,
}: { team?: ReusableTeam; onSaved: (name: string) => void }) {
	const [name, setName] = useState(team?.name ?? "");
	const [description, setDescription] = useState(team?.description ?? "");
	const [manager, setManager] = useState(team?.manager ?? "manager");
	const [members, setMembers] = useState<(TeamMember & { key: string })[]>(
		(team?.members ?? []).map((member) => ({
			...member,
			key: crypto.randomUUID(),
		})),
	);
	const [instructions, setInstructions] = useState(team?.instructions ?? "");
	const [project, setProject] = useState(team?.project ?? "");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef<{ id: string; body: string } | null>(null);
	const navigate = useNavigate();
	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		const fields = {
			name,
			description,
			manager,
			members: members.map(({ key: _key, ...member }) => member),
			instructions,
			project,
		};
		const body = JSON.stringify(fields);
		if (request.current && request.current.body !== body) {
			setError(
				"The previous save has not been confirmed. Reload the team before changing that request.",
			);
			return;
		}
		request.current ??= { id: crypto.randomUUID(), body };
		setPending(true);
		setError(null);
		try {
			const result = team
				? await desktopResult<ReusableTeam>({
						op: "teams.update",
						name: team.name,
						requestId: request.current.id,
						fields,
					})
				: await desktopResult<ReusableTeam>({
						op: "teams.create",
						requestId: request.current.id,
						fields,
					});
			request.current = null;
			onSaved(result.name);
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Team could not be saved.",
			);
		} finally {
			setPending(false);
		}
	};
	const updateMember = (index: number, patch: Partial<TeamMember>) =>
		setMembers((rows) =>
			rows.map((row, position) =>
				position === index ? { ...row, ...patch } : row,
			),
		);
	return (
		<div className="max-w-3xl space-y-6">
			<header>
				<h1 className="text-title">{team ? team.name : "Create team"}</h1>
				<p className="mt-2 text-body-sm text-ink-muted">
					The manager leads the chat. Members retain their own instructions and
					start only when delegated work.
				</p>
			</header>
			{team && (
				<Button
					onClick={() => {
						useCanonicalSessionsStore
							.getState()
							.stageDraft({ kind: "team", name: team.name });
						navigate("/chat");
					}}
				>
					New team chat
				</Button>
			)}
			{error && (
				<p role="alert" className="text-body-sm text-danger">
					{error}
				</p>
			)}
			<form onSubmit={save} className="space-y-4">
				<fieldset disabled={pending} className="space-y-4">
					<label className="block space-y-1 text-body-sm">
						<span>Name</span>
						<input
							className={field}
							required
							maxLength={64}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label className="block space-y-1 text-body-sm">
						<span>Description</span>
						<input
							className={field}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
					<label className="block space-y-1 text-body-sm">
						<span>Manager agent</span>
						<input
							className={field}
							required
							value={manager}
							onChange={(event) => setManager(event.target.value)}
						/>
					</label>
					<section className="space-y-2">
						<h2 className="text-heading">Members</h2>
						{members.map((member, index) => (
							<div
								key={member.key}
								className="flex flex-wrap items-center gap-2"
							>
								<input
									className={cn(field, "w-48 flex-1")}
									aria-label={`Member ${index + 1} name`}
									required
									value={member.role}
									onChange={(event) =>
										updateMember(index, { role: event.target.value })
									}
								/>
								<select
									className={cn(field, "w-32")}
									aria-label={`Member ${index + 1} kind`}
									value={member.kind}
									onChange={(event) =>
										updateMember(index, {
											kind: event.target.value as "agent" | "team",
										})
									}
								>
									<option value="agent">Agent</option>
									<option value="team">Nested team</option>
								</select>
								<input
									className={cn(field, "w-20")}
									aria-label={`Member ${index + 1} count`}
									type="number"
									min={1}
									max={16}
									value={member.count}
									onChange={(event) =>
										updateMember(index, { count: Number(event.target.value) })
									}
								/>
								<Button
									type="button"
									variant="ghost"
									onClick={() =>
										setMembers((rows) =>
											rows.filter((_, position) => position !== index),
										)
									}
								>
									Remove
								</Button>
							</div>
						))}
						<Button
							type="button"
							variant="outline"
							onClick={() =>
								setMembers((rows) => [
									...rows,
									{
										role: "",
										count: 1,
										kind: "agent",
										key: crypto.randomUUID(),
									},
								])
							}
						>
							Add member
						</Button>
					</section>
					<label className="block space-y-1 text-body-sm">
						<span>Collaboration instructions</span>
						<textarea
							className={cn(field, "min-h-36")}
							maxLength={8000}
							value={instructions}
							onChange={(event) => setInstructions(event.target.value)}
						/>
					</label>
					<label className="block space-y-1 text-body-sm">
						<span>Project brief</span>
						<textarea
							className={cn(field, "min-h-36")}
							maxLength={8000}
							value={project}
							onChange={(event) => setProject(event.target.value)}
						/>
					</label>
				</fieldset>
				<Button type="submit" disabled={pending}>
					{pending ? "Saving…" : team ? "Save team" : "Create team"}
				</Button>
			</form>
		</div>
	);
}

export function AgentsPage() {
	const { agentId } = useParams<{ agentId?: string }>();
	const [params, setParams] = useSearchParams();
	const teamMode =
		params.get("kind") === "team" || params.get("create") === "team";
	const creating = params.has("create");
	const name = params.get("name");
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(
		capabilities.data,
		teamMode ? "team_catalogue" : "profile_catalogue",
	);
	const profiles = useProfiles(enabled && !teamMode);
	const teams = useTeams(enabled && teamMode);
	const queryClient = useQueryClient();
	const detail = useQuery<ReusableProfile | ReusableTeam>({
		queryKey: ["desktop", teamMode ? "team" : "profile", name],
		enabled: enabled && Boolean(name) && !creating,
		queryFn: () =>
			desktopResult<ReusableProfile | ReusableTeam>({
				op: teamMode ? "teams.get" : "profiles.get",
				name: name ?? "",
			}),
		retry: false,
	});
	const saved = async (savedName: string) => {
		await queryClient.invalidateQueries({ queryKey: ["desktop"] });
		setParams({ kind: teamMode ? "team" : "agent", name: savedName });
	};
	if (agentId)
		return (
			<Suspense
				fallback={<p className="p-6 text-body">Loading saved agent…</p>}
			>
				<LegacyAgentsPage />
			</Suspense>
		);
	return (
		<div className="flex h-full min-h-0 bg-canvas text-ink">
			<aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-hairline bg-surface p-4">
				<h1 className="text-heading">Agents and teams</h1>
				<div className="flex gap-2">
					<Button
						variant={teamMode ? "ghost" : "outline"}
						onClick={() => setParams({ kind: "agent" })}
					>
						<Bot className="size-4" />
						Agents
					</Button>
					<Button
						variant={teamMode ? "outline" : "ghost"}
						onClick={() => setParams({ kind: "team" })}
					>
						<Users className="size-4" />
						Teams
					</Button>
				</div>
				<Button
					variant="outline"
					disabled={!enabled}
					onClick={() => setParams({ create: teamMode ? "team" : "agent" })}
				>
					<Plus className="size-4" />
					{teamMode ? "Create team" : "Create agent"}
				</Button>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{(teamMode ? teams.data : profiles.data)?.map((row) => (
						<button
							key={row.name}
							type="button"
							className={cn(
								"flex h-8 w-full items-center rounded-md px-2 text-left text-body-sm hover:bg-elevated",
								row.name === name && "bg-accent-wash",
							)}
							onClick={() =>
								setParams({ kind: teamMode ? "team" : "agent", name: row.name })
							}
						>
							<span className="truncate">{row.name}</span>
						</button>
					))}
				</div>
			</aside>
			<main className="min-w-0 flex-1 overflow-auto p-6">
				{!enabled ? (
					<div aria-live="polite" className="space-y-3 text-body-sm">
						<p>
							{capabilities.isLoading
								? "Connecting to the backend…"
								: capabilities.error
									? capabilities.error.message
									: "Update the backend to manage reusable agents and teams. Saved chats are unchanged."}
						</p>
						<Button
							variant="outline"
							onClick={() => void capabilities.refetch()}
						>
							Retry connection
						</Button>
					</div>
				) : profiles.error || teams.error || detail.error ? (
					<div role="alert">
						<p className="text-danger">
							{profiles.error?.message ||
								teams.error?.message ||
								detail.error?.message}
						</p>
						<Button
							variant="outline"
							onClick={() => {
								void profiles.refetch();
								void teams.refetch();
								void detail.refetch();
							}}
						>
							Retry
						</Button>
					</div>
				) : creating ? (
					teamMode ? (
						<TeamEditor key="create-team" onSaved={saved} />
					) : (
						<ProfileEditor key="create-agent" creating onSaved={saved} />
					)
				) : name && detail.isLoading ? (
					<p aria-live="polite">Loading details…</p>
				) : name && detail.data ? (
					teamMode ? (
						<TeamEditor
							key={name}
							team={detail.data as ReusableTeam}
							onSaved={saved}
						/>
					) : (
						<ProfileEditor
							key={name}
							profile={detail.data as ReusableProfile}
							creating={false}
							onSaved={saved}
						/>
					)
				) : (
					<div>
						<h2 className="text-title">
							{teamMode ? "Reusable teams" : "Reusable agents"}
						</h2>
						<p className="mt-2 text-body text-ink-muted">
							Select a definition to view or edit it. A new chat does not change
							its definition.
						</p>
					</div>
				)}
			</main>
		</div>
	);
}
