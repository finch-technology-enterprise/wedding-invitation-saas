/** Guest parties / invitees API bindings (V2 Phase 5). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface Party {
  id: string;
  title: string;
  note: string | null;
  maxSeats: number | null;
  source: string;
  createdAt: number;
  updatedAt: number;
  hasToken: number;
  guestCount: number;
  attendingCount: number;
  checkedInCount: number;
}

export interface Guest {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  meal: string | null;
  dietary: string | null;
  isChild: number;
  rsvpStatus: "pending" | "attending" | "declined";
  checkedInAt: number | null;
  partyId: string | null;
  partyTitle: string | null;
  source: string;
  createdAt: number;
}

export interface GuestSummary {
  total: number;
  attending: number;
  declined: number;
  pending: number;
  checkedIn: number;
}

const gkeys = {
  parties: (id: string) => ["guests", id, "parties"] as const,
  guests: (id: string, q: string) => ["guests", id, "list", q] as const,
};

export function useParties(invitationId: string | undefined) {
  return useQuery({
    queryKey: gkeys.parties(invitationId ?? ""),
    queryFn: () => api.get<{ ok: true; parties: Party[] }>(`/invitations/${invitationId}/parties`),
    enabled: Boolean(invitationId),
  });
}

export function useGuests(
  invitationId: string | undefined,
  params: { q?: string; status?: string; partyId?: string; limit?: number; offset?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  if (params.partyId) qs.set("partyId", params.partyId);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const key = qs.toString();
  return useQuery({
    queryKey: gkeys.guests(invitationId ?? "", key),
    queryFn: () =>
      api.get<{ ok: true; guests: Guest[]; total: number; summary: GuestSummary }>(
        `/invitations/${invitationId}/guests?${key}`
      ),
    enabled: Boolean(invitationId),
  });
}

export function useGuestMutations(invitationId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["guests", invitationId] });
  };
  return {
    createParty: useMutation({
      mutationFn: (input: { title: string; note?: string; maxSeats?: number }) =>
        api.post<{ ok: true; party: Party; token: string; url: string }>(
          `/invitations/${invitationId}/parties`,
          input
        ),
      onSuccess: invalidate,
    }),
    deleteParty: useMutation({
      mutationFn: (partyId: string) => api.del(`/invitations/${invitationId}/parties/${partyId}`),
      onSuccess: invalidate,
    }),
    rotateToken: useMutation({
      mutationFn: (partyId: string) =>
        api.post<{ ok: true; token: string; url: string }>(
          `/invitations/${invitationId}/parties/${partyId}/rotate-token`
        ),
      onSuccess: invalidate,
    }),
    createGuest: useMutation({
      mutationFn: (input: Record<string, unknown>) =>
        api.post<{ ok: true; guestId: string }>(`/invitations/${invitationId}/guests`, input),
      onSuccess: invalidate,
    }),
    updateGuest: useMutation({
      mutationFn: (input: { guestId: string } & Record<string, unknown>) => {
        const { guestId, ...rest } = input;
        return api.patch(`/invitations/${invitationId}/guests/${guestId}`, rest);
      },
      onSuccess: invalidate,
    }),
    deleteGuest: useMutation({
      mutationFn: (guestId: string) => api.del(`/invitations/${invitationId}/guests/${guestId}`),
      onSuccess: invalidate,
    }),
    checkIn: useMutation({
      mutationFn: (guestId: string) =>
        api.post(`/invitations/${invitationId}/guests/${guestId}/check-in`),
      onSuccess: invalidate,
    }),
    checkOut: useMutation({
      mutationFn: (guestId: string) =>
        api.post(`/invitations/${invitationId}/guests/${guestId}/check-out`),
      onSuccess: invalidate,
    }),
  };
}

export function useImportPreview(invitationId: string) {
  return useMutation({
    mutationFn: (csv: string) =>
      fetch(`/api/v1/invitations/${invitationId}/guests/import/preview`, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-requested-with": "fetch" },
        credentials: "same-origin",
        body: csv,
      }).then(async (r) => {
        const data = (await r.json()) as {
          ok: boolean;
          total: number;
          valid: number;
          invalid: number;
          duplicates: number;
          rows: Array<{ index: number; valid: boolean; duplicate: boolean; name: string | null }>;
        };
        if (!r.ok) throw new Error("preview_failed");
        return data;
      }),
  });
}

export function useImportCommit(invitationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { csv: string; skipDuplicates?: boolean; partyTitle?: string }) =>
      api.post<{ ok: true; imported: number; skipped: number; errors: Array<{ index: number; code: string }>; partyId: string | null }>(
        `/invitations/${invitationId}/guests/import/commit`,
        input
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guests", invitationId] });
    },
  });
}
