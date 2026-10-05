import "server-only";
import { sendText } from "@/lib/whatsapp/whapi";

/** Best-effort WhatsApp ping to the store owner. Never throws. */
export async function notifyAdmin(text: string): Promise<void> {
  const to = process.env.ADMIN_WHATSAPP_NUMBER;
  if (!to || !process.env.WHAPI_TOKEN) return;
  await sendText(to, text).catch((err) => console.warn("[notify] admin", err));
}

/** Best-effort WhatsApp message to a buyer who gave us their phone. Never throws. */
export async function notifyBuyer(phone: string | null, text: string): Promise<void> {
  if (!phone || !process.env.WHAPI_TOKEN || process.env.NOTIFY_BUYERS_WHATSAPP === "false") return;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return;
  await sendText(digits, text).catch((err) => console.warn("[notify] buyer", err));
}
