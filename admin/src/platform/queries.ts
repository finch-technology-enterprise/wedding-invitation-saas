/** Operator API bindings. Every path is platform-authorized server-side. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const BASE = "/platform";

export const pkeys = {
  overview: ["p", "overview"] as const,
  users: (q: string) => ["p", "users", q] as const,
  tenants: (q: string) => ["p", "tenants", q] as const,
  invitations: (q: string) => ["p", "invitations", q] as const,
  invitation: (id: string) => ["p", "invitation", id] as const,
  storage: ["p", "storage"] as const,
  consistency: ["p", "consistency"] as const,
  system: ["p", "system"] as const,
  audit: ["p", "audit"] as const,
};

export interface Overview {
  ok: true;
  totals: {
    users: number;
    tenants: number;
    invitations: number;
    published: number;
    submissions: number;
    mediaAssets: number;
  };
  storage: { totalBytes: number; imageBytes: number; audioBytes: number };
  statusCounts: Array<{ status: string; count: number }>;
}

export interface PlatformUser {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  isPlatformAdmin: number;
  createdAt: number;
  tenantCount: number;
  invitationCount: number;
  storageBytes: number;
  activeSessions: number;
}

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerEmail: string | null;
  memberCount: number;
  invitationCount: number;
  publishedCount: number;
  storageBytes: number;
  rsvpCount: number;
  createdAt: number;
}

export interface PlatformInvitation {
  id: string;
  title: string;
  slug: string;
  themeId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  rsvpCount: number;
  counterBytes: number;
  tenantId: string;
  tenantName: string;
  ownerEmail: string | null;
  revisionCount: number;
  mediaCount: number;
  storageBytes: number;
}

export function useOverview() {
  return useQuery({ queryKey: pkeys.overview, queryFn: () => api.get<Overview>(`${BASE}/overview`) });
}

export function useUsers(params: URLSearchParams) {
  const q = params.toString();
  return useQuery({
    queryKey: pkeys.users(q),
    queryFn: () => api.get<{ ok: true; users: PlatformUser[]; total: number }>(`${BASE}/users?${q}`),
  });
}

export function useTenants(params: URLSearchParams) {
  const q = params.toString();
  return useQuery({
    queryKey: pkeys.tenants(q),
    queryFn: () =>
      api.get<{ ok: true; tenants: PlatformTenant[]; total: number }>(`${BASE}/tenants?${q}`),
  });
}

export function useInvitations(params: URLSearchParams) {
  const q = params.toString();
  return useQuery({
    queryKey: pkeys.invitations(q),
    queryFn: () =>
      api.get<{ ok: true; invitations: PlatformInvitation[]; total: number }>(
        `${BASE}/invitations?${q}`
      ),
  });
}

export function useStorage() {
  return useQuery({
    queryKey: pkeys.storage,
    queryFn: () =>
      api.get<{
        ok: true;
        totals: {
          assetCount: number;
          totalBytes: number;
          imageBytes: number;
          audioBytes: number;
          imageCount: number;
          audioCount: number;
        };
        byTenant: Array<{ id: string; name: string; assetCount: number; bytes: number }>;
        byInvitation: Array<{
          id: string;
          title: string;
          slug: string;
          tenantName: string;
          assetCount: number;
          bytes: number;
        }>;
        largestAssets: Array<{
          id: string;
          kind: string;
          mimeType: string;
          byteSize: number;
          width: number | null;
          height: number | null;
          invitationTitle: string;
          tenantName: string;
          createdAt: number;
        }>;
      }>(`${BASE}/storage`),
  });
}

export function useConsistency() {
  return useQuery({
    queryKey: pkeys.consistency,
    queryFn: () =>
      api.get<{
        ok: true;
        drifted: Array<{
          id: string;
          title: string;
          counterBytes: number;
          actualBytes: number;
          delta: number;
        }>;
        count: number;
      }>(`${BASE}/storage/consistency`),
  });
}

export function useRecalculate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{
        ok: true;
        repaired: Array<{ invitationId: string; before: number; calculated: number; after: number }>;
        count: number;
      }>(`${BASE}/storage/recalculate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pkeys.consistency });
      void qc.invalidateQueries({ queryKey: pkeys.storage });
    },
  });
}

export function useSystem() {
  return useQuery({
    queryKey: pkeys.system,
    queryFn: () =>
      api.get<{
        ok: true;
        mode: string;
        bindings: { d1: boolean; r2: boolean };
        settings: Array<{ key: string; value: string }>;
        passwordIterations: number;
      }>(`${BASE}/system`),
  });
}

export function useAudit() {
  return useQuery({
    queryKey: pkeys.audit,
    queryFn: () =>
      api.get<{
        ok: true;
        events: Array<{
          id: string;
          action: string;
          targetType: string;
          targetId: string;
          metaJson: string | null;
          ok: number;
          createdAt: number;
          actorEmail: string | null;
        }>;
      }>(`${BASE}/audit?limit=100`),
  });
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; status: "active" | "disabled" }) =>
      api.post(`${BASE}/users/${input.userId}/status`, { status: input.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p", "users"] }),
  });
}

export function useRevokeSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post(`${BASE}/users/${userId}/revoke-sessions`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p", "users"] }),
  });
}

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { tenantId: string; status: "active" | "suspended" }) =>
      api.post(`${BASE}/tenants/${input.tenantId}/status`, { status: input.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p", "tenants"] }),
  });
}

// ------------------------------------------------------------------ cleanup

export interface Impact {
  invitationId: string;
  title: string;
  slug: string;
  tenantName: string;
  ownerEmail: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  revisionCount: number;
  mediaCount: number;
  storageBytes: number;
  rsvpSubmissionCount: number;
  rsvpAnswerCount: number;
  rsvpFieldCount: number;
  previewTokenCount: number;
}

export interface ImpactTotals {
  invitations: number;
  revisions: number;
  media: number;
  bytes: number;
  submissions: number;
  answers: number;
  fields: number;
  previewTokens: number;
}

export function useImpact() {
  return useMutation({
    mutationFn: (invitationIds: string[]) =>
      api.post<{ ok: true; impacts: Impact[]; totals: ImpactTotals; missing: number }>(
        `${BASE}/cleanup/impact`,
        { invitationIds }
      ),
  });
}

export function useDeleteInvitations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { invitationIds: string[]; confirm: string }) =>
      api.post<{
        ok: true;
        results: Array<{
          invitationId: string;
          ok: boolean;
          status: string;
          deletedObjects: number;
          failedObjects: number;
          bytesFreed: number;
          error?: string;
        }>;
        removed: number;
        failed: number;
        bytesFreed: number;
      }>(`${BASE}/cleanup/delete`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["p"] });
    },
  });
}

export interface OrphanCandidate {
  key: string;
  size: number;
  uploaded: number | null;
  tenantId: string | null;
  tenantName: string | null;
  invitationId: string | null;
  invitationTitle: string | null;
  referencedInD1: boolean;
}

export function useOrphanScan() {
  return useMutation({
    mutationFn: (cursor?: string) =>
      api.get<{
        ok: true;
        candidates: OrphanCandidate[];
        cursor: string | null;
        done: boolean;
        scanned: number;
      }>(`${BASE}/cleanup/orphans${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  });
}

export function useDeleteOrphans() {
  return useMutation({
    mutationFn: (input: { keys: string[]; confirm: string }) =>
      api.post<{ ok: true; deleted: number; skipped: string[]; failed: string[] }>(
        `${BASE}/cleanup/orphans/delete`,
        input
      ),
  });
}
