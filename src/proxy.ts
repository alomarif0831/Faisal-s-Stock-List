import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkProxyEnabled } from "@/lib/clerk-proxy";

// Only account and admin pages need a session; the catalog is public, and
// the WhatsApp/Stripe webhooks authenticate themselves.
const isProtected = createRouteMatcher(["/account(.*)", "/admin(.*)"]);

const clerkConfigured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

// Live Clerk keys on a *.vercel.app address reach Clerk through /__clerk on
// this app; on a custom domain they use Clerk's own DNS (see clerk-proxy.ts).
const withClerk = clerkMiddleware(
  async (auth, req) => {
    if (isProtected(req)) await auth.protect();
  },
  (req) => ({ frontendApiProxy: { enabled: clerkProxyEnabled(req.headers.get("host")) } }),
);

export function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (!clerkConfigured) {
    // Keep the storefront browsable before Clerk keys are added.
    if (isProtected(req) || req.nextUrl.pathname.startsWith("/sign-")) {
      return NextResponse.redirect(new URL("/?setup=clerk", req.url));
    }
    return NextResponse.next();
  }
  return withClerk(req, ev);
}

export const config = {
  matcher: [
    "/((?!_next|api/images|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's Frontend API proxy (production keys on *.vercel.app route
    // through it). Listed explicitly because its script URLs end in .js,
    // which the static-file exclusion above would otherwise skip.
    "/__clerk/(.*)",
  ],
};
