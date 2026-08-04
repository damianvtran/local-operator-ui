import type { Agent } from "@shared/api/radient/types";
import { CompactPagination } from "@shared/components/common/compact-pagination";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Store } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { AgentCardContainer } from "./components/agent-card-container";
import { AgentCategoriesSidebar } from "./components/agent-categories-sidebar";
import { usePublicAgentsQuery } from "./hooks/use-public-agents-query";

/**
 * Renders the Agent Hub page, displaying a marketplace of public agents.
 */
export const AgentHubPage: React.FC = () => {
	const [page, setPage] = useState(1);
	const [perPage] = useState(12); // Adjust items per page as needed
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

	const {
		data: agentsData,
		isLoading,
		error,
		pagination,
	} = usePublicAgentsQuery({
		page,
		perPage,
		categories: selectedCategory ? [selectedCategory] : undefined,
	});

	const agents: Agent[] = agentsData?.records ?? [];

	const handlePageChange = (newPage: number) => {
		setPage(newPage);
	};

	const handleSelectCategory = (category: string | null) => {
		setSelectedCategory(category);
		setPage(1); // Reset to first page on filter change
	};

	return (
		<div className="flex h-full flex-col p-6">
			<PageHeader
				title="Agent Hub"
				subtitle="Discover and download community agents on Radient"
				icon={Store}
			/>
			<div className="mt-2 flex min-h-0 flex-1 flex-row overflow-hidden">
				{/* The category rail is hidden below the first grid breakpoint,
				    where the cards are already full-width. */}
				<div
					className="mr-6 hidden w-60 shrink-0 md:block"
					data-tour-tag="agent-hub-sidebar-container"
				>
					<AgentCategoriesSidebar
						selectedCategory={selectedCategory}
						onSelectCategory={handleSelectCategory}
					/>
				</div>
				<div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
					{isLoading && (
						<div className="flex min-h-50 flex-1 items-center justify-center">
							<Spinner label="Loading agents" />
						</div>
					)}
					{error && (
						<div className="flex min-h-50 flex-1 items-center justify-center">
							<p className="text-body-sm text-danger">
								Failed to load agents: {error.message}
							</p>
						</div>
					)}
					{!isLoading && !error && (
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{agents.length === 0 ? (
								<p className="col-span-full text-center text-body text-ink">
									No public agents found.
								</p>
							) : (
								agents.map((agent) => (
									<AgentCardContainer key={agent.id} agent={agent} />
								))
							)}
						</div>
					)}
					{pagination && pagination.totalPages > 1 && (
						<div className="mt-6 flex justify-center">
							<CompactPagination
								count={pagination.totalPages}
								page={pagination.page}
								onChange={handlePageChange}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
