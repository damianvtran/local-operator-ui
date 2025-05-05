import type { FC } from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { CATEGORY_ICON_MAP } from "./agent-tags-and-categories";
import { Layers, CircleEllipsis } from "lucide-react";

type AgentCategoriesSidebarProps = {
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
};

const SidebarContainer = styled(Box)(({ theme }) => ({
  width: 240,
  minWidth: 200,
  maxWidth: 280,
  backgroundColor: theme.palette.background.default,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  padding: theme.spacing(2, 0),
  display: "flex",
  flexDirection: "column",
  boxShadow: theme.shadows[1],
  marginRight: theme.spacing(3),
  height: "100%",
  overflowY: "auto",
  "&::-webkit-scrollbar": {
    width: "8px",
  },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: theme.palette.mode === "dark" ? "#888" : "#ccc",
    borderRadius: "4px",
  },
}));

const CategoryList = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing(0.5),
}));

const CategoryItem = styled(Box, {
  shouldForwardProp: (prop) => prop !== "selected",
})<{ selected: boolean }>(({ theme, selected }) => ({
  display: "flex",
  alignItems: "center",
  cursor: "pointer",
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(1.2, 2),
  background: selected
    ? theme.palette.action.selected
    : "transparent",
  color: selected
    ? theme.palette.primary.main
    : theme.palette.text.primary,
  fontWeight: selected ? 600 : 400,
  fontSize: "0.95rem",
  transition: "background 0.2s, color 0.2s",
  "&:hover": {
    background: theme.palette.action.hover,
  },
  // Ensure icon and text are perfectly aligned
  gap: theme.spacing(1.2),
}));

const AllCategoriesItem = styled(CategoryItem)(({ theme }) => ({
  fontWeight: 500,
  color: theme.palette.text.secondary,
  marginBottom: theme.spacing(1),
}));

/**
 * Sidebar for selecting agent categories.
 */
export const AgentCategoriesSidebar: FC<AgentCategoriesSidebarProps> = ({
  selectedCategory,
  onSelectCategory,
}) => {
  // Get all unique category keys from CATEGORY_ICON_MAP
  const categories = Object.keys(CATEGORY_ICON_MAP);

  return (
    <SidebarContainer>
      <Typography variant="subtitle1" sx={{ px: 2, mb: 1, fontWeight: 600 }}>
        Categories
      </Typography>
      <CategoryList>
        <AllCategoriesItem
          selected={selectedCategory === null}
          onClick={() => onSelectCategory(null)}
          data-testid="category-all"
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.7,
              height: 22,
              width: 22,
              minWidth: 22,
            }}
          >
            <Layers size={18} style={{ display: "block" }} />
          </Box>
          <span style={{ lineHeight: 1.2 }}>All Categories</span>
        </AllCategoriesItem>
        {categories.map((cat) => {
          const entry = CATEGORY_ICON_MAP[cat];
          // Use a special icon for "other"
          const icon =
            cat === "other"
              ? <CircleEllipsis size={16} style={{ display: "block" }} />
              : entry.icon;
          return (
            <CategoryItem
              key={cat}
              selected={selectedCategory === cat}
              onClick={() => onSelectCategory(cat)}
              data-testid={`category-${cat}`}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 22,
                  width: 22,
                  minWidth: 22,
                }}
              >
                {icon}
              </Box>
              <span style={{ lineHeight: 1.2 }}>{entry.label}</span>
            </CategoryItem>
          );
        })}
      </CategoryList>
    </SidebarContainer>
  );
};
