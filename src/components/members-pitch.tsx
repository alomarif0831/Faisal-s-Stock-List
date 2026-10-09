import { SITE_NAME } from "@/lib/config";

/** Shown beside the sign-up / sign-in form, since every page needs an account. */
export function MembersPitch() {
  return (
    <div className="max-w-sm space-y-3 text-center lg:text-left">
      <h1 className="text-2xl font-semibold tracking-tight">All the group stock in one place</h1>
      <p className="text-sm text-muted">
        {SITE_NAME} collects every post from our WhatsApp reseller groups: phones, tablets, laptops and more,
        at the prices sellers posted. Create a free account to browse and message sellers directly.
      </p>
      <ul className="space-y-1 text-sm">
        <li>✅ Search and filter every listing</li>
        <li>💬 Message sellers on WhatsApp in one tap</li>
        <li>🆓 Free, takes a minute</li>
      </ul>
    </div>
  );
}
