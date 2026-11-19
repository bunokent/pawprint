import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { flyerListQuery, type Mode } from "@/features/flyers/api";
import { FlyerCard } from "@/components/FlyerCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";

export function GalleryPage() {
  const [params, setParams] = useSearchParams();
  const mode = (params.get("mode") as Mode | null) ?? undefined;
  const q = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? undefined;
  const [searchInput, setSearchInput] = useState(q);

  const query = useQuery(flyerListQuery({ mode, q: q || undefined, cursor }));

  const setMode = (m: Mode | undefined) => {
    const next = new URLSearchParams(params);
    if (m) next.set("mode", m); else next.delete("mode");
    next.delete("cursor");
    setParams(next);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (searchInput) next.set("q", searchInput); else next.delete("q");
    next.delete("cursor");
    setParams(next);
  };

  return (
    <section style={{ padding: "64px 0" }}>
      <div className="wrap">
        <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
          {mode === "emergency" ? "Lost pet alerts" : mode === "found" ? "Found pets" : mode === "outreach" ? "Adoptable pets" : "All flyers"}
        </h1>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 32 }}>
          Public gallery — anyone can browse and scan. Found a pet? Open the flyer and call the number.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 24 }}>
          <div className="btn-row" role="group" aria-label="Filter by mode">
            <Button variant={mode === undefined ? "primary" : "secondary"} style={{ height: 40 }} onClick={() => setMode(undefined)}>All</Button>
            <Button variant={mode === "emergency" ? "emergency" : "secondary"} style={{ height: 40 }} onClick={() => setMode("emergency")}>Lost — urgent</Button>
            <Button variant={mode === "found" ? "found" : "secondary"} style={{ height: 40 }} onClick={() => setMode("found")}>Found</Button>
            <Button variant={mode === "outreach" ? "sage" : "secondary"} style={{ height: 40 }} onClick={() => setMode("outreach")}>Adoptable</Button>
          </div>
          <form onSubmit={submitSearch} style={{ display: "flex", gap: 8, flex: 1, minWidth: 240 }}>
            <Input
              aria-label="Search pets by name, breed or color"
              placeholder="Search name, breed, color…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" variant="secondary" style={{ height: 44 }}>Search</Button>
          </form>
        </div>

        {query.isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="photo-frame" style={{ aspectRatio: "4 / 3", borderRadius: 20 }} />
                <Skeleton style={{ height: 20, marginTop: 12, width: "60%" }} />
              </div>
            ))}
          </div>
        )}

        {query.isError && <ErrorBox message="Could not load flyers. Please try again." />}

        {query.data && query.data.results.length === 0 && (
          <EmptyState title="No flyers match">
            <p>Try clearing the search or switching mode.</p>
          </EmptyState>
        )}

        {query.data && query.data.results.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
              {query.data.results.map((flyer) => (
                <FlyerCard key={flyer.id} flyer={flyer} />
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 32, justifyContent: "center" }}>
              {query.data.previous && (
                <Button variant="secondary" asChild>
                  <a href={`?${new URLSearchParams({ ...Object.fromEntries(params), cursor: new URL(query.data.previous).searchParams.get("cursor") ?? "" })}`}>← Newer</a>
                </Button>
              )}
              {query.data.next && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("cursor", new URL(query.data.next!).searchParams.get("cursor") ?? "");
                    setParams(next);
                  }}
                >
                  Older →
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
