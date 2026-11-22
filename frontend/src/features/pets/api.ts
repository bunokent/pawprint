import { useMutation } from "@tanstack/react-query";
import { api, multipartConfig } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type Pet = components["schemas"]["Pet"];

export interface PhotoUploadResult {
  key: string;
  url: string;
  thumb_key: string;
  thumb_url: string;
  pet_classes: string[];
  detected_classes: string[];
  max_confidence: number;
  /** CLIP breed/color classifier readout (YOLO handles detection only). */
  breed?: string;
  breed_confidence?: number;
  color?: string;
  color_confidence?: number;
}

/** Confidence at/above which an auto-detected breed/color is prefilled (else blank). */
export const HIGH_CONFIDENCE = 0.8;

export interface PetCreateInput {
  name: string;
  species: string;
  breed?: string;
  color?: string;
  age?: number | null;
  temperament_tags?: string[];
  health_tags?: string[];
  /** Cover photo (first of photo_paths when several angles are uploaded). */
  photo_path?: string;
  /** All uploaded angles of the same pet — the first is the cover photo. */
  photo_paths?: string[];
  status?: string;
}

interface PhotoUploadInput {
  file: File;
  onProgress: (percentage: number) => void;
}

export function useUploadPetPhoto() {
  return useMutation({
    mutationFn: async ({ file, onProgress }: PhotoUploadInput) => {
      const form = new FormData();
      form.append("photo", file);
      const { data } = await api.post<PhotoUploadResult>("/pets/photos", form, {
        ...multipartConfig(),
        onUploadProgress: (event) => {
          const total = event.total ?? file.size;
          if (total > 0) onProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
        },
      });
      return data;
    },
  });
}

export function useCreatePet() {
  return useMutation({
    mutationFn: (input: PetCreateInput) => api.post<Pet>("/pets", input).then((r) => r.data),
  });
}
