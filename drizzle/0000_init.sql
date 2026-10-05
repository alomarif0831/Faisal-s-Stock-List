CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text,
	"full_name" text,
	"phone" text,
	"ship_name" text,
	"ship_line1" text,
	"ship_line2" text,
	"ship_city" text,
	"ship_state" text,
	"ship_postal_code" text,
	"ship_country" text DEFAULT 'US',
	"stripe_customer_id" text,
	"payment_method_id" text,
	"card_brand" text,
	"card_last4" text,
	"has_payment_method" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"brand" text NOT NULL,
	"category" text NOT NULL,
	"model" text,
	"storage" text,
	"color" text,
	"condition" text NOT NULL,
	"details" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"source_price_cents" integer NOT NULL,
	"markup_cents" integer NOT NULL,
	"sale_price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"image_ids" uuid[] DEFAULT '{}' NOT NULL,
	"chat_id" text NOT NULL,
	"chat_name" text,
	"seller_id" text NOT NULL,
	"seller_name" text,
	"source_message_id" text NOT NULL,
	"raw_text" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"source_price_cents" integer NOT NULL,
	"shipping" jsonb NOT NULL,
	"buyer_note" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"payment_intent_id" text,
	"payment_error" text,
	"checkout_url" text,
	"carrier" text,
	"tracking_number" text,
	"admin_note" text,
	"seller_contact" text,
	"verify_asked_at" timestamp with time zone,
	"verify_status" text,
	"seller_reply" text,
	"verify_summary" text,
	"proposed_unit_price_cents" integer,
	"proposed_quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"chat_name" text,
	"sender_id" text NOT NULL,
	"sender_name" text,
	"type" text NOT NULL,
	"text" text,
	"image_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"raw" jsonb,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_clerk_idx" ON "customers" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "customers_stripe_idx" ON "customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "listings_catalog_idx" ON "listings" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "listings_dedupe_idx" ON "listings" USING btree ("seller_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "orders_seller_contact_idx" ON "orders" USING btree ("seller_contact","status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_sender_idx" ON "wa_messages" USING btree ("chat_id","sender_id","sent_at");