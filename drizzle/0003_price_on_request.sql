ALTER TABLE "listings" ALTER COLUMN "source_price_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "sale_price_cents" DROP NOT NULL;