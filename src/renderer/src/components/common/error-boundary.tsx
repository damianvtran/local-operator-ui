import {
	faExclamationTriangle,
	faRedo,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Button, Paper, Typography } from "@mui/material";
import type React from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
	type FallbackProps,
	ErrorBoundary as ReactErrorBoundary,
} from "react-error-boundary";

/**
 * Props for the ErrorBoundary component
 */
type ErrorBoundaryProps = {
	/**
	 * The children to render
	 */
	children: ReactNode;

	/**
	 * Optional fallback component to render when an error occurs
	 */
	fallback?: ReactNode;
};

/**
 * Error fallback component that displays error details
 */
const ErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
	return (
		<Paper
			elevation={0}
			sx={{
				p: 4,
				m: 2,
				borderRadius: 2,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				textAlign: "center",
				height: "100%",
			}}
		>
			<FontAwesomeIcon
				icon={faExclamationTriangle}
				style={{
					fontSize: "3rem",
					color: "#f44336",
					marginBottom: "1rem",
				}}
			/>

			<Typography variant="h5" gutterBottom>
				Something went wrong
			</Typography>

			<Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
				The application encountered an error. Please try again or contact
				support if the problem persists.
			</Typography>

			<Button
				variant="contained"
				color="primary"
				startIcon={<FontAwesomeIcon icon={faRedo} />}
				onClick={resetErrorBoundary}
				sx={{ mb: 3 }}
			>
				Try Again
			</Button>

			{/* Show error details in development */}
			{
				<Box
					sx={{
						mt: 2,
						p: 2,
						bgcolor: "rgba(0, 0, 0, 0.1)",
						borderRadius: 1,
						width: "100%",
						maxWidth: "800px",
						overflow: "auto",
						textAlign: "left",
					}}
				>
					<Typography variant="subtitle2" gutterBottom>
						Error Details:
					</Typography>

					<Typography
						variant="body2"
						component="pre"
						sx={{ whiteSpace: "pre-wrap", mb: 2 }}
					>
						{error?.message}
					</Typography>

					<Typography variant="subtitle2" gutterBottom>
						Stack Trace:
					</Typography>

					<Typography
						variant="body2"
						component="pre"
						sx={{ whiteSpace: "pre-wrap" }}
					>
						{error?.stack}
					</Typography>
				</Box>
			}
		</Paper>
	);
};

/**
 * Error boundary component that catches JavaScript errors in its child component tree
 * and displays a fallback UI instead of crashing the whole application.
 */
export const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({
	children,
	fallback,
}) => {
	// Log errors to console
	const onError = (error: Error, info: ErrorInfo) => {
		console.error("Error caught by ErrorBoundary:", error, info);
	};

	return (
		<ReactErrorBoundary
			FallbackComponent={fallback ? () => <>{fallback}</> : ErrorFallback}
			onError={onError}
		>
			{children}
		</ReactErrorBoundary>
	);
};
