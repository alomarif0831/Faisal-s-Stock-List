import { createWant } from "@/app/alerts/actions";

/** "Alert me" form: saves the search as a deal alert. */
export function AlertForm({
  q,
  max,
  condition,
  whatsapp,
  label,
}: {
  q: string;
  max?: string;
  condition?: string;
  whatsapp?: string | null;
  label: React.ReactNode;
}) {
  return (
    <form action={createWant} className="card space-y-3 p-4">
      <div className="font-semibold">{label}</div>
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="max" value={max ?? ""} />
      <input type="hidden" name="condition" value={condition ?? ""} />
      <div>
        <label className="label" htmlFor="whatsapp">
          Your WhatsApp number (optional, for instant alerts)
        </label>
        <input
          id="whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          defaultValue={whatsapp ? `+${whatsapp}` : ""}
          placeholder="+1 555 123 4567"
          className="input"
        />
        <p className="mt-1 text-xs text-muted">
          Leave it empty to just see new matches on your Alerts page.
        </p>
      </div>
      <button className="btn-primary w-full">🔔 Turn on alert</button>
    </form>
  );
}
