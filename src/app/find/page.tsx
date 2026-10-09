import Link from "next/link";
import { AlertForm } from "@/components/alert-form";
import { ListingCard } from "@/components/listing-card";
import { lastWhatsappFor } from "@/lib/alerts";
import { currentUserId } from "@/lib/auth";
import { CONDITIONS } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { findDeals } from "@/lib/listings";
import { dollars, parseQuery } from "@/lib/search";

export const metadata = { title: "Find a deal" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

const EXAMPLES = [
  { q: "16 pro max 256", max: "900" },
  { q: "s25 ultra", max: "800" },
  { q: "ps5", max: "400" },
  { q: "airpods pro 2", max: "150" },
  { q: "macbook air m3", max: "850" },
];

export default async function FindPage({ searchParams }: PageProps<"/find">) {
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 120);
  const condition = (CONDITIONS as readonly string[]).includes(first(sp.condition)) ? first(sp.condition) : "";
  // a price typed into the item box ("ps5 under 400") counts as the budget too
  const parsed = parseQuery(q);
  const maxRaw = first(sp.max).replace(/[$,\s]/g, "");
  const budget = (maxRaw ? dollars(maxRaw) : null) ?? parsed.maxCents;
  const max = budget ? String(budget / 100) : "";
  const error = first(sp.error);

  const userId = await currentUserId();
  const [deals, whatsapp] = await Promise.all([
    q ? findDeals(q, budget, condition || undefined) : null,
    userId ? lastWhatsappFor(userId) : null,
  ]);
  const money = (c: number) => formatMoney(c);
  const found = deals ? deals.under.length + deals.near.length + deals.noPrice.length : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Find a deal</h1>
          <p className="mt-1 text-sm text-muted">
            Tell us what you want and the most you&apos;ll pay. We&apos;ll search every post in the groups, and alert
            you when a new one comes in.
          </p>
        </div>
        <form action="/find" className="card grid gap-3 p-4 sm:grid-cols-[1fr_140px_170px_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="q">
              What are you looking for?
            </label>
            <input id="q" name="q" defaultValue={q} required placeholder="e.g. iPhone 16 Pro Max 256" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="max">
              Your max price
            </label>
            <input id="max" name="max" defaultValue={max} inputMode="decimal" placeholder="$ 900" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="condition">
              Condition
            </label>
            <select id="condition" name="condition" defaultValue={condition} className="input">
              <option value="">Any</option>
              {CONDITIONS.filter((c) => c !== "Unknown").map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary">Find it</button>
        </form>
        {error && <div className="card border-bad p-3 text-sm text-bad">{error}</div>}
        {!q && (
          <div className="space-y-2 text-sm">
            <div className="text-muted">Try one:</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <Link
                  key={e.q}
                  href={`/find?q=${encodeURIComponent(e.q)}&max=${e.max}`}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 hover:bg-background"
                >
                  {e.q} under ${e.max}
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted">
              Shorthand works: &quot;16 pm&quot;, &quot;s25u&quot;, &quot;mbp m4&quot;. You can also type the price
              in the box, like &quot;ps5 under 400&quot;.
            </p>
          </div>
        )}
      </section>

      {deals && (
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          <div className="space-y-8">
            <Section
              title={
                budget
                  ? `${deals.under.length} at or under ${money(budget)}`
                  : `${deals.under.length} with a price`
              }
              empty={
                budget
                  ? `Nothing at ${money(budget)} or less right now. Turn on an alert and we'll tell you when one is posted.`
                  : "Nothing with a price right now."
              }
            >
              {deals.under.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  note={
                    budget && l.salePriceCents && l.salePriceCents < budget
                      ? `${money(budget - l.salePriceCents)} under your budget`
                      : budget
                        ? "Right at your budget"
                        : undefined
                  }
                />
              ))}
            </Section>

            {deals.near.length > 0 && budget && (
              <Section
                title="Just over your budget"
                subtitle="Within 15% of your price. Sellers often take a bit less, so try making an offer."
              >
                {deals.near.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    note={<span className="text-warn">{money(l.salePriceCents! - budget)} over: make an offer</span>}
                  />
                ))}
              </Section>
            )}

            {deals.noPrice.length > 0 && (
              <Section title="No price posted" subtitle="These match but the seller didn't post a price. Ask them.">
                {deals.noPrice.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </Section>
            )}
            {found === 0 && (
              <p className="text-sm text-muted">
                Tip: use fewer words (&quot;16 pro max&quot; instead of the full name) or{" "}
                <Link href={`/?q=${encodeURIComponent(q)}`} className="text-accent underline">
                  search all stock
                </Link>
                .
              </p>
            )}
          </div>

          <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <AlertForm
              q={q}
              max={max}
              condition={condition}
              whatsapp={whatsapp}
              label={
                <>
                  Get alerted when a new &quot;{q}&quot; is posted
                  {budget ? ` at ${money(budget)} or less` : ""}
                </>
              }
            />
            <p className="px-1 text-xs text-muted">
              We check every new post (and price drops) against your alerts.{" "}
              <Link href="/alerts" className="text-accent underline">
                Manage alerts
              </Link>
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty?: string;
  children: React.ReactNode[] | React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {items.length === 0 && empty ? (
        <div className="card p-6 text-center text-sm text-muted">{empty}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
      )}
    </section>
  );
}
