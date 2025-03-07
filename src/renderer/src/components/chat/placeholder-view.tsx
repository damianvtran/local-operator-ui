import { faArrowRight, faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Paper, Typography, styled } from "@mui/material";
import type { FC } from "react";

/**
 * Props for the PlaceholderView component
 */
type PlaceholderViewProps = {
  title: string;
  description: string;
  directionText?: string;
};

const PlaceholderContainer = styled(Paper)({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  flexGrow: 1,
  borderRadius: 0,
  justifyContent: "center",
  alignItems: "center",
  padding: 24,
});

const PlaceholderIcon = styled(FontAwesomeIcon)({
  fontSize: "3rem",
  marginBottom: "1rem",
  opacity: 0.5,
});

const DirectionIndicator = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  color: theme.palette.primary.main,
  opacity: 0.7,
}));

/**
 * PlaceholderView Component
 * 
 * Displays a placeholder when no content is available
 */
export const PlaceholderView: FC<PlaceholderViewProps> = ({
  title,
  description,
  directionText,
}) => {
  return (
    <PlaceholderContainer elevation={0}>
      <PlaceholderIcon icon={faRobot} />
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>
        {title}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        align="center"
        sx={{ mb: 2, maxWidth: 500 }}
      >
        {description}
      </Typography>
      {directionText && (
        <DirectionIndicator>
          <FontAwesomeIcon
            icon={faArrowRight}
            style={{ transform: "rotate(180deg)", marginRight: "0.5rem" }}
          />
          <Typography variant="body2">{directionText}</Typography>
        </DirectionIndicator>
      )}
    </PlaceholderContainer>
  );
};
