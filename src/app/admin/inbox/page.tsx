import { desc } from "drizzle-orm";
import { connection } from "next/server";
import { db, waMessages } from "@/db";
import { allowedGroups } from "@/lib/config";
import { timeAgo } from "@/lib/format";
import { listGroups } from "@/lib/whatsapp/whapi";
import { reprocessMessage } from "../actions";

const TONE: Record<string, string> = {
  pending: "text-warn",
  done: "text-good",
  ignored: "text-muted",
  failed: "text-bad",
};

export default async function Inbox() {
  await connection(); // live data, never prerender
  const [rows, groups] = await Promise.all([
    db.select().from(waMessages).orderBy(desc(waMessages.createdAt)).limit(150),
    process.env.WHAPI_TOKEN ? listGroups().catch(() => null) : Promise.resolve(null),
  ]);
  const allowed = allowedGroups();

  return (
    <div className="space-y-5">
      <section className="card p-4 text-sm">
        <h2 className="font-semibold">Groups the bot&apos;s number is in</h2>
        <p className="mt-1 text-xs text-muted">
          {allowed.length
            ? "Only groups listed in WHATSAPP_GROUP_IDS are captured."
            : "WHATSAPP_GROUP_IDS is empty, so every group is captured. Copy the ids of your 4 reseller groups into it to limit capture."}
        </p>
        {groups === null ? (
          <p className="mt-2 text-xs text-warn">Couldn&apos;t load groups (check WHAPI_TOKEN).</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {groups.map((g) => (
              <li key={g.id} className="flex gap-3 text-xs">
                <span className={allowed.length === 0 || allowed.includes(g.id) ? "text-good" : "text-muted"}>●</span>
                <span className="font-medium">{g.name ?? "(no name)"}</span>
                <code className="text-muted">{g.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recent messages</h2>
        {rows.map((m) => (
          <div key={m.id} className="card flex gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">
                <span className={`font-medium ${TONE[m.status] ?? ""}`}>{m.status}</span> · {m.senderName ?? m.senderId} in{" "}
                {m.chatName ?? m.chatId} · {timeAgo(m.sentAt)} {m.imageId && "· 📷"}
              </div>
              {m.text && <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{m.text}</p>}
              {m.error && <p className="mt-1 text-xs text-bad">{m.error}</p>}
            </div>
            {(m.status === "failed" || m.status === "ignored") && (
              <form action={reprocessMessage}>
                <input type="hidden" name="id" value={m.id} />
                <button className="btn-ghost">Re-run</button>
              </form>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="card p-8 text-center text-sm text-muted">
            No messages yet. Once the gateway webhook points at /api/whatsapp/webhook, group posts show up here.
          </div>
        )}
      </section>
    </div>
  );
}
