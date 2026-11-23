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

export const flyerKeys = {
  all: ["flyers"] as const,
  list: (params: { mode?: Mode; q?: string; cursor?: string }) =>
    [...flyerKeys.all, "list", params] as const,
  detail: (id: string) => [...flyerKeys.all, "detail", id] as const,
  mine: ["flyers", "mine"] as const,
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
    mutationFn: (patch: Partial<FlyerCreateInput> & { status?: string }) =>
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: flyerKeys.all }),
  });
}
