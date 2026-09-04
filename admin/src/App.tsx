import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Center, Loader } from "@mantine/core";

import { useSession } from "./lib/queries";
import { AuthScreen } from "./routes/AuthScreen";
import {
  ForgotPassword,
  ResetPassword,
  VerificationRequired,
  VerifyEmail,
} from "./routes/RecoveryScreens";
import { Shell } from "./components/Shell";
import { Dashboard } from "./routes/Dashboard";
import { InvitationList } from "./routes/InvitationList";

/**
 * Route-level splitting.
 *
 * The dashboard and invitation list ship with the shell because they are
 * the landing surfaces. Everything heavier loads on demand, so a tenant
 * who never opens the editor does not download the uploader, the focal
 * picker, dnd-kit or the date pickers.
 *
 * The operator console is a separate Vite entry point at
 * /platform-admin, not a lazy route here — a different authorization
 * domain deserves a different bundle, and tenants must never receive it.
 */
const NewInvitation = lazy(() =>
  import("./routes/NewInvitation").then((m) => ({ default: m.NewInvitation }))
);
const InvitationEditor = lazy(() =>
  import("./routes/InvitationEditor").then((m) => ({ default: m.InvitationEditor }))
);
const ContentPanel = lazy(() =>
  import("./routes/ContentPanel").then((m) => ({ default: m.ContentPanel }))
);
const MediaPanel = lazy(() =>
  import("./routes/MediaPanel").then((m) => ({ default: m.MediaPanel }))
);
const MotionPanel = lazy(() =>
  import("./routes/MotionPanel").then((m) => ({ default: m.MotionPanel }))
);
const RsvpPanel = lazy(() => import("./routes/RsvpPanel").then((m) => ({ default: m.RsvpPanel })));
const GuestsPanel = lazy(() =>
  import("./routes/GuestsPanel").then((m) => ({ default: m.GuestsPanel }))
);
const DesignPanel = lazy(() =>
  import("./routes/DesignPanel").then((m) => ({ default: m.DesignPanel }))
);
const ResponsesPanel = lazy(() =>
  import("./routes/ResponsesPanel").then((m) => ({ default: m.ResponsesPanel }))
);
const PublishPanel = lazy(() =>
  import("./routes/PublishPanel").then((m) => ({ default: m.PublishPanel }))
);
const SharingPanel = lazy(() =>
  import("./routes/SharingPanel").then((m) => ({ default: m.SharingPanel }))
);
const SettingsPanel = lazy(() =>
  import("./routes/SettingsPanel").then((m) => ({ default: m.SettingsPanel }))
);
function RouteFallback() {
  return (
    <Center h={240}>
      <Loader />
    </Center>
  );
}

/**
 * Session gate.
 *
 * Everything below renders only for an authenticated caller. There is no
 * client-side "is admin" flag to spoof: the server decides, and a 401
 * from any request surfaces the sign-in screen.
 */
export function App() {
  const session = useSession();

  if (session.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  // Recovery links arrive without a session — someone resetting a
  // password is signed out by definition — so these routes sit outside
  // the auth gate.
  const publicRoutes = (
    <>
      <Route path="forgot-password" element={<ForgotPassword />} />
      <Route path="reset-password" element={<ResetPassword />} />
      <Route path="verify-email" element={<VerifyEmail />} />
    </>
  );

  // null means "signed out"; an error means the request itself failed.
  if (!session.data) {
    return (
      <Routes>
        {publicRoutes}
        <Route path="*" element={<AuthScreen />} />
      </Routes>
    );
  }

  // A hosted account that has not confirmed its address cannot do tenant
  // work — the API refuses it — so showing the console would only produce
  // confusing failures.
  if (session.data.verificationRequired && !session.data.user.emailVerified) {
    return (
      <Routes>
        {publicRoutes}
        <Route path="*" element={<VerificationRequired email={session.data.user.email} />} />
      </Routes>
    );
  }

  // A user with no tenant cannot administer anything. This should not
  // happen (registration creates one atomically) but it is a real state
  // if an operator removed the last membership.
  if (!session.data.tenants.length) {
    return <AuthScreen noTenant />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {publicRoutes}
        <Route element={<Shell session={session.data} />}>
          <Route index element={<Dashboard />} />
          <Route path="invitations" element={<InvitationList />} />
          <Route path="invitations/new" element={<NewInvitation />} />
          <Route path="invitations/:id" element={<InvitationEditor />}>
            <Route index element={<Navigate to="content" replace />} />
            <Route path="content" element={<ContentPanel />} />
            <Route path="media" element={<MediaPanel />} />
            <Route path="motion" element={<MotionPanel />} />
            <Route path="rsvp" element={<RsvpPanel />} />
            <Route path="guests" element={<GuestsPanel />} />
            <Route path="design" element={<DesignPanel />} />
            <Route path="responses" element={<ResponsesPanel />} />
            <Route path="sharing" element={<SharingPanel />} />
            <Route path="publish" element={<PublishPanel />} />
          </Route>
          <Route path="settings" element={<SettingsPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
