import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "@mantine/form";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconCheck, IconMail } from "@tabler/icons-react";

import { api, ApiError } from "../lib/api";
import { keys } from "../lib/queries";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Center h="100vh" p="md">
      <Card withBorder maw={420} w="100%" padding="lg" component="main">
        <Stack>
          <Title order={2}>{title}</Title>
          {children}
        </Stack>
      </Card>
    </Center>
  );
}

/**
 * Request a reset link.
 *
 * The server answers identically whether or not the address exists, and
 * this screen shows that same answer — showing "no such account" here
 * would reintroduce the enumeration oracle the API avoids.
 */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { email: "" },
    validate: {
      email: (v) => (/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v) ? null : "Enter a valid email"),
    },
  });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", values);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.payload.error === "rate_limited"
          ? "Too many requests. Please wait a few minutes and try again."
          : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  });

  if (sent) {
    return (
      <Shell title="Check your email">
        <Alert color="blue" variant="light" icon={<IconMail size={18} />}>
          <Text size="sm">
            If an account exists for that address, we have sent a link to reset your password. It
            expires in 45 minutes.
          </Text>
        </Alert>
        <Text size="sm" c="dimmed">
          Nothing arrived? Check your spam folder, or try again in a few minutes.
        </Text>
        <Button variant="subtle" onClick={() => navigate("/")}>
          Back to sign in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="Reset your password">
      <Text size="sm" c="dimmed">
        Enter your email and we will send you a link to choose a new password.
      </Text>

      {error && (
        <Alert color="red" variant="light" role="alert">
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
          <Button type="submit" loading={busy} fullWidth>
            Send reset link
          </Button>
          <Anchor size="sm" ta="center" component="button" type="button" onClick={() => navigate("/")}>
            Back to sign in
          </Anchor>
        </Stack>
      </form>
    </Shell>
  );
}

/** Choose a new password using a token from the emailed link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = params.get("token") ?? "";

  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { password: "", confirm: "" },
    validate: {
      password: (v) => (v.length >= 10 ? null : "At least 10 characters"),
      confirm: (v, values) => (v === values.password ? null : "Passwords do not match"),
    },
  });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password: values.password });
      // Every session was revoked server-side, including any this browser
      // held; drop cached state so the app re-reads it.
      qc.clear();
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.payload.error === "invalid_token"
          ? "This link has expired or has already been used. Request a new one."
          : "Could not reset your password. Please try again."
      );
    } finally {
      setBusy(false);
    }
  });

  if (!token) {
    return (
      <Shell title="Link not valid">
        <Text size="sm" c="dimmed">
          This reset link is incomplete. Request a new one.
        </Text>
        <Button onClick={() => navigate("/forgot-password")}>Request a new link</Button>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password changed">
        <Alert color="green" variant="light" icon={<IconCheck size={18} />}>
          <Text size="sm">
            Your password has been changed and you have been signed out everywhere else.
          </Text>
        </Alert>
        <Button onClick={() => navigate("/")}>Sign in</Button>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password">
      {error && (
        <Alert color="red" variant="light" role="alert">
          {error}
        </Alert>
      )}

      <form onSubmit={submit} noValidate>
        <Stack>
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            required
            {...form.getInputProps("password")}
          />
          <PasswordInput
            label="Confirm new password"
            autoComplete="new-password"
            required
            {...form.getInputProps("confirm")}
          />
          <Text size="xs" c="dimmed">
            Changing your password signs out every other device.
          </Text>
          <Button type="submit" loading={busy} fullWidth>
            Change password
          </Button>
        </Stack>
      </form>
    </Shell>
  );
}

/** Redeem a verification token from the emailed link. */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<"working" | "done" | "failed">("working");

  useEffect(() => {
    if (!token) {
      setState("failed");
      return;
    }
    let cancelled = false;
    void api
      .post("/auth/verify-email", { token })
      .then(async () => {
        if (cancelled) return;
        // The session's verified flag changed; re-read it.
        await qc.invalidateQueries({ queryKey: keys.session });
        setState("done");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [token, qc]);

  if (state === "working") {
    return (
      <Shell title="Confirming your email">
        <Center py="lg">
          <Loader />
        </Center>
      </Shell>
    );
  }

  if (state === "done") {
    return (
      <Shell title="Email confirmed">
        <Alert color="green" variant="light" icon={<IconCheck size={18} />}>
          <Text size="sm">Your email address is confirmed. Your account is ready to use.</Text>
        </Alert>
        <Button onClick={() => navigate("/")}>Continue</Button>
      </Shell>
    );
  }

  return (
    <Shell title="Link not valid">
      <Text size="sm" c="dimmed">
        This confirmation link has expired or has already been used. Sign in and request a new one.
      </Text>
      <Button onClick={() => navigate("/")}>Go to sign in</Button>
    </Shell>
  );
}

/**
 * Shown in place of the console when a hosted account is unverified.
 *
 * The API refuses tenant work for these users, so rendering the editor
 * would only produce confusing 403s.
 */
export function VerificationRequired({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/send-verification");
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.payload.error === "rate_limited"
          ? "Too many requests. Please wait a few minutes."
          : err instanceof ApiError && err.payload.error === "email_not_configured"
            ? "Email is not configured on this instance. Ask the operator for help."
            : "Could not send the email. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Confirm your email">
      <Text size="sm" c="dimmed">
        We sent a confirmation link to <strong>{email}</strong>. Open it to finish setting up your
        account.
      </Text>

      {error && (
        <Alert color="red" variant="light" role="alert">
          {error}
        </Alert>
      )}

      {sent && (
        <Alert color="green" variant="light">
          <Text size="sm">Confirmation email sent.</Text>
        </Alert>
      )}

      <Button onClick={resend} loading={busy} variant="light">
        Resend confirmation email
      </Button>

      <Button
        variant="subtle"
        onClick={async () => {
          await qc.invalidateQueries({ queryKey: keys.session });
        }}
      >
        I have confirmed it
      </Button>

      <Button
        variant="subtle"
        color="gray"
        onClick={async () => {
          await api.post("/auth/logout");
          qc.setQueryData(keys.session, null);
        }}
      >
        Sign out
      </Button>
    </Shell>
  );
}
