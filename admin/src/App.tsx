import { Navigate, Route, Routes } from "react-router-dom";
import { Center, Loader } from "@mantine/core";

import { useSession } from "./lib/queries";
import { AuthScreen } from "./routes/AuthScreen";
import { Shell } from "./components/Shell";
import { Dashboard } from "./routes/Dashboard";
import { InvitationList } from "./routes/InvitationList";
import { NewInvitation } from "./routes/NewInvitation";
import { InvitationEditor } from "./routes/InvitationEditor";
import { ContentPanel } from "./routes/ContentPanel";
import { MediaPanel } from "./routes/MediaPanel";
import { MotionPanel } from "./routes/MotionPanel";
import { RsvpPanel } from "./routes/RsvpPanel";
import { ResponsesPanel } from "./routes/ResponsesPanel";
import { PublishPanel } from "./routes/PublishPanel";
import { SharingPanel } from "./routes/SharingPanel";
import { SettingsPanel } from "./routes/SettingsPanel";

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

  // null means "signed out"; an error means the request itself failed.
  if (!session.data) {
    return <AuthScreen />;
  }

  // A user with no tenant cannot administer anything. This should not
  // happen (registration creates one atomically) but it is a real state
  // if an operator removed the last membership.
  if (!session.data.tenants.length) {
    return <AuthScreen noTenant />;
  }

  return (
    <Routes>
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
          <Route path="responses" element={<ResponsesPanel />} />
          <Route path="sharing" element={<SharingPanel />} />
          <Route path="publish" element={<PublishPanel />} />
        </Route>
        <Route path="settings" element={<SettingsPanel />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
