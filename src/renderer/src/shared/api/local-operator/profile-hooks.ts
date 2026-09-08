import { useQuery } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";

/** Reusable instructions, never a conversation or a legacy agent history. */
export type ReusableProfile = {
	name: string;
	kind: "role" | "specialist";
	source: "builtin" | "installed" | "custom";
	agent_id: string | null;
	description: string;
	instructions?: string;
	packaged_instructions?: string;
	tools: string[] | null;
	effort: string | null;
	delegate: boolean;
	seed_origin?: string | null;
	divergent_fields?: string[];
};
export type TeamMember = {
	role: string;
	count: number;
	kind: "agent" | "team";
};
export type ReusableTeam = {
	id: string;
	name: string;
	description: string;
	manager: string;
	members: TeamMember[];
	instructions?: string;
	project?: string;
};
export type ChatTarget = { kind: "agent" | "team"; name: string };

export function useProfiles(enabled: boolean) {
	return useQuery({
		queryKey: ["desktop", "profiles"],
		enabled,
		queryFn: () =>
			desktopResult<{ profiles: ReusableProfile[] }>({
				op: "profiles.list",
			}).then((result) => result.profiles),
		retry: retryDesktopQuery,
		staleTime: 10_000,
	});
}
export function useTeams(enabled: boolean) {
	return useQuery({
		queryKey: ["desktop", "teams"],
		enabled,
		queryFn: () =>
			desktopResult<{ teams: ReusableTeam[] }>({ op: "teams.list" }).then(
				(result) => result.teams,
			),
		retry: retryDesktopQuery,
		staleTime: 10_000,
	});
}
