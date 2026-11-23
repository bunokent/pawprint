import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { ChevronDown, LogOut, Moon, Settings, Sun } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";

function PawMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="10" cy="11" r="4" fill="currentColor" />
      <circle cx="22" cy="11" r="4" fill="currentColor" />
      <circle cx="16" cy="21" r="7" fill="currentColor" />
    </svg>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [darkMode, setDarkMode] = useState(() => {
    const enabled = localStorage.getItem("pawprint-theme") === "dark";
    if (enabled) document.documentElement.dataset.theme = "dark";
    return enabled;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    localStorage.setItem("pawprint-theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="nav no-print">
        <div className="wrap nav-inner">
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-ink)", textDecoration: "none" }}>
            <PawMark />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22 }}>PawPrint</span>
          </Link>
          <nav className="nav-links" aria-label="Main">
            <NavLink className="nav-link" to="/flyers">Flyers</NavLink>
            <NavLink className="nav-link" to="/map">Pet map</NavLink>
            {user && <NavLink className="nav-link" to="/my-flyers">My flyers</NavLink>}
            {user ? (
              <>
                <NavLink className="nav-link" to="/builder">New flyer</NavLink>
                <div className="account-menu" ref={accountMenuRef}>
                  <button
                    type="button"
                    className="account-menu__trigger"
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                    aria-label={`Account menu for ${user.display_name || user.email}`}
                    onClick={() => setAccountMenuOpen((open) => !open)}
                  >
                    <Avatar src={user.avatar_url} name={user.display_name || user.email} size={28} decorative />
                    <span>{user.display_name || user.email}</span>
                    <ChevronDown size={15} className={accountMenuOpen ? "account-menu__chevron account-menu__chevron--open" : "account-menu__chevron"} aria-hidden="true" />
                  </button>
                  {accountMenuOpen && (
                    <div className="account-menu__panel" role="menu" aria-label="Account options">
                      <NavLink to="/settings" role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                        <Settings size={16} aria-hidden="true" /> Profile settings
                      </NavLink>
                      <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); void logout(); }}>
                        <LogOut size={16} aria-hidden="true" /> Log out
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <NavLink className="nav-link" to="/auth/login">Log in</NavLink>
                <Button style={{ height: 36, padding: "0 16px" }} asChild>
                  <Link to="/auth/register">Register free</Link>
                </Button>
              </>
            )}
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setDarkMode((current) => !current)}
              aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
              title={`Switch to ${darkMode ? "light" : "dark"} mode`}
            >
              <span className="theme-toggle__icon" aria-hidden="true">{darkMode ? <Sun size={17} /> : <Moon size={17} />}</span>
              <span className="theme-toggle__text">{darkMode ? "Light" : "Dark"}</span>
            </button>
          </nav>
        </div>
      </header>
      <main id="top" style={{ flex: 1 }}>
        <Outlet />
      </main>
      <footer className="no-print" style={{ borderTop: "1px solid var(--color-line)", marginTop: 64, padding: "32px 0" }}>
        <div className="wrap t-small" style={{ color: "var(--color-muted)", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span>PawPrint — bring them home. Lost-pet alerts and adoption flyers, print-ready in one click.</span>
          <span>Contacts: hello@pawprint.example</span>
        </div>
      </footer>
    </div>
  );
}
