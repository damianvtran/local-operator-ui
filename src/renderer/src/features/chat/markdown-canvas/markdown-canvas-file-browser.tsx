import { faFile, faFolder, faFolderOpen, faArrowUp } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography, Divider, CircularProgress, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";

// Define FileInfo interface locally to avoid importing from main process
interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  extension: string;
  size: number;
  lastModified: number;
}

interface MarkdownCanvasFileBrowserProps {
  /**
   * Initial file path to browse from
   */
  initialPath: string;

  /**
   * Callback when a file is selected
   */
  onFileSelect: (filePath: string) => void;
}

/**
 * Styled container for the file browser
 */
const FileBrowserContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
  backgroundColor: theme.palette.background.paper,
}));

/**
 * Styled header for the file browser
 */
const FileBrowserHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}));

/**
 * Styled list container
 */
const FileBrowserList = styled(List)(({ theme }) => ({
  flexGrow: 1,
  overflow: "auto",
  padding: 0,
  "& .MuiListItemButton-root": {
    borderRadius: 0,
  },
}));

/**
 * Styled path display
 */
const PathDisplay = styled(Typography)(({ theme }) => ({
  fontSize: "0.85rem",
  color: theme.palette.text.secondary,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
}));

/**
 * Component for browsing files in the markdown canvas
 */
export const MarkdownCanvasFileBrowser: FC<MarkdownCanvasFileBrowserProps> = ({
  initialPath,
  onFileSelect,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load files from the current directory
  const loadFiles = useCallback(async (dirPath: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.api.listDirectory(dirPath);
      if (result.success) {
        setFiles(result.files);
        setCurrentPath(dirPath);
      } else {
        setError(`Failed to load directory: ${result.error}`);
        console.error("Error loading directory:", result.error);
      }
    } catch (err) {
      setError("Failed to load directory");
      console.error("Error loading directory:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load initial directory
  useEffect(() => {
    loadFiles(initialPath);
  }, [initialPath, loadFiles]);

  // Handle file or directory click
  const handleItemClick = useCallback(
    (file: FileInfo) => {
      if (file.isDirectory) {
        loadFiles(file.path);
      } else {
        // Check if it's a markdown file
        if (file.extension.toLowerCase() === ".md") {
          onFileSelect(file.path);
        }
      }
    },
    [loadFiles, onFileSelect]
  );

  // Handle going up to parent directory
  const handleGoUp = useCallback(async () => {
    try {
      const result = await window.api.getParentDirectory(currentPath);
      if (result.success && result.directory) {
        loadFiles(result.directory);
      }
    } catch (err) {
      console.error("Error navigating to parent directory:", err);
    }
  }, [currentPath, loadFiles]);

  return (
    <FileBrowserContainer>
      <FileBrowserHeader>
        <Typography variant="subtitle1" gutterBottom>
          File Browser
        </Typography>
        <PathDisplay>{currentPath}</PathDisplay>
      </FileBrowserHeader>

      <Divider />

      {isLoading ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
          }}
        >
          <CircularProgress size={24} />
        </Box>
      ) : error ? (
        <Box
          sx={{
            p: 2,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
          }}
        >
          <Typography color="error">{error}</Typography>
        </Box>
      ) : (
        <FileBrowserList>
          {/* Parent directory button */}
          <ListItem disablePadding>
            <ListItemButton onClick={handleGoUp}>
              <ListItemIcon>
                <FontAwesomeIcon icon={faArrowUp} />
              </ListItemIcon>
              <ListItemText primary="Parent Directory" />
            </ListItemButton>
          </ListItem>

          <Divider />

          {/* Directories first */}
          {files
            .filter((file) => file.isDirectory)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((file) => (
              <ListItem key={file.path} disablePadding>
                <ListItemButton onClick={() => handleItemClick(file)}>
                  <ListItemIcon>
                    <FontAwesomeIcon icon={faFolder} />
                  </ListItemIcon>
                  <ListItemText
                    primary={file.name}
                    primaryTypographyProps={{
                      noWrap: true,
                      title: file.name,
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}

          {/* Then markdown files */}
          {files
            .filter(
              (file) =>
                !file.isDirectory && file.extension.toLowerCase() === ".md"
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((file) => (
              <ListItem key={file.path} disablePadding>
                <ListItemButton onClick={() => handleItemClick(file)}>
                  <ListItemIcon>
                    <FontAwesomeIcon icon={faFile} />
                  </ListItemIcon>
                  <ListItemText
                    primary={file.name}
                    primaryTypographyProps={{
                      noWrap: true,
                      title: file.name,
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
        </FileBrowserList>
      )}
    </FileBrowserContainer>
  );
};
