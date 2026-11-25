import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { flyerListQuery, type Flyer } from "@/features/flyers/api";
import { FlyerCard } from "@/components/FlyerCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { useAuth } from "@/stores/auth";

export function HomePage() {
  const { user } = useAuth();
  const emergency = useQuery(flyerListQuery({ mode: "emergency" }));
  const outreach = useQuery(flyerListQuery({ mode: "outreach" }));

  return (
    <>
      {/* Hero — one screen, entrance once on load */}
      <section className="page-section page-section--hero">
        <div className="wrap">
          <p className="t-label" data-enter style={{ marginBottom: 16 }}>
            Lost-pet alerts · Adoption flyers · Print-ready in one click
          </p>
          <h1 className="t-h1" data-enter="2" style={{ maxWidth: 720 }}>
            Bring them <span style={{ color: "var(--color-emergency)" }}>home</span>.
          </h1>
          <p className="t-lead" data-enter="2" style={{ maxWidth: 560, marginTop: 20 }}>
            PawPrint turns a lost pet into a scannable, printable alert — and a shelter pet into a
            flyer that finds a family. Browse as a guest; register free to post your own.
          </p>
          <div className="btn-row" data-enter="3" style={{ marginTop: 32 }}>
            <Button variant="emergency" asChild>
              <Link to="/builder?mode=emergency">Report a lost pet</Link>
            </Button>
            <Button variant="sage" asChild>
              <Link to="/flyers?mode=outreach">Meet adoptable pets</Link>
            </Button>
            {!user && (
              <Button variant="secondary" asChild>
                <Link to="/auth/register">Register free</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Emergency rail */}
      <section className="page-section" aria-labelledby="lost-now-heading">
        <div className="wrap">
          <div className="section-head">
            <h2 id="lost-now-heading" className="t-h2" style={{ color: "var(--color-emergency-deep)" }}>Lost right now</h2>
            <Link to="/flyers?mode=emergency" className="section-head__link">All emergencies →</Link>
          </div>
          <FlyerGrid query={emergency} />
        </div>
      </section>

      {/* Outreach rail */}
      <section className="page-section page-section--tint" aria-labelledby="adoptable-heading">
        <div className="wrap">
          <div className="section-head">
            <h2 id="adoptable-heading" className="t-h2" style={{ color: "var(--color-sage-deep)" }}>Looking for a home</h2>
            <Link to="/flyers?mode=outreach" className="section-head__link">All adoptable pets →</Link>
          </div>
          <FlyerGrid query={outreach} />
        </div>
      </section>
    </>
  );
}

function FlyerGrid({ query }: { query: { data?: { results: Flyer[] }; isLoading: boolean; isError: boolean } }) {
  if (query.isLoading) {
    return (
      <div className="flyer-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="photo-frame" style={{ aspectRatio: "4 / 3", borderRadius: 20 }} />
            <Skeleton style={{ height: 20, marginTop: 12, width: "60%" }} />
            <Skeleton style={{ height: 14, marginTop: 8, width: "80%" }} />
          </div>
        ))}
      </div>
    );
  }
  if (query.isError || !query.data?.results.length) {
    return <p className="t-body" style={{ color: "var(--color-muted)" }}>Nothing here yet — check back soon.</p>;
  }
  return (
    <div className="flyer-grid">
      {query.data.results.slice(0, 8).map((flyer) => (
        <FlyerCard key={flyer.id} flyer={flyer} />
      ))}
    </div>
  );
}
