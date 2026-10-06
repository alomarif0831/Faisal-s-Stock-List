DROP INDEX "listings_dedupe_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "listings_seller_product_uniq" ON "listings" USING btree ("seller_id","dedupe_key") WHERE "listings"."status" <> 'sold';