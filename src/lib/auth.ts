import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { customers, db, type Customer } from "@/db";
import { adminEmails } from "@/lib/config";

export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

async function primaryEmail(): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  return (primary ?? user.emailAddresses[0])?.emailAddress.toLowerCase() ?? null;
}

export async function isAdmin(): Promise<boolean> {
  if (!clerkConfigured()) return false;
  const { userId } = await auth();
  if (!userId) return false;
  const email = await primaryEmail();
  return Boolean(email && adminEmails().includes(email));
}

export async function requireAdmin(): Promise<void> {
  if (!clerkConfigured()) notFound();
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/admin");
  if (!(await isAdmin())) notFound();
}

/** The signed-in buyer's customer row, created on first visit. Null when signed out. */
export async function getCustomer(): Promise<Customer | null> {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;

  const [existing] = await db.select().from(customers).where(eq(customers.clerkUserId, userId));
  if (existing) return existing;

  const user = await currentUser();
  const [created] = await db
    .insert(customers)
    .values({
      clerkUserId: userId,
      email: await primaryEmail(),
      fullName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(customers).where(eq(customers.clerkUserId, userId));
  return row ?? null;
}

export async function requireCustomer(returnTo = "/account"): Promise<Customer> {
  if (!clerkConfigured()) redirect("/?setup=clerk");
  const customer = await getCustomer();
  if (!customer) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  return customer;
}

export function hasShipping(c: Customer): boolean {
  return Boolean(c.shipName && c.shipLine1 && c.shipCity && c.shipState && c.shipPostalCode && c.shipCountry);
}
