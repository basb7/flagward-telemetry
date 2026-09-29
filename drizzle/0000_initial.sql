CREATE TABLE "heartbeats" (
	"installation_id" uuid NOT NULL,
	"day" date NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "heartbeats_installation_id_day_pk" PRIMARY KEY("installation_id","day")
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"first_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"days_seen" integer DEFAULT 1 NOT NULL,
	"latest" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heartbeats_day_idx" ON "heartbeats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "installations_last_received_idx" ON "installations" USING btree ("last_received_at");