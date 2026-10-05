import { eq } from "drizzle-orm";
import { db, images } from "@/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/api/images/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const [img] = await db.select().from(images).where(eq(images.id, id));
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mimeType,
      // image rows are never modified, so the browser/CDN can keep them forever
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
