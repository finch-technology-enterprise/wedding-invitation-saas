import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { appTheme } from "./lib/theme";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/dates/styles.css";

import { App } from "./App";
import { ApiError } from "./lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Authorization and validation failures are answers, not outages.
      // Retrying them wastes time and can trip rate limits.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

/**
 * SaaS design layer (V2 §8) on top of Mantine primitives: coherent type
 * scale, spacing rhythm and status semantics shared by both consoles.
 * Components stay Mantine — no hand-rolled dialogs, menus or toasts.
 */
const theme = appTheme;

/**
 * A data router (not <BrowserRouter>) because the editor uses useBlocker
 * to confirm navigation away from unsaved edits, which only data routers
 * support. `basename` mounts the app at /admin so deep links survive a
 * reload — the Worker serves the same shell for every /admin/* path.
 */
const router = createBrowserRouter([{ path: "*", element: <App /> }], {
  basename: "/admin",
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          {/* Bottom-right: the header's primary actions (Save, Preview,
              Publish) live top-right, and a toast there covers the very
              control the toast is reporting on. */}
          <Notifications position="bottom-right" />
          <RouterProvider router={router} />
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>
);
