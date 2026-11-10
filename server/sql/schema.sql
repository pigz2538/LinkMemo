CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  openid text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '微信用户',
  avatar_url text NOT NULL DEFAULT '',
  login_type text NOT NULL DEFAULT '微信登录',
  plan text NOT NULL DEFAULT '个人版',
  status text NOT NULL DEFAULT 'active',
  created_at bigint NOT NULL,
  last_login_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS user_categories (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2E9E5B',
  sort_order integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_categories_name
  ON user_categories (user_id, lower(name));

CREATE TABLE IF NOT EXISTS user_tags (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2E9E5B',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_tags_name
  ON user_tags (user_id, lower(name));

CREATE TABLE IF NOT EXISTS archive_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  content_type text NOT NULL,
  title text NOT NULL,
  url text NOT NULL DEFAULT '',
  domain text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  source_text text NOT NULL DEFAULT '',
  source_sender text NOT NULL DEFAULT '',
  source_time_label text NOT NULL DEFAULT '',
  source_message_at bigint,
  note text NOT NULL DEFAULT '',
  category_id uuid REFERENCES user_categories(id) ON DELETE SET NULL,
  tag_ids uuid[] NOT NULL DEFAULT '{}',
  saved_at bigint NOT NULL,
  title_initial text NOT NULL DEFAULT '#',
  title_bucket text NOT NULL DEFAULT '#',
  dedupe_key text NOT NULL,
  deleted_at bigint,
  fetched_at bigint,
  fetch_error text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_user_saved
  ON archive_items (user_id, saved_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_archive_user_deleted
  ON archive_items (user_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_archive_user_type_saved
  ON archive_items (user_id, content_type, saved_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_archive_user_title_bucket
  ON archive_items (user_id, title_bucket, saved_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_archive_user_sender
  ON archive_items (user_id, source_sender) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_archive_user_dedupe
  ON archive_items (user_id, dedupe_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_archive_tags
  ON archive_items USING gin (tag_ids);
CREATE INDEX IF NOT EXISTS idx_archive_title_trgm
  ON archive_items USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archive_summary_trgm
  ON archive_items USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archive_url_trgm
  ON archive_items USING gin (url gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archive_domain_trgm
  ON archive_items USING gin (domain gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archive_note_trgm
  ON archive_items USING gin (note gin_trgm_ops);

CREATE TABLE IF NOT EXISTS parse_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_length integer NOT NULL,
  total_count integer NOT NULL,
  message_count integer NOT NULL,
  success_count integer NOT NULL,
  duplicate_count integer NOT NULL,
  failed_count integer NOT NULL,
  allow_duplicates boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parse_batches_user_created
  ON parse_batches (user_id, created_at DESC);
