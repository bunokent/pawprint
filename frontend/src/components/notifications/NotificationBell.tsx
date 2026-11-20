import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import { notificationKeys, notificationsQuery, useMarkRead } from "@/features/notifications/api";
import { useAuth } from "@/stores/auth";
import { formatDate } from "@/lib/utils";

/**
 * Notification bell in the top nav (authenticated users only). Unread count badge,
 * dropdown with the latest notifications, mark-all-read. Refreshes via the per-user
 * websocket (ws/notifications/, proxied by Vite) and polls every 30s as a fallback.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const query = useQuery({ ...notificationsQuery(), enabled: Boolean(user) });
  const markRead = useMarkRead();

  useEffect(() => {
    if (!user || typeof WebSocket === "undefined") return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/notifications/`);
    } catch {
      return; // polling fallback still covers updates
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type?: string };
        if (msg?.type === "notification.created") {
          void qc.invalidateQueries({ queryKey: notificationKeys.all });
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => ws?.close();
  }, [user, qc]);

  if (!user) return null;

  const unread = query.data?.unread_count ?? 0;
  const items = query.data?.results ?? [];

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: "1.5px solid var(--color-line)",
          background: open ? "var(--color-surface)" : "transparent",
          color: "var(--color-ink)",
          cursor: "pointer",
        }}
      >
        {unread > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {unread > 0 && (
          <span
            data-testid="notification-unread"
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              borderRadius: 999,
              background: "var(--color-emergency)",
              color: "#fff",
              font: "700 11px/18px var(--font-sans)",
              textAlign: "center",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 45, border: "none", background: "transparent", cursor: "default" }}
          />
          <div
            data-testid="notification-panel"
            role="dialog"
            aria-label="Notifications"
            className="card"
            style={{
              position: "absolute",
              top: "calc(100% + 10px)",
              right: 0,
              zIndex: 46,
              width: 340,
              maxHeight: 420,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid var(--color-line)",
              }}
            >
              <strong style={{ fontFamily: "var(--font-display)" }}>Notifications</strong>
              <button
                type="button"
                className="t-small"
                disabled={unread === 0 || markRead.isPending}
                onClick={() => markRead.mutate()}
                style={{ border: "none", background: "transparent", color: "var(--color-sage-deep)", cursor: "pointer", fontWeight: 600 }}
              >
                Mark all read
              </button>
            </div>
            <div style={{ overflowY: "auto" }}>
              {items.length === 0 && (
                <p className="t-small" style={{ margin: 0, padding: "20px 16px", color: "var(--color-muted)" }}>
                  No notifications yet. When a found pet's photo matches your lost pet, you'll see it here.
                </p>
              )}
              {items.map((n) => {
                const row = (
                  <>
                    <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <strong style={{ fontSize: 14 }}>{n.title}</strong>
                      {!n.read_at && (
                        <span
                          aria-label="unread"
                          style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-emergency)", flex: "none", alignSelf: "center" }}
                        />
                      )}
                    </span>
                    {n.body && (
                      <span className="t-small" style={{ color: "var(--color-muted)", display: "block" }}>
                        {n.body}
                      </span>
                    )}
                    <span className="t-small" style={{ color: "var(--color-muted)", fontSize: 12 }}>
                      {formatDate(n.created_at)}
                    </span>
                  </>
                );
                return (
                  <div
                    key={n.id}
                    style={{
                      display: "block",
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--color-line)",
                      color: "inherit",
                      textDecoration: "none",
                      background: n.read_at ? "transparent" : "rgb(255 179 0 / 0.06)",
                    }}
                  >
                    {n.link ? (
                      <Link to={n.link} onClick={() => setOpen(false)} style={{ color: "inherit", textDecoration: "none", display: "block" }}>
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
