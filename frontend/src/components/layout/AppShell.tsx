import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ChevronDown, LogOut, Menu, Moon, Settings, Sun, X } from "lucide-react";
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

function ThemeToggleButton({ darkMode, onToggle }: { darkMode: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
      title={`Switch to ${darkMode ? "light" : "dark"} mode`}
    >
      <span className="theme-toggle__icon" aria-hidden="true">{darkMode ? <Sun size={17} /> : <Moon size={17} />}</span>
      <span className="theme-toggle__text">{darkMode ? "Light" : "Dark"}</span>
    </button>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
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
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
  }, [location.pathname, location.search]);

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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  const toggleDarkMode = () => setDarkMode((current) => !current);
  const displayName = user ? user.display_name || user.email : "";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <a className="skip-link no-print" href="#top">Skip to content</a>
      <header className="nav no-print">
        <div className="wrap nav-inner">
          <Link to="/" className="nav-brand">
            <PawMark />
            <span className="nav-brand__name">PawPrint</span>
          </Link>
          <nav className="nav-links nav-links--desktop" aria-label="Main">
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
                    aria-label={`Account menu for ${displayName}`}
                    onClick={() => setAccountMenuOpen((open) => !open)}
                  >
                    <Avatar src={user.avatar_url} name={displayName} size={28} decorative />
                    <span>{displayName}</span>
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
            <ThemeToggleButton darkMode={darkMode} onToggle={toggleDarkMode} />
          </nav>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            <span>{mobileMenuOpen ? "Close" : "Menu"}</span>
          </button>
        </div>
        {mobileMenuOpen && (
          <nav id="mobile-navigation" className="nav-mobile" aria-label="Main mobile">
            <NavLink className="nav-mobile__link" to="/" end>Home</NavLink>
            <NavLink className="nav-mobile__link" to="/flyers">Flyers</NavLink>
            <NavLink className="nav-mobile__link" to="/map">Pet map</NavLink>
            {user && <NavLink className="nav-mobile__link" to="/my-flyers">My flyers</NavLink>}
            {user && <NavLink className="nav-mobile__link" to="/builder">New flyer</NavLink>}
            {user ? (
              <div className="nav-mobile__group">
                <div className="nav-mobile__identity">
                  <Avatar src={user.avatar_url} name={displayName} size={32} decorative />
                  <span>{displayName}</span>
                </div>
                <NavLink className="nav-mobile__link" to="/settings">Profile settings</NavLink>
                <button type="button" className="nav-mobile__link" onClick={() => { setMobileMenuOpen(false); void logout(); }}>
                  Log out
                </button>
              </div>
            ) : (
              <div className="nav-mobile__group">
                <NavLink className="nav-mobile__link" to="/auth/login">Log in</NavLink>
                <Button asChild><Link to="/auth/register">Register free</Link></Button>
              </div>
            )}
            <div className="nav-mobile__group">
              <ThemeToggleButton darkMode={darkMode} onToggle={toggleDarkMode} />
            </div>
          </nav>
        )}
      </header>
      <main id="top" style={{ flex: 1 }}>
        <Outlet />
      </main>
      <footer className="site-footer no-print">
        <div className="wrap site-footer__inner t-small">
          <span>PawPrint — bring them home. Lost-pet alerts and adoption flyers, print-ready in one click.</span>
          <span>Contacts: hello@pawprint.example</span>
        </div>
      </footer>
    </div>
  );
}
