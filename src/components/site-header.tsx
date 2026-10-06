import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { clerkConfigured, isAdmin } from "@/lib/auth";
import { SITE_NAME } from "@/lib/config";
import { OnyxGem } from "./onyx-mark";

export async function SiteHeader() {
  const signedIn = clerkConfigured() ? Boolean((await auth()).userId) : false;
  const admin = signedIn && (await isAdmin());

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <OnyxGem className="size-7" />
          {SITE_NAME}
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-full px-3 py-1.5 hover:bg-background">
            Shop
          </Link>
          {admin && (
            <Link href="/admin" className="rounded-full px-3 py-1.5 hover:bg-background">
              Admin
            </Link>
          )}
          {signedIn ? (
            <>
              <Link href="/account" className="rounded-full px-3 py-1.5 hover:bg-background">
                Account
              </Link>
              <UserButton />
            </>
          ) : (
            clerkConfigured() && (
              <>
                <Link href="/sign-in" className="rounded-full px-3 py-1.5 hover:bg-background">
                  Sign in
                </Link>
                <Link href="/sign-up" className="btn-primary">
                  Create account
                </Link>
              </>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
