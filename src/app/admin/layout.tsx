import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Admin" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="space-y-5">
      <nav className="flex gap-1 border-b border-line text-sm">
        {[
          ["/admin", "Listings"],
          ["/admin/orders", "Orders"],
          ["/admin/inbox", "WhatsApp inbox"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="-mb-px border-b-2 border-transparent px-3 py-2 hover:border-line">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
