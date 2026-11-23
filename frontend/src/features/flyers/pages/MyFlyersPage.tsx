import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    if (checked && !user) {
      navigate("/auth/login", { replace: true });
    }
  }, [checked, user, navigate]);

  if (checked && !user) {
    return null;
  }

  const results: Flyer[] = query.data?.results ?? [];

  return (
    <section style={{ padding: "64px 0" }}>
      <div className="wrap">
        <div
          style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 24, flexWrap: "wrap" }}
        >
          <h1 className="t-h1" data-enter style={{ fontSize: "clamp(28px, 4vw, 42px)" }}>
            My flyers
          </h1>
          <Button asChild data-enter="2">
            <Link to="/builder">+ New flyer</Link>
          </Button>
        </div>

        {query.isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
            {results.map((flyer) => (
              <OwnerFlyerCard key={flyer.id} flyer={flyer} />
            ))}
          </div>
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
      <div className="btn-row no-print">
        {canResolve && (
          <Button
            variant="sage"
            style={{ height: 36, padding: "0 14px", fontSize: 14 }}
            disabled={updateFlyer.isPending}
            aria-live="polite"
            onClick={armOrResolve}
            onBlur={() => {
              setResolveArmed(false);
              if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
            }}
          >
            {resolveArmed
              ? "Click again to confirm"
              : `Mark ${flyer.mode === "emergency" ? "reunited" : flyer.mode === "found" ? "returned home" : "adopted"}`}
          </Button>
        )}
        <Button
          variant="secondary"
          style={{ height: 36, padding: "0 14px", fontSize: 14 }}
          disabled={deleteFlyer.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          Delete
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
