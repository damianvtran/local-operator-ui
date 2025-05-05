import { Box, CircularProgress, Grid, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { Agent } from "@shared/api/radient/types";
import { CompactPagination } from "@shared/components/common/compact-pagination";
import { PageHeader } from "@shared/components/common/page-header";
import { Store } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { AgentCardContainer } from "./components/agent-card-container";
import { AgentCategoriesSidebar } from "./components/agent-categories-sidebar";
import { usePublicAgentsQuery } from "./hooks/use-public-agents-query";

const StyledAgentHubContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	display: "flex",
	flexDirection: "column",
	height: "100%",
}));

const MainContentRow = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "row",
	flexGrow: 1,
	minHeight: 0,
	marginTop: theme.spacing(2),
}));

const StyledGridContainer = styled(Grid)(({ theme }) => ({
	overflowY: "auto",
	padding: theme.spacing(0, 0),
	flex: 1,
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
	},
}));

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
		<StyledAgentHubContainer>
			<PageHeader
				title="Agent Hub"
				subtitle="Discover and download community agents"
				icon={Store}
			/>
			<MainContentRow>
				<AgentCategoriesSidebar
					selectedCategory={selectedCategory}
					onSelectCategory={handleSelectCategory}
				/>
				<Box sx={{ flex: 1, minWidth: 0 }}>
					{isLoading && (
						<Box
							display="flex"
							justifyContent="center"
							alignItems="center"
							flexGrow={1}
						>
							<CircularProgress />
						</Box>
					)}
					{error && (
						<Box
							display="flex"
							justifyContent="center"
							alignItems="center"
							flexGrow={1}
						>
							<Typography color="error">
								Failed to load agents: {error.message}
							</Typography>
						</Box>
					)}
					{!isLoading && !error && (
						<StyledGridContainer container rowSpacing={3} columnSpacing={3}>
							{agents.length === 0 ? (
								<Grid item xs={12}>
									<Typography variant="body1" align="center">
										No public agents found.
									</Typography>
								</Grid>
							) : (
								agents.map((agent) => (
									<Grid item key={agent.id} xs={12} sm={6} md={4} lg={3}>
										<AgentCardContainer agent={agent} />
									</Grid>
								))
							)}
						</StyledGridContainer>
					)}
					{pagination && pagination.totalPages > 1 && (
						<Box display="flex" justifyContent="center" mt={3}>
							<CompactPagination
								count={pagination.totalPages}
								page={pagination.page}
								onChange={handlePageChange}
							/>
						</Box>
					)}
				</Box>
			</MainContentRow>
		</StyledAgentHubContainer>
	);
};
