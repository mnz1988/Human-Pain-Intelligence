CREATE TABLE "contribution_content" (
	"contribution_id" uuid PRIMARY KEY NOT NULL,
	"raw_text" text,
	"sanitized_text" text,
	"raw_storage_class" varchar(30) DEFAULT 'restricted',
	"pii_processed" boolean DEFAULT false,
	"privacy_risk_score" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"normalized_value" text NOT NULL,
	"confidence" numeric(5, 4),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"source_type" varchar(30) DEFAULT 'user_submission' NOT NULL,
	"source_record_id" uuid,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"language" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "problem_cluster_members" (
	"cluster_id" uuid,
	"contribution_id" uuid,
	"membership_confidence" numeric(5, 4),
	CONSTRAINT "problem_cluster_members_cluster_id_contribution_id_pk" PRIMARY KEY("cluster_id","contribution_id")
);
--> statement-breakpoint
CREATE TABLE "problem_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"primary_category" varchar(100),
	"secondary_category" varchar(100),
	"urgency" varchar(20),
	"perspective" varchar(20),
	"geographic_scope" varchar(200),
	"tags" text[],
	"status" varchar(30) DEFAULT 'emerging' NOT NULL,
	"confidence_score" numeric(5, 2) DEFAULT '0',
	"demand_score" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_type" varchar(30) NOT NULL,
	"credential_reference" text NOT NULL,
	"encrypted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_alias" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"reputation_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_public_alias_unique" UNIQUE("public_alias")
);
--> statement-breakpoint
ALTER TABLE "contribution_content" ADD CONSTRAINT "contribution_content_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_entities" ADD CONSTRAINT "contribution_entities_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_cluster_members" ADD CONSTRAINT "problem_cluster_members_cluster_id_problem_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."problem_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_cluster_members" ADD CONSTRAINT "problem_cluster_members_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;