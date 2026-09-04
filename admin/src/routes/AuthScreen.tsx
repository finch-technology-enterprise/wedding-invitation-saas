import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "@mantine/form";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { api, ApiError } from "../lib/api";
import { keys } from "../lib/queries";

interface StatusResponse {
  ok: true;
  mode: "hosted" | "self_hosted";
  needsBootstrap: boolean;
  registrationOpen: boolean;
}

/** Server error codes rendered as something a person can act on. */
function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  switch (error.payload.error) {
    case "invalid_credentials":
      return "That email and password combination is not recognised.";
    case "rate_limited":
      return `Too many attempts. Try again in ${error.payload.retryAfter ?? 60} seconds.`;
    case "password_too_short":
      return "Passwords must be at least 10 characters.";
    case "invalid_email":
      return "That does not look like an email address.";
    case "registration_closed":
      return "Registration is closed on this instance.";
    case "registration_failed":
      return "That account could not be created.";
    case "already_bootstrapped":
      return "This instance already has an administrator. Sign in instead.";
    case "csrf":
      return "Your session expired. Reload the page and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function AuthScreen({ noTenant }: { noTenant?: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Decides whether this instance needs first-run setup, and whether
  // hosted registration is available at all. Fetched once on mount —
  // never during render (V2 §1.7).
  useEffect(() => {
    let cancelled = false;
    void api
      .get<StatusResponse>("/auth/status")
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.needsBootstrap) setMode("register");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ ok: true, mode: "hosted", needsBootstrap: false, registrationOpen: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (v) => (/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v) ? null : "Enter a valid email"),
      password: (v) => (v.length >= 10 ? null : "At least 10 characters"),
    },
  });

  const bootstrapping = status?.needsBootstrap === true;

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const path = bootstrapping
        ? "/auth/bootstrap"
        : mode === "register"
          ? "/auth/register"
          : "/auth/login";
      await api.post(path, values);
      await qc.invalidateQueries({ queryKey: keys.session });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  });

  if (noTenant) {
    return (
      <Center h="100vh" p="md">
        <Card withBorder maw={420} w="100%" padding="lg">
          <Title order={3}>No workspace</Title>
          <Text c="dimmed" mt="sm">
            Your account is not a member of any workspace. Ask an owner to invite you.
          </Text>
        </Card>
      </Center>
    );
  }

  return (
    <Center h="100vh" p="md">
      <Card withBorder maw={420} w="100%" padding="lg" component="main">
        <Stack>
          <div>
            <Title order={2}>
              {bootstrapping ? "Set up this instance" : mode === "register" ? "Create account" : "Sign in"}
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              {bootstrapping
                ? "You are the first user, so this account becomes the administrator."
                : "Manage your invitations."}
            </Text>
          </div>

          {error && (
            <Alert color="red" role="alert" variant="light">
              {error}
            </Alert>
          )}

          <form onSubmit={submit} noValidate>
            <Stack>
              <TextInput
                label="Email"
                type="email"
                autoComplete="email"
                required
                {...form.getInputProps("email")}
              />
              <PasswordInput
                label="Password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                {...form.getInputProps("password")}
              />
              <Button type="submit" loading={busy} fullWidth>
                {bootstrapping ? "Create administrator" : mode === "register" ? "Create account" : "Sign in"}
              </Button>
              {!bootstrapping && mode === "login" && (
                <Anchor size="sm" ta="center" href="/admin/forgot-password">
                  Forgot your password?
                </Anchor>
              )}
            </Stack>
          </form>

          {!bootstrapping && status?.registrationOpen && (
            <Group justify="center" gap={6}>
              <Text size="sm" c="dimmed">
                {mode === "login" ? "No account?" : "Already registered?"}
              </Text>
              <Anchor
                size="sm"
                component="button"
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? "Create one" : "Sign in"}
              </Anchor>
            </Group>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
