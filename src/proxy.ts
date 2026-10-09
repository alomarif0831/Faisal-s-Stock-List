import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkProxyEnabled } from "@/lib/clerk-proxy";

// Members only: every page needs an account except sign-in/up. API routes
// (WhatsApp/Stripe webhooks, cron, photos) authenticate themselves.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api(.*)", "/__clerk(.*)"]);

const clerkConfigured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

// Live Clerk keys on a *.vercel.app address reach Clerk through /__clerk on
// this app; on a custom domain they use Clerk's own DNS (see clerk-proxy.ts).
const withClerk = clerkMiddleware(
  async (auth, req) => {
    if (isPublic(req)) return;
    const { userId } = await auth();
    if (userId) return;
    // New visitors mostly arrive from the group announcement, so send them
    // to sign-up (it links to sign-in), then back to the page they wanted.
    const url = new URL("/sign-up", req.url);
    url.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  },
  (req) => ({ frontendApiProxy: { enabled: clerkProxyEnabled(req.headers.get("host")) } }),
);

export function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (!clerkConfigured) {
    // Keep the storefront browsable before Clerk keys are added.
    if (/^\/(account|admin|sign-)/.test(req.nextUrl.pathname)) {
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
