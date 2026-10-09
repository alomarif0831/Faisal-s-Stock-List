import { and, desc, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, listings, wantHits, wants } from "@/db";
import { currentUserId } from "@/lib/auth";
import { listingCutoff } from "@/lib/config";
import { formatMoney, formatPrice, timeAgo } from "@/lib/format";
import { deleteWant } from "./actions";

export const metadata = { title: "My alerts" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const sp = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in?redirect_url=/alerts");

  const mine = await db
    .select()
    .from(wants)
    .where(eq(wants.clerkUserId, userId))
    .orderBy(desc(wants.createdAt));

  // Matches still on the site, newest first.
  const cutoff = listingCutoff();
  const hits = mine.length
    ? await db
        .select({
          wantId: wantHits.wantId,
          at: wantHits.createdAt,
          id: listings.id,
          title: listings.title,
          price: listings.salePriceCents,
          currency: listings.currency,
          seller: listings.sellerName,
        })
        .from(wantHits)
        .innerJoin(listings, eq(listings.id, wantHits.listingId))
        .where(
          and(
            inArray(
              wantHits.wantId,
              mine.map((w) => w.id),
            ),
            eq(listings.status, "active"),
            gte(listings.lastSeenAt, cutoff),
          ),
        )
        .orderBy(desc(wantHits.createdAt))
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My alerts</h1>
          <p className="mt-1 text-sm text-muted">
            Every new post and price drop in the groups is checked against these.
          </p>
        </div>
        <Link href="/find" className="btn-primary shrink-0 px-4 py-2 text-sm">
          + New alert
        </Link>
      </div>

      {first(sp.created) && (
        <div className="card border-good p-3 text-sm text-good">
          Alert saved. Matches already listed are below; new ones will show up here
          {mine[0]?.notifyWhatsapp ? " and on WhatsApp" : ""}.
        </div>
      )}

      {mine.length === 0 && (
        <div className="card p-8 text-center text-sm text-muted">
          No alerts yet.{" "}
          <Link href="/find" className="text-accent underline">
            Find a deal
          </Link>{" "}
          and tap &quot;Turn on alert&quot; to get told when it&apos;s posted.
        </div>
      )}

      {mine.map((w) => {
        const matches = hits.filter((h) => h.wantId === w.id);
        const findHref = `/find?${new URLSearchParams({
          q: w.query,
          ...(w.maxPriceCents ? { max: String(w.maxPriceCents / 100) } : {}),
          ...(w.condition ? { condition: w.condition } : {}),
        })}`;
        return (
          <div key={w.id} className="card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">&quot;{w.query}&quot;</div>
                <div className="text-xs text-muted">
                  {w.maxPriceCents ? `Up to ${formatMoney(w.maxPriceCents)}` : "Any price"}
                  {w.condition ? ` · ${w.condition}` : ""}
                  {" · "}
                  {w.notifyWhatsapp ? `WhatsApp alerts to +${w.notifyWhatsapp}` : "Site only (no WhatsApp)"}
                </div>
              </div>
              <form action={deleteWant}>
                <input type="hidden" name="id" value={w.id} />
                <button className="text-xs text-bad underline">Delete</button>
              </form>
            </div>
            {matches.length === 0 ? (
              <p className="text-sm text-muted">No matches on the site right now. We&apos;re watching.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {matches.slice(0, 8).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/listing/${m.id}`} className="min-w-0 truncate hover:underline">
                      {m.title}
                      <span className="text-muted"> · {m.seller ?? "seller"}</span>
                    </Link>
                    <span className="shrink-0 text-right">
                      <span className="font-semibold">{formatPrice(m.price, m.currency)}</span>
                      <span className="block text-[11px] text-muted">{timeAgo(m.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={findHref} className="text-xs text-accent underline">
              See all matches{matches.length > 8 ? ` (${matches.length})` : ""}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
