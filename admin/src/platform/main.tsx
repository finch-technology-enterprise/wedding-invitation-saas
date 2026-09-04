import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { PlatformApp } from "./PlatformApp";
import { ApiError } from "../lib/api";
import { appTheme } from "../lib/theme";

/**
 * Operator console entry point.
 *
 * A separate Vite entry rather than a route inside the tenant admin: it
 * is a different authorization domain, and a tenant should never receive
 * this code. Shared dependencies (React, Mantine, Query) are emitted as
 * common chunks, which is fine — what matters is that no tenant page
 * requests the operator's own modules.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

const router = createBrowserRouter([{ path: "*", element: <PlatformApp /> }], {
  basename: "/platform-admin",
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={appTheme} defaultColorScheme="light">
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          <Notifications position="top-right" />
          <RouterProvider router={router} />
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>
);
