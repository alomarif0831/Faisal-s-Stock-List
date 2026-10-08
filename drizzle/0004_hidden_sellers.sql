CREATE TABLE "hidden_sellers" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"seller_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
