import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { PaymentBadges } from "@/components/payment-badges";
import { SiteHeader } from "@/components/site-header";
import { clerkConfigured } from "@/lib/auth";
import { CLERK_PROXY_PATH, clerkProxyEnabled } from "@/lib/clerk-proxy";
import { SITE_NAME } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: "Phones, tablets, laptops and more from Apple, Samsung and other brands, in stock now.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const page = (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="space-y-3 border-t border-line px-4 py-6 text-center text-xs text-muted">
          <PaymentBadges className="justify-center" />
          <p>{SITE_NAME} · Prices in USD · Every order is confirmed before you&apos;re charged.</p>
        </footer>
      </body>
    </html>
  );
  if (!clerkConfigured()) return page;
  return <ClerkProvider proxyUrl={clerkProxyEnabled() ? CLERK_PROXY_PATH : undefined}>{page}</ClerkProvider>;
}
