"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customers, db, orders } from "@/db";
import { hasShipping, requireCustomer } from "@/lib/auth";
import { createOrderRequest } from "@/lib/orders";
import { createCardSetupSession } from "@/lib/stripe";
import { acceptChange, startVerification } from "@/lib/verify";

const field = (fd: FormData, k: string, max = 200) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};

export async function saveProfile(fd: FormData) {
  const c = await requireCustomer();
  await db
    .update(customers)
    .set({
      fullName: field(fd, "fullName"),
      phone: field(fd, "phone", 40),
      shipName: field(fd, "shipName"),
      shipLine1: field(fd, "shipLine1"),
      shipLine2: field(fd, "shipLine2"),
      shipCity: field(fd, "shipCity", 100),
      shipState: field(fd, "shipState", 100),
      shipPostalCode: field(fd, "shipPostalCode", 20),
      shipCountry: (field(fd, "shipCountry", 2) ?? "US").toUpperCase(),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, c.id));
  const next = field(fd, "next", 300);
  if (next?.startsWith("/")) redirect(next);
  revalidatePath("/account");
  redirect("/account?saved=1");
}

export async function addCard(fd: FormData) {
  const c = await requireCustomer();
  void fd;
  redirect(await createCardSetupSession(c));
}

export async function requestToBuy(fd: FormData) {
  const listingId = String(fd.get("listingId") ?? "");
  const c = await requireCustomer(`/listing/${listingId}`);
  if (!hasShipping(c) || !c.hasPaymentMethod) {
    redirect(`/account?next=${encodeURIComponent(`/listing/${listingId}`)}`);
  }
  const order = await createOrderRequest(
    c,
    listingId,
    Number(fd.get("quantity") ?? 1) || 1,
    field(fd, "note", 500),
  );
  // Ask the seller right away; the buyer's page shows progress.
  await startVerification(order.id).catch((err) => console.error("[verify]", err));
  redirect(`/account/orders/${order.id}?requested=1`);
}

export async function cancelMyOrder(fd: FormData) {
  const c = await requireCustomer();
  const id = String(fd.get("orderId") ?? "");
  // Buyers can only withdraw before they've been charged.
  await db
    .update(orders)
    .set({ status: "cancelled", checkoutUrl: null, updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.customerId, c.id),
        inArray(orders.status, ["requested", "verifying", "needs_buyer_approval"]),
      ),
    );
  revalidatePath(`/account/orders/${id}`);
}

export async function acceptSellerChange(fd: FormData) {
  const c = await requireCustomer();
  const id = String(fd.get("orderId") ?? "");
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, c.id)));
  if (order) await acceptChange(order);
  revalidatePath(`/account/orders/${id}`);
}
