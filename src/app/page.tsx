import Link from "next/link";
import { ListingCard } from "@/components/listing-card";
import { BRANDS, CATEGORIES, CONDITIONS } from "@/lib/catalog";
import { facetCounts, searchCatalog, type CatalogFilters } from "@/lib/listings";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CatalogPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const filters: CatalogFilters = {
    q: first(sp.q),
    brand: first(sp.brand),
    category: first(sp.category),
    condition: first(sp.condition),
    sort: first(sp.sort),
    seller: first(sp.seller),
    min: first(sp.min),
    max: first(sp.max),
    fresh: first(sp.fresh),
  };
  const setupClerk = first(sp.setup) === "clerk";

  let items: Awaited<ReturnType<typeof searchCatalog>> = [];
  let facets: Awaited<ReturnType<typeof facetCounts>> = { brands: [], categories: [] };
  let dbError = false;
  try {
    [items, facets] = await Promise.all([searchCatalog(filters), facetCounts()]);
  } catch (err) {
    console.error("[catalog]", err);
    dbError = true;
  }

  const href = (patch: Partial<CatalogFilters>) => {
    const next = { ...filters, ...patch };
    const qs = new URLSearchParams(
      Object.entries(next).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
    return qs ? `/?${qs}` : "/";
  };
  const brandCount = (b: string) => facets.brands.find((x) => x.value === b)?.n ?? 0;
  const catCount = (c: string) => facets.categories.find((x) => x.value === c)?.n ?? 0;
  const total = facets.brands.reduce((s, b) => s + b.n, 0);

  return (
    <div className="space-y-6">
      {setupClerk && (
        <div className="card border-warn p-3 text-sm text-warn">
          Accounts aren&apos;t switched on yet: add the Clerk keys in Vercel (see README).
        </div>
      )}
      {dbError && (
        <div className="card p-3 text-sm text-bad">The catalog is unavailable right now. Check DATABASE_URL.</div>
      )}

      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">In stock now</h1>
          <p className="mt-1 text-sm text-muted">
            {total} item{total === 1 ? "" : "s"} · updated live as sellers post
          </p>
        </div>
        <form action="/" className="flex w-full gap-2 sm:w-auto">
          {filters.brand && <input type="hidden" name="brand" value={filters.brand} />}
          {filters.seller && <input type="hidden" name="seller" value={filters.seller} />}
          {filters.category && <input type="hidden" name="category" value={filters.category} />}
          {filters.min && <input type="hidden" name="min" value={filters.min} />}
          {filters.max && <input type="hidden" name="max" value={filters.max} />}
          {filters.fresh && <input type="hidden" name="fresh" value={filters.fresh} />}
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Try: 16 pm 256 under $900"
            className="input sm:w-80"
          />
          <button className="btn-primary">Search</button>
        </form>
      </section>

      <div className="card flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-medium">Know what you want and what you&apos;ll pay?</span>
          <span className="text-muted">
            {" "}
            Tell us the item and your price. We&apos;ll find every match in the groups and alert you when a new one
            is posted.
          </span>
        </div>
        <Link href="/find" className="btn-primary shrink-0 px-4 py-2 text-sm">
          Find a deal
        </Link>
      </div>

      {filters.seller && (
        <div className="flex items-center gap-3 text-sm">
          <span>
            Showing stock from <span className="font-semibold">{items[0]?.sellerName ?? "this seller"}</span>
          </span>
          <Link href={href({ seller: undefined })} className="text-accent underline">
            Show everyone
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Pill href={href({ brand: undefined })} active={!filters.brand}>
          All brands
        </Pill>
        {BRANDS.filter((b) => brandCount(b) > 0 || filters.brand === b).map((b) => (
          <Pill key={b} href={href({ brand: b })} active={filters.brand === b}>
            {b} <span className="opacity-60">{brandCount(b)}</span>
          </Pill>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <aside className="space-y-5 text-sm">
          <FilterGroup title="Category">
            <FilterLink href={href({ category: undefined })} active={!filters.category}>
              All
            </FilterLink>
            {CATEGORIES.filter((c) => catCount(c) > 0 || filters.category === c).map((c) => (
              <FilterLink key={c} href={href({ category: c })} active={filters.category === c}>
                {c} <span className="text-muted">({catCount(c)})</span>
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup title="Condition">
            <FilterLink href={href({ condition: undefined })} active={!filters.condition}>
              Any
            </FilterLink>
            {CONDITIONS.filter((c) => c !== "Unknown").map((c) => (
              <FilterLink key={c} href={href({ condition: c })} active={filters.condition === c}>
                {c}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup title="Price">
            <form action="/" className="flex items-center gap-1">
              {Object.entries(filters)
                .filter(([k, v]) => v && !["min", "max"].includes(k))
                .map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
              <input name="min" defaultValue={filters.min} inputMode="numeric" placeholder="$ min" className="input w-20 px-2 py-1 text-sm" />
              <span className="text-muted">–</span>
              <input name="max" defaultValue={filters.max} inputMode="numeric" placeholder="$ max" className="input w-20 px-2 py-1 text-sm" />
              <button className="btn-ghost px-2 py-1 text-sm">Go</button>
            </form>
            {(filters.min || filters.max) && (
              <FilterLink href={href({ min: undefined, max: undefined })} active={false}>
                Any price
              </FilterLink>
            )}
          </FilterGroup>
          <FilterGroup title="Posted">
            <FilterLink href={href({ fresh: undefined })} active={!filters.fresh}>
              Any time
            </FilterLink>
            <FilterLink href={href({ fresh: "1" })} active={filters.fresh === "1"}>
              Last 24 hours
            </FilterLink>
          </FilterGroup>
          <FilterGroup title="Sort">
            <FilterLink href={href({ sort: undefined })} active={!filters.sort}>
              Newest
            </FilterLink>
            <FilterLink href={href({ sort: "price_asc" })} active={filters.sort === "price_asc"}>
              Price: low to high
            </FilterLink>
            <FilterLink href={href({ sort: "price_desc" })} active={filters.sort === "price_desc"}>
              Price: high to low
            </FilterLink>
          </FilterGroup>
        </aside>

        <section>
          {items.length === 0 ? (
            <div className="card p-10 text-center text-sm text-muted">
              <p>Nothing matches right now. New stock is added automatically as it arrives.</p>
              {filters.q && (
                <Link
                  href={`/find?q=${encodeURIComponent(filters.q)}${filters.max ? `&max=${encodeURIComponent(filters.max)}` : ""}`}
                  className="btn-primary mt-4 inline-flex px-4 py-2 text-sm"
                >
                  🔔 Alert me when “{filters.q}” is posted
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {items.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm ${
        active ? "border-foreground bg-foreground text-background" : "border-line bg-surface hover:bg-background"
      }`}
    >
      {children}
    </Link>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="flex flex-wrap gap-1 lg:flex-col">{children}</div>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2 py-1 ${active ? "bg-surface font-medium shadow-sm ring-1 ring-line" : "hover:bg-surface"}`}
    >
      {children}
    </Link>
  );
}
