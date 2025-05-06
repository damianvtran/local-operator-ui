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

/**
 * Main container for the Agent Hub page.
 */
const StyledAgentHubContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	display: "flex",
	flexDirection: "column",
	height: "100%",
	minHeight: 0,
}));

/**
 * Row layout for sidebar and main content.
 */
const MainContentRow = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "row",
	flexGrow: 1,
	minHeight: 0,
	marginTop: theme.spacing(2),
	overflow: "hidden",
}));

/**
 * Sidebar container for categories.
 */
const SidebarContainer = styled(Box)(({ theme }) => ({
	flex: "0 0 240px",
	maxWidth: 240,
	minWidth: 200,
	marginRight: theme.spacing(3),
	[theme.breakpoints.down("sm")]: {
		display: "none",
	},
}));

/**
 * Scrollable content area for agent cards and pagination.
 * Styled to match the chat messages view scrollbar.
 */
const ScrollableContent = styled(Box)(() => ({
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minWidth: 0,
	maxHeight: "100%",
	height: "100%",
	overflow: "hidden",
}));

const ScrollContainer = styled(Box)(({ theme }) => ({
	flex: 1,
	minHeight: 0,
	overflowY: "auto",
	overflowX: "hidden",
	padding: theme.spacing(0, 0),
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
	// For Firefox
	scrollbarWidth: "thin",
	scrollbarColor:
		theme.palette.mode === "dark"
			? "rgba(255,255,255,0.1) transparent"
			: "rgba(0,0,0,0.2) transparent",
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
				subtitle="Discover and download community agents on Radient"
				icon={Store}
			/>
			<MainContentRow>
				<SidebarContainer>
					<AgentCategoriesSidebar
						selectedCategory={selectedCategory}
						onSelectCategory={handleSelectCategory}
					/>
				</SidebarContainer>
				<ScrollableContent>
					<ScrollContainer>
						{isLoading && (
							<Box
								display="flex"
								justifyContent="center"
								alignItems="center"
								flexGrow={1}
								minHeight={200}
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
								minHeight={200}
							>
								<Typography color="error">
									Failed to load agents: {error.message}
								</Typography>
							</Box>
						)}
						{!isLoading && !error && (
							<Grid container rowSpacing={3} columnSpacing={3}>
								{agents.length === 0 ? (
									<Grid item xs={12}>
										<Typography variant="body1" align="center">
											No public agents found.
										</Typography>
									</Grid>
								) : (
									agents.map((agent) => (
										<Grid item key={agent.id} xs={12} sm={12} md={6} lg={4} xl={3}>
											<AgentCardContainer agent={agent} />
										</Grid>
									))
								)}
							</Grid>
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
					</ScrollContainer>
				</ScrollableContent>
			</MainContentRow>
		</StyledAgentHubContainer>
	);
};
