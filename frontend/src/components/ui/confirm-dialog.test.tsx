import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-dialog";

describe("ConfirmDeleteDialog", () => {
  it("renders nothing when closed", () => {
    render(<ConfirmDeleteDialog open={false} onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("is an alertdialog with wired title/description and fires onConfirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDeleteDialog open onClose={() => {}} onConfirm={onConfirm} subject="Bento" />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "confirm-dialog-title");
    expect(dialog).toHaveAttribute("aria-describedby", "confirm-dialog-body");
    expect(screen.getByRole("heading", { name: "Delete this flyer?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Bento.+flyer will be permanently deleted/);
    expect(dialog).toHaveTextContent("This cannot be undone.");
    await user.click(screen.getByRole("button", { name: "Yes, delete flyer" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancel button, Escape and backdrop click all close without confirming", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDeleteDialog open onClose={onClose} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Keep flyer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("alertdialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks both buttons and relabels while the delete is in flight", () => {
    render(<ConfirmDeleteDialog open onClose={() => {}} onConfirm={() => {}} confirming />);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep flyer" })).toBeDisabled();
  });

  it("moves focus to the safe cancel action on open", () => {
    render(<ConfirmDeleteDialog open onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: "Keep flyer" })).toHaveFocus();
  });
});
