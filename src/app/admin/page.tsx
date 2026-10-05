import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import { db, listings } from "@/db";
import { formatMoney, phoneFromJid, timeAgo } from "@/lib/format";
import { deleteListing, setListingStatus, updateListing } from "./actions";

const STATUSES = ["active", "hidden", "sold"] as const;

export default async function AdminListings({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "active";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const where: SQL[] = [eq(listings.status, status)];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(listings.title, like), ilike(listings.sellerName, like), ilike(listings.chatName, like))!);
  }
  const [rows, counts] = await Promise.all([
    db.select().from(listings).where(and(...where)).orderBy(desc(listings.lastSeenAt)).limit(200),
    db.select({ status: listings.status, n: count() }).from(listings).groupBy(listings.status),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin?status=${s}`}
            className={`rounded-full border px-3 py-1 text-sm capitalize ${s === status ? "border-foreground bg-foreground text-background" : "border-line"}`}
          >
            {s} {counts.find((c) => c.status === s)?.n ?? 0}
          </Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={q} placeholder="Search title, seller, group" className="input w-64" />
        </form>
      </div>
      <p className="text-xs text-muted">
        Buyers see the sale price only. Seller, group and source price are visible to admins only. Active listings
        drop off the storefront if the seller hasn&apos;t re-posted them within the listing TTL.
      </p>

      <div className="space-y-2">
        {rows.map((l) => {
          const phone = phoneFromJid(l.sellerId);
          return (
            <div key={l.id} className="card grid gap-4 p-3 md:grid-cols-[80px_1fr_auto]">
              <ProductImage id={l.imageIds[0]} alt={l.title} className="size-20 rounded-lg bg-background object-contain" />
              <div className="min-w-0 space-y-1 text-sm">
                <form action={updateListing} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <input name="title" defaultValue={l.title} className="input min-w-0 flex-1 font-medium" />
                  <label>
                    <span className="label">Seller price $</span>
                    <input name="sourcePrice" defaultValue={l.sourcePriceCents / 100} className="input w-24" inputMode="decimal" />
                  </label>
                  <label>
                    <span className="label">Qty</span>
                    <input name="quantity" defaultValue={l.quantity} className="input w-16" inputMode="numeric" />
                  </label>
                  <button className="btn-ghost">Save</button>
                </form>
                <div className="text-xs text-muted">
                  {l.brand} · {l.category} · {l.condition}
                  {l.details && ` · ${l.details}`}
                </div>
                <div className="text-xs">
                  <span className="font-medium">{formatMoney(l.salePriceCents)}</span>
                  <span className="text-muted"> sale = {formatMoney(l.sourcePriceCents)} + {formatMoney(l.markupCents)} markup</span>
                </div>
                <div className="text-xs text-muted">
                  {l.sellerName ?? "Unknown seller"}
                  {phone && (
                    <>
                      {" "}
                      <a className="text-accent underline" href={`https://wa.me/${phone.slice(1)}`} target="_blank">
                        {phone}
                      </a>
                    </>
                  )}{" "}
                  in {l.chatName ?? l.chatId} · seen {timeAgo(l.lastSeenAt)}
                </div>
                {l.rawText && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">Original message</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans">{l.rawText}</pre>
                  </details>
                )}
              </div>
              <div className="flex flex-row flex-wrap items-start gap-2 md:flex-col">
                {STATUSES.filter((s) => s !== l.status).map((s) => (
                  <form key={s} action={setListingStatus}>
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="status" value={s} />
                    <button className="btn-ghost w-full capitalize">{s === "active" ? "Show" : s === "hidden" ? "Hide" : "Sold"}</button>
                  </form>
                ))}
                <form action={deleteListing}>
                  <input type="hidden" name="id" value={l.id} />
                  <button className="btn-danger w-full">Delete</button>
                </form>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">No {status} listings.</div>}
      </div>
    </div>
  );
}
