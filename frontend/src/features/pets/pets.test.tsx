import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { http, HttpResponse } from "msw";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AxiosProgressEvent } from "axios";
import { PhotoUpload } from "@/features/pets/components/PhotoUpload";
import type { PhotoUploadResult } from "@/features/pets/api";
import { api } from "@/lib/api/client";
import { mswServer } from "@/test/setup";
import { renderWithProviders } from "@/test/utils";
import { setUploadRejects } from "@/test/handlers";

const uploadFile = (name = "bento.jpg") => {
  const input = screen.getByLabelText("Choose a pet photo");
  fireEvent.change(input, { target: { files: [new File(["img-bytes"], name, { type: "image/jpeg" })] } });
};

/** Stateful harness — PhotoUpload is a controlled component (multi-photo). */
function Harness({ spy, onMakeCover, maxPhotos }: { spy: (r: PhotoUploadResult) => void; onMakeCover?: (key: string) => void; maxPhotos?: number }) {
  const [uploaded, setUploaded] = useState<PhotoUploadResult[]>([]);
  return (
    <PhotoUpload
      maxPhotos={maxPhotos}
      uploaded={uploaded}
      onUploaded={(r) => {
        spy(r);
        setUploaded((prev) => [...prev.filter((p) => p.key !== r.key), r]);
      }}
      onRemove={(key) => setUploaded((prev) => prev.filter((p) => p.key !== key))}
      onMakeCover={(key) => {
        onMakeCover?.(key);
        setUploaded((prev) => {
          const target = prev.find((p) => p.key === key);
          return target ? [target, ...prev.filter((p) => p.key !== key)] : prev;
        });
      }}
    />
  );
}

