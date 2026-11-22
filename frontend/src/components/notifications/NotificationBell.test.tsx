import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useAuth } from "@/stores/auth";
import { mswServer } from "@/test/setup";
import { renderWithProviders } from "@/test/utils";
import { mockNotification, mockUser } from "@/test/handlers";

beforeEach(() => {
  useAuth.setState({ user: null, checked: true });
});

describe("NotificationBell", () => {
  it("renders nothing for guests", () => {
    renderWithProviders(<NotificationBell />, { route: "/" });
    expect(screen.queryByTestId("notification-bell")).not.toBeInTheDocument();
  });

  it("shows the unread badge and lists notifications in the dropdown", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    mswServer.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({
          results: [
            mockNotification(),
            mockNotification({
              id: "88888888-8888-8888-8888-888888888888",
              title: "Profile updated",
              body: "Your contact details were saved.",
              read_at: "2026-11-19T10:00:00Z",
            }),
          ],
          unread_count: 1,
        }),
      ),
    );
    renderWithProviders(<NotificationBell />, { route: "/" });

    const bell = await screen.findByTestId("notification-bell");
    expect(await screen.findByTestId("notification-unread")).toHaveTextContent("1");

    const user = userEvent.setup();
    await user.click(bell);
    const panel = await screen.findByTestId("notification-panel");
    expect(panel).toHaveTextContent("Welcome to PawPrint");
    expect(panel).toHaveTextContent("Profile updated");
    // The unread notification links to its target page.
    expect(panel.querySelector("a")).toHaveAttribute("href", mockNotification().link);

    // Closing via the backdrop hides the panel.
    await user.click(screen.getByRole("button", { name: "Close notifications" }));
    await waitFor(() => expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument());
  });

  it("marks all notifications as read", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    const calls: unknown[] = [];
    mswServer.use(
      http.get("*/api/notifications", () => HttpResponse.json({ results: [mockNotification()], unread_count: 1 })),
      http.post("*/api/notifications/read", async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ marked_read: 1, unread_count: 0 });
      }),
    );
    renderWithProviders(<NotificationBell />, { route: "/" });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("notification-bell"));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(calls).toEqual([{}]));
  });

  it("shows an empty state when there are no notifications", async () => {
    useAuth.setState({ user: mockUser(), checked: true });
    mswServer.use(http.get("*/api/notifications", () => HttpResponse.json({ results: [], unread_count: 0 })));
    renderWithProviders(<NotificationBell />, { route: "/" });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("notification-bell"));
    expect(await screen.findByTestId("notification-panel")).toHaveTextContent("No notifications yet");
    expect(screen.queryByTestId("notification-unread")).not.toBeInTheDocument();
  });
});
