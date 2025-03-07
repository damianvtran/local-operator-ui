import { Box, Typography, styled } from "@mui/material";
import type { FC } from "react";

/**
 * Props for the RawInfoView component
 */
type RawInfoViewProps = {
  content: string;
};

const RawInfoContainer = styled(Box)({
  flexGrow: 1,
  overflow: "auto",
  padding: 24,
  backgroundColor: "rgba(0, 0, 0, 0.2)",
  "&::-webkit-scrollbar": {
    width: "8px",
  },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: "4px",
  },
});

const RawInfoContent = styled(Box)({
  padding: 16,
  backgroundColor: "rgba(0, 0, 0, 0.3)",
  borderRadius: 4,
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  overflow: "auto",
});

/**
 * RawInfoView Component
 * 
 * Displays raw information about the conversation in a monospace format
 */
export const RawInfoView: FC<RawInfoViewProps> = ({ content }) => {
  return (
    <RawInfoContainer>
      <Typography variant="h6" gutterBottom sx={{ color: "primary.main" }}>
        Raw Information
      </Typography>
      <RawInfoContent>
        <Typography variant="body2" component="pre" sx={{ fontSize: "0.8rem" }}>
          {content}
        </Typography>
      </RawInfoContent>
    </RawInfoContainer>
  );
};