describe("PhotoUpload (YOLO-World gatekeeper UX)", () => {
  it("uploads a pet photo and shows the preview + detected badge", async () => {
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    uploadFile("bento.jpg");
    expect(await screen.findByAltText("Uploaded pet preview")).toBeInTheDocument();
    expect(screen.getByText("Detected: dog ✓")).toBeInTheDocument();
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ key: "pets/photos/bento.jpg", pet_classes: ["dog"] })),
    );
  });

  it("shows the 422 no-pet error with detected labels and allows retry — no ban", async () => {
    setUploadRejects(true);
    const onUploaded = vi.fn();
    renderWithProviders(<PhotoUpload onUploaded={onUploaded} onRemove={() => {}} onMakeCover={() => {}} uploaded={[]} />);
    uploadFile("landscape.jpg");
    const alert = await screen.findByTestId("no-pet-error");
    expect(alert).toHaveTextContent("No pet detected in the photo.");
    // The full sentence is shown exactly once — never duplicated in the UI.
    const sentence = "No pet detected in the photo. Please upload a clear photo of your pet.";
    expect(alert.textContent?.split(sentence).length ?? 0).toBe(2);
    expect(alert).toHaveTextContent("person, car");
    expect(alert).toHaveTextContent("No strikes, no bans");
    expect(onUploaded).not.toHaveBeenCalled();
    // Retry is possible: the choose button is still available.
    expect(screen.getByRole("button", { name: /Choose a photo/ })).toBeEnabled();
  });

  it("shows a generic error box for non-422 failures", async () => {
    mswServer.use(http.post("*/api/pets/photos", () => HttpResponse.json({ error: { code: "server_error", message: "Upload storage unavailable." } }, { status: 500 })));
    const onUploaded = vi.fn();
    renderWithProviders(<PhotoUpload onUploaded={onUploaded} onRemove={() => {}} onMakeCover={() => {}} uploaded={[]} />);
    uploadFile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload storage unavailable.");
  });

  it("renders the existing uploaded photo when provided", () => {
    renderWithProviders(
      <PhotoUpload
        onUploaded={() => {}}
        onRemove={() => {}}
        onMakeCover={() => {}}
        uploaded={[{ key: "k", url: "http://x/full.jpg", thumb_key: "t", thumb_url: "http://x/thumb.jpg", pet_classes: ["cat"], detected_classes: ["cat"], max_confidence: 0.9 }]}
      />,
    );
    expect(screen.getByAltText("Uploaded pet preview")).toHaveAttribute("src", "http://x/thumb.jpg");
    expect(screen.getByRole("button", { name: "Add photo (1/10)" })).toBeInTheDocument();
  });

  it("allows up to 10 photos by default (not capped at 4)", async () => {
    let n = 0;
    mswServer.use(
      http.post("*/api/pets/photos", () => {
        n += 1;
        return HttpResponse.json(
          {
            key: `pets/photos/angle-${n}.jpg`,
            url: `http://x/angle-${n}.jpg`,
            thumb_key: `t-angle-${n}.jpg`,
            thumb_url: `http://x/t-angle-${n}.jpg`,
            pet_classes: ["dog"],
            detected_classes: ["dog"],
            max_confidence: 0.9,
          },
          { status: 201 },
        );
      }),
    );
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    // The empty-state hint advertises the real limit.
    expect(screen.getByText(/up to 10/)).toBeInTheDocument();
    // Six angles in one pick — all accepted (the old cap of 4 would drop two).
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [1, 2, 3, 4, 5, 6].map((i) => new File([String(i)], `a${i}.jpg`, { type: "image/jpeg" })) },
    });
    expect(await screen.findByAltText("Uploaded photo 6")).toBeInTheDocument();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(6));
    expect(screen.getByText("6 photos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photo (6/10)" })).toBeEnabled();
  });

  it("accepts several photos at once (different angles) and lists thumbnails", async () => {
    // Counter-based keys: MSW cannot read the jsdom FormData body, so the handler
    // numbers each accepted upload instead of echoing the file name.
    let n = 0;
    mswServer.use(
      http.post("*/api/pets/photos", () => {
        n += 1;
        return HttpResponse.json(
          {
            key: `pets/photos/angle-${n}.jpg`,
            url: `http://x/angle-${n}.jpg`,
            thumb_key: `t-angle-${n}.jpg`,
            thumb_url: `http://x/t-angle-${n}.jpg`,
            pet_classes: ["dog"],
            detected_classes: ["dog"],
            max_confidence: 0.9,
            breed: "",
            breed_confidence: 0,
            color: "",
            color_confidence: 0,
          },
          { status: 201 },
        );
      }),
    );
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: {
        files: [
          new File(["a"], "front.jpg", { type: "image/jpeg" }),
          new File(["b"], "side.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    // Both photos upload sequentially; thumbnails appear under the cover frame.
    expect(await screen.findByAltText("Uploaded photo 2")).toBeInTheDocument();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2));
    expect(onUploaded).toHaveBeenNthCalledWith(1, expect.objectContaining({ key: "pets/photos/angle-1.jpg" }));
    expect(onUploaded).toHaveBeenNthCalledWith(2, expect.objectContaining({ key: "pets/photos/angle-2.jpg" }));
    expect(screen.getByAltText("Uploaded pet preview")).toBeInTheDocument(); // cover = first
    expect(screen.getByText("2 photos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photo (2/10)" })).toBeEnabled();
  });

  it("removes a photo via its thumbnail button and promotes the next one to cover", async () => {
    let n = 0;
    mswServer.use(
      http.post("*/api/pets/photos", () => {
        n += 1;
        return HttpResponse.json(
          {
            key: `pets/photos/angle-${n}.jpg`,
            url: `http://x/angle-${n}.jpg`,
            thumb_key: `t-angle-${n}.jpg`,
            thumb_url: `http://x/t-angle-${n}.jpg`,
            pet_classes: ["dog"],
            detected_classes: ["dog"],
            max_confidence: 0.9,
          },
          { status: 201 },
        );
      }),
    );
    const onUploaded = vi.fn();
    const onMakeCover = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} onMakeCover={onMakeCover} />);
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: {
        files: [
          new File(["a"], "front.jpg", { type: "image/jpeg" }),
          new File(["b"], "side.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    await screen.findByAltText("Uploaded photo 2");

    // Tap the second thumbnail → it becomes the cover photo.
    fireEvent.click(screen.getByRole("button", { name: "Make photo 2 the cover photo" }));
    expect(onMakeCover).toHaveBeenCalledWith("pets/photos/angle-2.jpg");
    expect(screen.getByRole("button", { name: "Cover photo" })).toHaveAttribute("aria-pressed", "true");

    // Remove the second photo — the strip collapses back to the single photo.
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    await waitFor(() => expect(screen.queryByText("2 photos")).not.toBeInTheDocument());
    expect(screen.queryByAltText("Uploaded photo 2")).not.toBeInTheDocument();
    expect(screen.getByAltText("Uploaded pet preview")).toBeInTheDocument();
  });

  it("caps a multi-pick at the maxPhotos prop — extra files are dropped and the button locks", async () => {
    let n = 0;
    mswServer.use(
      http.post("*/api/pets/photos", () => {
        n += 1;
        return HttpResponse.json(
          {
            key: `pets/photos/angle-${n}.jpg`,
            url: `http://x/angle-${n}.jpg`,
            thumb_key: `t-angle-${n}.jpg`,
            thumb_url: `http://x/t-angle-${n}.jpg`,
            pet_classes: ["dog"],
            detected_classes: ["dog"],
            max_confidence: 0.9,
          },
          { status: 201 },
        );
      }),
    );
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} maxPhotos={4} />);
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [1, 2, 3, 4, 5].map((i) => new File([String(i)], `a${i}.jpg`, { type: "image/jpeg" })) },
    });
    expect(await screen.findByAltText("Uploaded photo 4")).toBeInTheDocument();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(4)); // 5th file dropped
    expect(screen.getByText("4 photos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photo limit reached" })).toBeDisabled();
  });

  it("uses the full-size drop zone and accepts a dragged photo", async () => {
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    const dropZone = screen.getByRole("button", { name: /Drop your pet’s photos here/ });
    const frame = dropZone.closest(".photo-upload__frame");
    expect(frame).not.toBeNull();

    fireEvent.dragEnter(frame!);
    expect(frame).toHaveClass("photo-upload__frame--dragging");
    fireEvent.drop(frame!, {
      dataTransfer: { files: [new File(["img-bytes"], "bento.jpg", { type: "image/jpeg" })] },
    });

    expect(frame).not.toHaveClass("photo-upload__frame--dragging");
    expect(screen.getByRole("status")).toHaveTextContent("Uploading photo");
    expect(await screen.findByAltText("Uploaded pet preview")).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  it("shows upload progress and live scan, detect, and save stages", async () => {
    vi.useFakeTimers();
    let reportProgress: ((event: AxiosProgressEvent) => void) | undefined;
    let finishUpload: (() => void) | undefined;
    const result: PhotoUploadResult = {
      key: "pets/photos/bento.jpg",
      url: "http://x/full.jpg",
      thumb_key: "t",
      thumb_url: "http://x/thumb.jpg",
      pet_classes: ["dog"],
      detected_classes: ["dog"],
      max_confidence: 0.92,
    };
    const post = vi.spyOn(api, "post").mockImplementation((_url, _body, config) => {
      reportProgress = config?.onUploadProgress;
      reportProgress?.({ loaded: 50, total: 100 } as AxiosProgressEvent);
      return new Promise((resolve) => {
        finishUpload = () => resolve({ data: result } as never);
      });
    });

    try {
      const onUploaded = vi.fn();
      renderWithProviders(<PhotoUpload onUploaded={onUploaded} onRemove={() => {}} onMakeCover={() => {}} uploaded={[]} />);
      uploadFile();
      await act(async () => Promise.resolve());

      expect(screen.getByRole("status")).toHaveTextContent("Uploading photo");
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
      act(() => reportProgress?.({ loaded: 100, total: 100 } as AxiosProgressEvent));
      expect(screen.getByRole("status")).toHaveTextContent("Scanning photo");
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Scanning photo");

      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByRole("status")).toHaveTextContent("Detecting your pet");
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole("status")).toHaveTextContent("Saving securely");
      expect(document.querySelector(".photo-upload__progress-fill")).toHaveClass("photo-upload__progress-fill--indeterminate");

      await act(async () => {
        finishUpload?.();
        await Promise.resolve();
      });
      expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ key: result.key }));
    } finally {
      post.mockRestore();
      vi.useRealTimers();
    }
  });
});
