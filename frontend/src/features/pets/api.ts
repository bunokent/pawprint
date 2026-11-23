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

/** Private-storage folder for each flyer mode: flyers/{user_id}/{category}/. */
export const PHOTO_CATEGORY_BY_MODE = {
  emergency: "losts",
  found: "found",
  outreach: "adoptions",
} as const;
export type PhotoCategory = (typeof PHOTO_CATEGORY_BY_MODE)[keyof typeof PHOTO_CATEGORY_BY_MODE];

export interface PetCreateInput {
  name: string;
  species: string;
  breed?: string;
  color?: string;
  age?: number | null;
  temperament_tags?: string[];
  health_tags?: string[];
  /** The single uploaded photo — the flyer's cover image. */
  photo_path?: string;
  status?: string;
}

interface PhotoUploadInput {
  file: File;
  category: PhotoCategory;
  onProgress: (percentage: number) => void;
}

export function useUploadPetPhoto() {
  return useMutation({
    mutationFn: async ({ file, category, onProgress }: PhotoUploadInput) => {
      const form = new FormData();
      form.append("photo", file);
      form.append("category", category);
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
