import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUserId, isAdmin } from "@/lib/auth";
import { SITE_NAME } from "@/lib/config";
import { OnyxGem } from "./onyx-mark";

export async function SiteHeader() {
  const signedIn = Boolean(await currentUserId());
  const admin = signedIn && (await isAdmin());

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <OnyxGem className="size-7" />
          <span className="hidden min-[400px]:inline">{SITE_NAME}</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/" className="hidden rounded-full px-3 py-1.5 hover:bg-background sm:inline">
            All stock
          </Link>
          {signedIn && (
            <>
              <Link href="/find" className="rounded-full px-3 py-1.5 hover:bg-background">
                Find a deal
              </Link>
              <Link href="/alerts" className="rounded-full px-3 py-1.5 hover:bg-background">
                Alerts
              </Link>
            </>
          )}
          {admin && (
            <Link href="/admin" className="rounded-full px-3 py-1.5 hover:bg-background">
              Admin
            </Link>
          )}
          {/* Every page needs an account (see proxy.ts). */}
          {signedIn && <UserButton />}
        </nav>
      </div>
    </header>
  );
}
