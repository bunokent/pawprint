import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type Flyer = components["schemas"]["Flyer"];
export type FlyerList = { results: Flyer[]; next: string | null; previous: string | null };
export type Mode = "emergency" | "found" | "outreach";

export interface FlyerCreateInput {
  pet_id: string;
  mode: Mode;
  last_seen_location?: string;
  last_seen_date?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  distinctive_markings?: string;
  contact_phone?: string;
  contact_email?: string;
}

/**
 * PATCH body for the owner-only edit endpoint. Pet details and the cover photo
 * are applied to the flyer's linked pet in the same atomic request.
 */
export interface FlyerUpdateInput extends Partial<Omit<FlyerCreateInput, "pet_id">> {
  status?: string;
  photo_path?: string;
  name?: string;
  species?: components["schemas"]["SpeciesEnum"];
  breed?: string;
  color?: string;
  age?: number | null;
  temperament_tags?: string[];
  health_tags?: string[];
}

export const flyerKeys = {
  all: ["flyers"] as const,
  list: (params: { mode?: Mode; q?: string; cursor?: string }) =>
    [...flyerKeys.all, "list", params] as const,
  detail: (id: string) => [...flyerKeys.all, "detail", id] as const,
  mine: ["flyers", "mine"] as const,
  deleted: ["flyers", "deleted"] as const,
  map: ["flyers", "map"] as const,
};

export const flyerListQuery = (params: { mode?: Mode; q?: string; cursor?: string }) =>
  queryOptions({
    queryKey: flyerKeys.list(params),
    queryFn: async () => {
      const search = new URLSearchParams();
      if (params.mode) search.set("mode", params.mode);
      if (params.q) search.set("q", params.q);
      if (params.cursor) search.set("cursor", params.cursor);
      const { data } = await api.get<FlyerList>(`/flyers?${search.toString()}`);
      return data;
    },
  });

export const flyerDetailQuery = (id: string) =>
  queryOptions({
    queryKey: flyerKeys.detail(id),
    queryFn: async () => (await api.get<Flyer>(`/flyers/${id}`)).data,
  });

export const myFlyersQuery = () =>
  queryOptions({
    queryKey: flyerKeys.mine,
    queryFn: async () => (await api.get<FlyerList>("/flyers/mine")).data,
  });

/** The creator's soft-deleted flyers — the Recently Deleted page. */
export const deletedFlyersQuery = () =>
  queryOptions({
    queryKey: flyerKeys.deleted,
    queryFn: async () => (await api.get<FlyerList>("/flyers/deleted")).data,
  });

/** Public pet-map pins: active lost/found flyers that carry lat/lng. */
export const flyerMapQuery = () =>
  queryOptions({
    queryKey: flyerKeys.map,
    queryFn: async () => (await api.get<Flyer[]>("/flyers/map")).data,
  });

export function useCreateFlyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FlyerCreateInput) => api.post<Flyer>("/flyers/new", input).then((r) => r.data),
    onSuccess: (flyer) => {
      qc.setQueryData(flyerKeys.detail(flyer.id), flyer);
      void qc.invalidateQueries({ queryKey: flyerKeys.all });
    },
  });
}

export function useUpdateFlyer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: FlyerUpdateInput) =>
      api.patch<Flyer>(`/flyers/${id}/edit`, patch).then((r) => r.data),
    onSuccess: (flyer) => {
      qc.setQueryData(flyerKeys.detail(id), flyer);
      void qc.invalidateQueries({ queryKey: flyerKeys.all });
    },
  });
}

export function useDeleteFlyer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/flyers/${id}/edit`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flyerKeys.all });
      void qc.invalidateQueries({ queryKey: flyerKeys.mine });
      void qc.invalidateQueries({ queryKey: flyerKeys.deleted });
    },
  });
}

/** Restore one soft-deleted flyer back to My Flyers. */
export const restoreDeletedFlyer = (id: string) =>
  api.post<Flyer>(`/flyers/${id}/restore`).then((r) => r.data);

/** Permanently delete one soft-deleted flyer (cannot be undone). */
export const purgeDeletedFlyer = (id: string) =>
  api.delete(`/flyers/${id}/deleted`).then((r) => r.data);

/** Restore a soft-deleted flyer back to My Flyers. */
export function useRestoreFlyer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => restoreDeletedFlyer(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flyerKeys.deleted });
      void qc.invalidateQueries({ queryKey: flyerKeys.mine });
      void qc.invalidateQueries({ queryKey: flyerKeys.all });
    },
  });
}

/** Permanently delete a soft-deleted flyer (cannot be undone). */
export function usePurgeFlyer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => purgeDeletedFlyer(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: flyerKeys.deleted }),
  });
}
