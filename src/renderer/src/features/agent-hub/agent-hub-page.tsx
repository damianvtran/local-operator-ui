import type React from "react"; // Import React as type
import { useState } from "react"; // Import useState separately
import { Box, Typography, Grid, CircularProgress } from "@mui/material";
import { styled } from "@mui/material/styles";
import { faStore } from "@fortawesome/free-solid-svg-icons";
import { PageHeader } from "@shared/components/common/page-header";
import { AgentCard } from "./components/agent-card"; // Import AgentCard
import { usePublicAgentsQuery } from "./hooks/use-public-agents-query"; // Import hook
import type { Agent } from "@shared/api/radient/types"; // Import Agent type
import { CompactPagination } from "@shared/components/common/compact-pagination"; // Import Pagination

const StyledAgentHubContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  height: "100%",
  display: "flex",
  flexDirection: "column",
}));

const StyledGridContainer = styled(Grid)(({ theme }) => ({
  flexGrow: 1,
  overflowY: "auto", // Allow grid to scroll if content overflows
  padding: theme.spacing(2, 0),
}));

/**
 * Renders the Agent Hub page, displaying a marketplace of public agents.
 */
export const AgentHubPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [perPage] = useState(12); // Adjust items per page as needed

  const {
    data: agentsData, // Rename data to avoid conflict
    isLoading,
    error,
    pagination,
  } = usePublicAgentsQuery({ page, perPage });

  const agents: Agent[] = agentsData?.records ?? [];

  // Placeholder handlers - TODO: Implement actual logic with mutations
  const handleLikeToggle = (agentId: string) => {
    console.log("Toggle like for agent:", agentId);
    // Invalidate/update queries after mutation
  };

  const handleFavouriteToggle = (agentId: string) => {
    console.log("Toggle favourite for agent:", agentId);
    // Invalidate/update queries after mutation
  };

  const handleDownload = (agentId: string) => {
    console.log("Download agent:", agentId);
    // Implement download logic
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Optionally scroll to top or handle focus
  };

  return (
    <StyledAgentHubContainer>
      <PageHeader
        title="Agent Hub"
        subtitle="Discover and download community agents"
        icon={faStore} // Use FontAwesome icon definition
      />
      {isLoading && (
        <Box display="flex" justifyContent="center" alignItems="center" flexGrow={1}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Box display="flex" justifyContent="center" alignItems="center" flexGrow={1}>
          <Typography color="error">
            {/* @ts-ignore TODO: Improve error typing */}
            Failed to load agents: {error.message}
          </Typography>
        </Box>
      )}
      {!isLoading && !error && (
        <StyledGridContainer container spacing={3}>
          {agents.length === 0 ? (
            <Grid item xs={12}>
              <Typography variant="body1" align="center">
                No public agents found.
              </Typography>
            </Grid>
          ) : (
            agents.map((agent) => (
              <Grid item key={agent.id} xs={12} sm={6} md={4} lg={3}>
                {/* TODO: Pass actual like/favourite status */}
                <AgentCard
                  agent={agent}
                  isLiked={false} // Placeholder
                  isFavourited={false} // Placeholder
                  onLikeToggle={handleLikeToggle}
                  onFavouriteToggle={handleFavouriteToggle}
                  onDownload={handleDownload}
                />
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
            // Pass handlePageChange directly as it matches the expected signature (page: number) => void
            onChange={handlePageChange}
          />
        </Box>
      )}
    </StyledAgentHubContainer>
  );
};
