import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { myFlyersQuery, useDeleteFlyer, useUpdateFlyer, type Flyer } from "@/features/flyers/api";
import { FlyerCard } from "@/components/FlyerCard";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { useAuth } from "@/stores/auth";

export function MyFlyersPage() {
  const navigate = useNavigate();
  const { user, checked } = useAuth();
  const query = useQuery(myFlyersQuery());
  const [modeFilter, setModeFilter] = useState<"all" | Flyer["mode"]>("all");

  useEffect(() => {
    if (checked && !user) {
      navigate("/auth/login", { replace: true });
    }
  }, [checked, user, navigate]);

  if (checked && !user) {
    return null;
  }

  const results: Flyer[] = query.data?.results ?? [];
  const visibleResults = results.filter((flyer) => modeFilter === "all" || flyer.mode === modeFilter);
  const modeTabs: Array<{ id: "all" | Flyer["mode"]; label: string; count: number }> = [
    { id: "all", label: "All flyers", count: results.length },
    { id: "emergency", label: "Lost", count: results.filter((flyer) => flyer.mode === "emergency").length },
    { id: "found", label: "Found", count: results.filter((flyer) => flyer.mode === "found").length },
    { id: "outreach", label: "Adoptable", count: results.filter((flyer) => flyer.mode === "outreach").length },
  ];

  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <h1 className="t-h1" data-enter>
            My flyers
          </h1>
          <Button asChild data-enter="2">
            <Link to="/builder">+ New flyer</Link>
          </Button>
        </div>

        {query.isLoading && (
          <div className="flyer-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="photo-frame" style={{ aspectRatio: "4 / 3", borderRadius: 20 }} />
                <Skeleton style={{ height: 20, marginTop: 12, width: "60%" }} />
              </div>
            ))}
          </div>
        )}

        {query.isError && <ErrorBox message="Could not load your flyers. Please try again." />}

        {query.data && results.length === 0 && (
          <EmptyState title="No flyers yet">
            <p style={{ marginBottom: 16 }}>Post a lost-pet alert or an adoptable pet to get started.</p>
            <Button asChild>
              <Link to="/builder">Create your first flyer</Link>
            </Button>
          </EmptyState>
        )}

        {results.length > 0 && (
          <>
            <div className="flyer-mode-tabs" role="tablist" aria-label="Filter my flyers">
              {modeTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`my-flyers-tab-${tab.id}`}
                  aria-selected={modeFilter === tab.id}
                  aria-controls="my-flyers-panel"
                  className={`flyer-mode-tab${modeFilter === tab.id ? " flyer-mode-tab--active" : ""}`}
                  data-mode={tab.id}
                  onClick={() => setModeFilter(tab.id)}
                >
                  <span>{tab.label}</span><span className="flyer-mode-tab__count">{tab.count}</span>
                </button>
              ))}
            </div>
            <div id="my-flyers-panel" role="tabpanel" aria-labelledby={`my-flyers-tab-${modeFilter}`}>
              {visibleResults.length > 0 ? (
                <div className="my-flyers-grid">
                  {visibleResults.map((flyer) => <OwnerFlyerCard key={flyer.id} flyer={flyer} />)}
                </div>
              ) : (
                <EmptyState title={`No ${modeFilter === "emergency" ? "lost" : modeFilter === "outreach" ? "adoptable" : "found"} flyers`}>
                  <p>Flyers of this type will appear here.</p>
                </EmptyState>
              )}
            </div>
          </>
        )}

      </div>
    </section>
  );
}

function OwnerFlyerCard({ flyer }: { flyer: Flyer }) {
  const updateFlyer = useUpdateFlyer(flyer.id);
  const deleteFlyer = useDeleteFlyer(flyer.id);
  const navigate = useNavigate();
  const canResolve = flyer.status === "active";
  const markLabel = flyer.mode === "emergency" ? "Mark reunited" : flyer.mode === "found" ? "Mark home" : "Mark adopted";
  const markFullLabel = `Mark ${flyer.mode === "emergency" ? "reunited" : flyer.mode === "found" ? "returned home" : "adopted"}`;
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Resolving ("reunited" / "returned home" / "adopted") needs a deliberate second
  // click — armed for 4 s — so a single stray tap never closes a flyer.
  const [resolveArmed, setResolveArmed] = useState(false);
  const resolveTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
    },
    [],
  );

  const armOrResolve = () => {
    if (resolveArmed) {
      if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
      void updateFlyer.mutateAsync({ status: "resolved" });
      return;
    }
    setResolveArmed(true);
    resolveTimer.current = window.setTimeout(() => setResolveArmed(false), 4000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FlyerCard flyer={flyer} />
      <div className="detail-actions no-print">
        {canResolve && (
          <Button
            variant="sage"
            aria-label={markFullLabel}
            disabled={updateFlyer.isPending}
            aria-live="polite"
            onClick={armOrResolve}
            onBlur={() => {
              setResolveArmed(false);
              if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
            }}
          >
            {resolveArmed ? "Click again to confirm" : markLabel}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={deleteFlyer.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 size={16} /> Delete
        </Button>
      </div>
      <ConfirmDeleteDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        confirming={deleteFlyer.isPending}
        subject={flyer.pet.name?.trim() || undefined}
        onConfirm={() => {
          void deleteFlyer.mutateAsync().then(() => {
            setConfirmOpen(false);
            navigate("/my-flyers");
          });
        }}
      />
    </div>
  );
}
