import { Suspense, lazy } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import {
  AppShell,
  Alert,
  Burger,
  Card,
  Center,
  Group,
  Loader,
  NavLink,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconChartBar,
  IconDatabase,
  IconMail,
  IconServer,
  IconTrash,
  IconUsers,
  IconBuilding,
  IconHistory,
} from "@tabler/icons-react";

import { useSession } from "../lib/queries";

/**
 * Heavy operator views load on demand. The overview is the landing
 * surface and ships with the shell.
 */
const UsersView = lazy(() => import("./UsersView").then((m) => ({ default: m.UsersView })));
const TenantsView = lazy(() => import("./TenantsView").then((m) => ({ default: m.TenantsView })));
const InvitationsView = lazy(() =>
  import("./InvitationsView").then((m) => ({ default: m.InvitationsView }))
);
const StorageView = lazy(() => import("./StorageView").then((m) => ({ default: m.StorageView })));
const CleanupView = lazy(() => import("./CleanupView").then((m) => ({ default: m.CleanupView })));
const SystemView = lazy(() => import("./SystemView").then((m) => ({ default: m.SystemView })));
const AuditView = lazy(() => import("./AuditView").then((m) => ({ default: m.AuditView })));
const OverviewView = lazy(() => import("./OverviewView").then((m) => ({ default: m.OverviewView })));

const NAV = [
  { to: "/", label: "Overview", icon: IconChartBar },
  { to: "/users", label: "Users", icon: IconUsers },
  { to: "/tenants", label: "Workspaces", icon: IconBuilding },
  { to: "/invitations", label: "Invitations", icon: IconMail },
  { to: "/storage", label: "Storage", icon: IconDatabase },
  { to: "/cleanup", label: "Cleanup", icon: IconTrash },
  { to: "/system", label: "System", icon: IconServer },
  { to: "/audit", label: "Audit", icon: IconHistory },
];

function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
          <Title order={4}>Platform</Title>
          <Text size="xs" c="dimmed">
            operator console
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            leftSection={<item.icon size={18} />}
            active={
              item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
            }
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Suspense
          fallback={
            <Center h={240}>
              <Loader />
            </Center>
          }
        >
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  );
}

/**
 * Operator gate.
 *
 * This only decides what to render — the API enforces platform_admin on
 * every request independently, so a user who forces their way past this
 * screen still cannot read or change anything.
 */
export function PlatformApp() {
  const session = useSession();

  if (session.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!session.data || !session.data.user.isPlatformAdmin) {
    return (
      <Center h="100vh" p="md">
        <Card withBorder maw={420} padding="lg">
          <Stack>
            <Title order={3}>Not available</Title>
            <Alert variant="light" color="gray">
              <Text size="sm">
                This area is for platform operators. If you manage invitations, use the{" "}
                <a href="/admin">workspace console</a>.
              </Text>
            </Alert>
          </Stack>
        </Card>
      </Center>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewView />} />
        <Route path="users" element={<UsersView />} />
        <Route path="tenants" element={<TenantsView />} />
        <Route path="invitations" element={<InvitationsView />} />
        <Route path="storage" element={<StorageView />} />
        <Route path="cleanup" element={<CleanupView />} />
        <Route path="system" element={<SystemView />} />
        <Route path="audit" element={<AuditView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
