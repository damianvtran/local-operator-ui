import { ThemeProvider } from "@mui/material";
import CssBaseline from "@mui/material/CssBaseline";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./assets/fonts/fonts.css";
import { queryClient } from "./api/query-client";
import App from "./app";
import { ErrorBoundary } from "./components/common/error-boundary";
import theme from "./theme";

document.addEventListener("DOMContentLoaded", () => {
	const root = ReactDOM.createRoot(
		document.getElementById("app") as HTMLElement,
	);
	root.render(
		<React.StrictMode>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider theme={theme}>
					<CssBaseline />
					<ErrorBoundary>
						<BrowserRouter>
							<App />
						</BrowserRouter>
					</ErrorBoundary>
					<ToastContainer
						position="top-right"
						autoClose={5000}
						hideProgressBar={false}
						newestOnTop
						closeOnClick
						rtl={false}
						pauseOnFocusLoss
						draggable
						pauseOnHover
						theme="dark"
						aria-label="toast-notifications"
					/>
					{/* React Query DevTools - only in development (positioned at bottom left) */}
					{process.env.NODE_ENV !== "production" && (
						<ReactQueryDevtools
							initialIsOpen={false}
							position="left"
							buttonPosition="top-left"
						/>
					)}
				</ThemeProvider>
			</QueryClientProvider>
		</React.StrictMode>,
	);
});
