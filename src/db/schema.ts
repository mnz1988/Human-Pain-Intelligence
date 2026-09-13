import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  doublePrecision,
  timestamp,
  text,
  boolean,
} from "drizzle-orm/pg-core";

// 9.1 users — pseudonymous account, never exposes real identity
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicAlias: varchar("public_alias", { length: 32 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  reputationScore: numeric("reputation_score", { precision: 10, scale: 4 })
    .notNull()
    .default("0"),
  level: integer("level").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 9.2 user_credentials — recovery secret only; never store the plaintext, only a hash
export const userCredentials = pgTable("user_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  credentialType: varchar("credential_type", { length: 30 }).notNull(),
  credentialReference: text("credential_reference").notNull(),
  encrypted: boolean("encrypted").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 9.3 contributions — the submission envelope; status drives the async pipeline
export const contributions = pgTable("contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  sourceType: varchar("source_type", { length: 30 }).notNull().default("user_submission"),
  sourceRecordId: uuid("source_record_id"),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  language: varchar("language", { length: 20 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});

// 9.4 contribution_content — raw text is restricted; sanitized_text is the public/dataset layer
export const contributionContent = pgTable("contribution_content", {
  contributionId: uuid("contribution_id")
    .primaryKey()
    .references(() => contributions.id),
  rawText: text("raw_text"),
  sanitizedText: text("sanitized_text"),
  rawStorageClass: varchar("raw_storage_class", { length: 30 }).default("restricted"),
  piiProcessed: boolean("pii_processed").default(false),
  privacyRiskScore: numeric("privacy_risk_score", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 9.5 contribution_entities — normalized entities pulled out during extraction
export const contributionEntities = pgTable("contribution_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").references(() => contributions.id),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  normalizedValue: text("normalized_value").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 9.8 problem_clusters — starts as a single-contribution cluster; real clustering merges these later
export const problemClusters = pgTable("problem_clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  summary: text("summary"),
  primaryCategory: varchar("primary_category", { length: 100 }),
  secondaryCategory: varchar("secondary_category", { length: 100 }),
  urgency: varchar("urgency", { length: 20 }), // low | medium | high
  perspective: varchar("perspective", { length: 20 }), // personal | secondhand | unclear
  geographicScope: varchar("geographic_scope", { length: 200 }), // country/region-level only, from text
  tags: text("tags").array(), // short topic tags, e.g. ["public_transport", "safety"]
  embedding: doublePrecision("embedding").array(), // centroid embedding for similarity-based clustering
  memberCount: integer("member_count").notNull().default(1),
  status: varchar("status", { length: 30 }).notNull().default("emerging"),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }).default("0"),
  demandScore: numeric("demand_score", { precision: 5, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 9.9 problem_cluster_members
export const problemClusterMembers = pgTable("problem_cluster_members", {
  contributionId: uuid("contribution_id")
    .primaryKey()
    .references(() => contributions.id),
  clusterId: uuid("cluster_id").references(() => problemClusters.id),
  membershipConfidence: numeric("membership_confidence", { precision: 5, scale: 4 }),
});
