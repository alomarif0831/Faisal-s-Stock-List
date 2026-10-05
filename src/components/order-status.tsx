import type { OrderStatus } from "@/db/schema";

const LABELS: Record<OrderStatus, { text: string; tone: string }> = {
  requested: { text: "Checking availability", tone: "text-warn" },
  verifying: { text: "Checking availability", tone: "text-warn" },
  needs_buyer_approval: { text: "Your approval needed", tone: "text-bad" },
  awaiting_payment: { text: "Payment needed", tone: "text-bad" },
  paid: { text: "Paid · preparing shipment", tone: "text-good" },
  shipped: { text: "Shipped", tone: "text-good" },
  delivered: { text: "Delivered", tone: "text-muted" },
  cancelled: { text: "Cancelled", tone: "text-muted" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = LABELS[status] ?? { text: status, tone: "text-muted" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.tone}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {s.text}
    </span>
  );
}
