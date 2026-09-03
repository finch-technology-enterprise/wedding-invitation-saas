/**
 * Server state.
 *
 * TanStack Query owns caching, refetching and invalidation. Draft and
 * invitation data are deliberately given a short stale time: publishing
 * and uploading change server state in ways the UI must not lag behind.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  type InvitationSummary,
  type MediaAsset,
  type PlanLimits,
  type SessionUser,
  type TenantSummary,
  type ThemeManifest,
} from "./api";

export const keys = {
  session: ["session"] as const,
  tenants: ["tenants"] as const,
  tenant: (id: string) => ["tenant", id] as const,
  invitations: (tenantId: string) => ["invitations", tenantId] as const,
  invitation: (id: string) => ["invitation", id] as const,
  draft: (id: string) => ["draft", id] as const,
  media: (id: string) => ["media", id] as const,
  diff: (id: string) => ["diff", id] as const,
  revisions: (id: string) => ["revisions", id] as const,
  previews: (id: string) => ["previews", id] as const,
};

export interface SessionResponse {
  ok: true;
  user: SessionUser;
  tenants: TenantSummary[];
  /** Whether this deployment requires confirmed email addresses. */
  verificationRequired?: boolean;
}

/**
 * Who the server says we are.
 *
 * A 401 is modelled as a value (`null`) rather than an error, because
 * "signed out" is a normal state the UI renders, not a failure. Throwing
 * would leave the last successful result cached alongside the error, and
 * the shell would keep rendering after logout.
 */
export function useSession() {
  return useQuery<SessionResponse | null>({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api.get<SessionResponse>("/auth/session");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useTenant(tenantId: string | undefined) {
  return useQuery({
    queryKey: keys.tenant(tenantId ?? ""),
    queryFn: () =>
      api.get<{ ok: true; tenant: TenantSummary; role: string; limits: PlanLimits }>(
        `/tenants/${tenantId}`
      ),
    enabled: Boolean(tenantId),
  });
}

export function useInvitations(tenantId: string | undefined) {
  return useQuery({
    queryKey: keys.invitations(tenantId ?? ""),
    queryFn: () =>
      api.get<{ ok: true; invitations: InvitationSummary[] }>(`/tenants/${tenantId}/invitations`),
    enabled: Boolean(tenantId),
  });
}

export function useInvitation(id: string | undefined) {
  return useQuery({
    queryKey: keys.invitation(id ?? ""),
    queryFn: () =>
      api.get<{ ok: true; invitation: InvitationSummary & { draftJson: string | null } }>(
        `/invitations/${id}`
      ),
    enabled: Boolean(id),
  });
}

export interface DraftResponse {
  ok: true;
  draft: Record<string, unknown> | null;
  draftUpdatedAt: number | null;
  status: string;
  hasPublished: boolean;
  manifest: ThemeManifest;
}

export function useDraft(id: string | undefined) {
  return useQuery({
    queryKey: keys.draft(id ?? ""),
    queryFn: () => api.get<DraftResponse>(`/invitations/${id}/draft`),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export function useMedia(id: string | undefined) {
  return useQuery({
    queryKey: keys.media(id ?? ""),
    queryFn: () => api.get<{ ok: true; media: MediaAsset[] }>(`/invitations/${id}/media`),
    enabled: Boolean(id),
  });
}

export function useDiff(id: string | undefined) {
  return useQuery({
    queryKey: keys.diff(id ?? ""),
    queryFn: () =>
      api.get<{ ok: true; changed: string[]; mediaChanged: string[]; hasChanges: boolean }>(
        `/invitations/${id}/diff`
      ),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

/** Everything a publish or draft save can invalidate, in one place. */
function invalidateInvitation(qc: QueryClient, id: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.invitation(id) }),
    qc.invalidateQueries({ queryKey: keys.draft(id) }),
    qc.invalidateQueries({ queryKey: keys.diff(id) }),
    qc.invalidateQueries({ queryKey: keys.media(id) }),
    qc.invalidateQueries({ queryKey: keys.revisions(id) }),
    qc.invalidateQueries({ queryKey: ["invitations"] }),
  ]);
}

export function useSaveDraft(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      api.put<{ ok: true; draftUpdatedAt: number }>(`/invitations/${id}/draft`, { config }),
    onSuccess: () => invalidateInvitation(qc, id),
  });
}

export function usePublish(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) =>
      api.post<{ ok: true; revisionId: string }>(`/invitations/${id}/publish`, { note }),
    onSuccess: () => invalidateInvitation(qc, id),
  });
}

export function useUnpublish(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>(`/invitations/${id}/unpublish`),
    onSuccess: () => invalidateInvitation(qc, id),
  });
}

export function useCreatePreview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; token: string; url: string; expiresAt: number }>(
        `/invitations/${id}/preview`
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.previews(id) }),
  });
}

export function useDeleteMedia(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => api.del<{ ok: true }>(`/invitations/${id}/media/${assetId}`),
    onSuccess: () => invalidateInvitation(qc, id),
  });
}

export function useCreateInvitation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; slug: string; themeId: string }) =>
      api.post<{ ok: true; invitationId: string; slug: string }>(
        `/tenants/${tenantId}/invitations`,
        input
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invitations(tenantId) }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/auth/logout"),
    onSuccess: () => {
      // Write the signed-out state directly. clear() alone removes the
      // cache entry without notifying the mounted observer, so the shell
      // would keep rendering the previous session until something else
      // happened to refetch.
      qc.setQueryData(keys.session, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    },
  });
}
