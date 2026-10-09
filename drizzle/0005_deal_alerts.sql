CREATE TABLE "want_hits" (
	"want_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "want_hits_want_id_listing_id_pk" PRIMARY KEY("want_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "wants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"query" text NOT NULL,
	"max_price_cents" integer,
	"condition" text,
	"notify_whatsapp" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "want_hits" ADD CONSTRAINT "want_hits_want_id_wants_id_fk" FOREIGN KEY ("want_id") REFERENCES "public"."wants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "want_hits" ADD CONSTRAINT "want_hits_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wants_user_idx" ON "wants" USING btree ("clerk_user_id");