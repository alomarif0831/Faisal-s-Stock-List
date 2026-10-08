import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/site-header";
import { clerkConfigured } from "@/lib/auth";
import { CLERK_PROXY_PATH, clerkProxyEnabled } from "@/lib/clerk-proxy";
import { SITE_NAME } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description:
    "Live stock from WhatsApp reseller groups: phones, tablets, laptops and more. Message sellers directly.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const page = (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="space-y-1 border-t border-line px-4 py-6 text-center text-xs text-muted">
          <p>
            {SITE_NAME} lists stock posted in WhatsApp reseller groups. Prices are as posted, in USD. Deals are
            between you and the seller.
          </p>
          <p>Seller and want your posts removed? Message the group admin.</p>
        </footer>
      </body>
    </html>
  );
  if (!clerkConfigured()) return page;
  const host = (await headers()).get("host");
  return (
    <ClerkProvider proxyUrl={clerkProxyEnabled(host) ? CLERK_PROXY_PATH : undefined}>{page}</ClerkProvider>
  );
}
