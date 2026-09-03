import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import {
  AppShell,
  Burger,
  Button,
  Group,
  Menu,
  NavLink,
  Select,
  Text,
  Title,
} from "@mantine/core";
import { IconCalendarHeart, IconLogout, IconSettings, IconUser } from "@tabler/icons-react";

import { useLogout, type SessionResponse } from "../lib/queries";

/** The active tenant lives in component state, not storage: it is a view
 *  preference, and every request is authorized server-side regardless. */
export const TenantContext = { current: "" };

export function Shell({ session }: { session: SessionResponse }) {
  const [opened, { toggle, close }] = useDisclosure();
  const [tenantId, setTenantId] = useState(session.tenants[0]!.id);
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();

  TenantContext.current = tenantId;

  const nav = [
    { to: "/", label: "Dashboard", icon: IconCalendarHeart },
    { to: "/invitations", label: "Invitations", icon: IconCalendarHeart },
    { to: "/settings", label: "Settings", icon: IconSettings },
  ];

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Title order={4}>Invitations</Title>
          </Group>

          <Group gap="sm">
            {session.tenants.length > 1 && (
              <Select
                aria-label="Workspace"
                data={session.tenants.map((t) => ({ value: t.id, label: t.name }))}
                value={tenantId}
                onChange={(v) => v && setTenantId(v)}
                size="xs"
                w={180}
                allowDeselect={false}
              />
            )}
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="subtle" size="xs" leftSection={<IconUser size={16} />}>
                  {session.user.displayName ?? session.user.email}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconLogout size={16} />}
                  onClick={() =>
                    logout.mutate(undefined, { onSuccess: () => navigate("/", { replace: true }) })
                  }
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {nav.map((item) => (
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
        <Text size="xs" c="dimmed" mt="auto" p="xs">
          {session.tenants.find((t) => t.id === tenantId)?.name}
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet context={{ tenantId, session }} />
      </AppShell.Main>
    </AppShell>
  );
}

export interface ShellContext {
  tenantId: string;
  session: SessionResponse;
}
