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

/** Stateful harness — PhotoUpload is a controlled, single-photo component. */
function Harness({ spy }: { spy: (r: PhotoUploadResult) => void }) {
  const [uploaded, setUploaded] = useState<PhotoUploadResult[]>([]);
  return (
    <PhotoUpload
      uploaded={uploaded}
      onUploaded={(r) => {
        spy(r);
        setUploaded([r]);
      }}
      onRemove={() => setUploaded([])}
    />
  );
}

const photo = (n: number): PhotoUploadResult => ({
  key: `pets/photos/angle-${n}.jpg`,
  url: `http://x/angle-${n}.jpg`,
  thumb_key: `t-angle-${n}.jpg`,
  thumb_url: `http://x/t-angle-${n}.jpg`,
  pet_classes: ["dog"],
  detected_classes: ["dog"],
  max_confidence: 0.9,
});

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
    renderWithProviders(<PhotoUpload onUploaded={onUploaded} onRemove={() => {}} uploaded={[]} />);
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

  it("surfaces the logo-specific 422 message from the graphic gate", async () => {
    mswServer.use(
      http.post("*/api/pets/photos", () =>
        HttpResponse.json(
          {
            error: {
              code: "no_pet_detected",
              message: "This looks like a logo or illustration, not a photo of a real pet. Please upload a clear photo of your pet.",
              detected_labels: ["logo"],
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderWithProviders(<PhotoUpload onUploaded={() => {}} onRemove={() => {}} uploaded={[]} />);
    uploadFile("logo.jpg");
    const alert = await screen.findByTestId("no-pet-error");
    expect(alert).toHaveTextContent("This looks like a logo or illustration");
    expect(alert).toHaveTextContent("Detected instead: logo");
    expect(alert).toHaveTextContent("No strikes, no bans");
  });

  it("shows a generic error box for non-422 failures", async () => {
    mswServer.use(http.post("*/api/pets/photos", () => HttpResponse.json({ error: { code: "server_error", message: "Upload storage unavailable." } }, { status: 500 })));
    const onUploaded = vi.fn();
    renderWithProviders(<PhotoUpload onUploaded={onUploaded} onRemove={() => {}} uploaded={[]} />);
    uploadFile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload storage unavailable.");
  });

  it("renders the existing uploaded photo when provided", () => {
    renderWithProviders(
      <PhotoUpload
        onUploaded={() => {}}
        onRemove={() => {}}
        uploaded={[{ key: "k", url: "http://x/full.jpg", thumb_key: "t", thumb_url: "http://x/thumb.jpg", pet_classes: ["cat"], detected_classes: ["cat"], max_confidence: 0.9 }]}
      />,
    );
    expect(screen.getByAltText("Uploaded pet preview")).toHaveAttribute("src", "http://x/thumb.jpg");
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeInTheDocument();
  });

  it("accepts only the first file when several are picked — one photo per pet", async () => {
    let calls = 0;
    mswServer.use(
      http.post("*/api/pets/photos", () => {
        calls += 1;
        return HttpResponse.json(photo(calls), { status: 201 });
      }),
    );
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    expect(screen.getByText(/One clear, well-lit photo/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose a pet photo"), {
      target: { files: [1, 2, 3].map((i) => new File([String(i)], `a${i}.jpg`, { type: "image/jpeg" })) },
    });
    expect(await screen.findByAltText("Uploaded pet preview")).toBeInTheDocument();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(calls).toBe(1);
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeEnabled();
    expect(screen.queryByText(/photos/)).not.toBeInTheDocument();
  });

  it("replaces the current photo when a new one is chosen", async () => {
    let calls = 0;
    mswServer.use(
      http.post("*/api/pets/photos", () => {
        calls += 1;
        return HttpResponse.json(photo(calls), { status: 201 });
      }),
    );
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    uploadFile("first.jpg");
    expect(await screen.findByAltText("Uploaded pet preview")).toBeInTheDocument();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Replace photo" }));
    uploadFile("second.jpg");
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2));
    expect(onUploaded).toHaveBeenLastCalledWith(expect.objectContaining({ key: "pets/photos/angle-2.jpg" }));
    expect(screen.getAllByAltText("Uploaded pet preview")).toHaveLength(1);
  });

  it("removes the photo from the remove control", async () => {
    const onRemove = vi.fn();
    renderWithProviders(
      <PhotoUpload
        onUploaded={() => {}}
        onRemove={onRemove}
        uploaded={[photo(1)]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onRemove).toHaveBeenCalledWith("pets/photos/angle-1.jpg");
  });

  it("uses the full-size drop zone and accepts a dragged photo", async () => {
    const onUploaded = vi.fn();
    renderWithProviders(<Harness spy={onUploaded} />);
    const dropZone = screen.getByRole("button", { name: /Drop your pet’s photo here/ });
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
      renderWithProviders(<PhotoUpload onUploaded={onUploaded} onRemove={() => {}} uploaded={[]} />);
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
