-- 偏好、規則包與校對紀錄（承 0001_traces.sql）
--
-- 這三類資料原本都落在 .data/ 底下的檔案，在 serverless 上等於不存在：
-- 專案目錄唯讀，/tmp 換實例就沒了。分別的後果：
--   偏好      使用者設定完、重新整理就不見，「刪除權」變成刪一個本來就會消失的東西
--   規則包    人工校對完的鎖版寫不進去，整條規則產生流程斷在最後一步
--   校對紀錄  「誰在什麼時候通過了哪一條」查不到，資料品質失去證據

-- ─────────────────────────────────────────────────────────── 偏好
--
-- 存在伺服器端是 SPEC-CHANGES.md E60 的決定：查閱／刪除／匯出是資料主體權利的
-- 形狀，而那些權利之所以存在，正是因為資料在別人手上。
--
-- 這裡不存任何可識別欄位。鍵是 HMAC(學號)，不可逆推。
-- required 內含 extraGoals（額外修業目標），兩者一起存、一起刪。
create table preferences (
  student_hash text        primary key check (student_hash ~ '^[0-9a-f]{32}$'),
  -- 規劃所需，少一項課表就排不出來或排錯
  required     jsonb       not null,
  -- 僅影響排序，少一項任何判定都不會變。分開存，「只刪選填」才是乾淨的動作
  optional     jsonb       not null default '{}'::jsonb,
  last_used_at timestamptz not null,
  -- 供自動刪除判定：graduated / leave 即刪
  status       text
);

-- 12 個月未使用即刪除，每日清理靠這個索引掃
create index preferences_last_used_at_idx on preferences (last_used_at);

-- ─────────────────────────────────────────────────── 規則包與原文語料
--
-- repo 裡的檔案仍是基準版本（golden set 與 CI 靠它離線跑）。
-- 這兩張表放的是**執行期發布**的版本 —— 也就是人工校對鎖版後產生的那些。
-- 讀取時兩邊合併，同 id 以資料庫版本為準。
create table rule_packs (
  id           text        primary key,
  version      text        not null,
  pack         jsonb       not null,
  -- 鎖版當下的校對人與時間，這是資料品質的證據
  locked_by    text        not null,
  locked_at    timestamptz not null
);

create table corpus_docs (
  -- 對應 rule pack 的 documents[].id，引用回查靠它
  doc_id       text        primary key,
  title        text        not null,
  published_at date,
  -- 原文全文。citation.verify 逐字比對，不得經過任何改寫
  body         text        not null,
  updated_at   timestamptz not null
);

-- ─────────────────────────────────────────────────────── 校對紀錄
--
-- 含校對人姓名或代號 —— 那是承辦人員的個資，不是學生的，但一樣要有管轄。
create table review_records (
  pack_id      text        primary key,
  record       jsonb       not null,
  updated_at   timestamptz not null
);

-- 上傳的原始規劃表。留檔案指紋是為了校對時對得上是哪一份。
create table rulepack_uploads (
  -- contentHash 前 12 碼
  receipt      text        primary key,
  filename     text        not null,
  bytes        integer     not null,
  uploaded_at  timestamptz not null
);

-- RLS 全開且不建 policy：anon 與 authenticated 一律讀不到、寫不進。
-- 應用程式用 service_role key，繞過 RLS，功能不受影響。
-- Supabase 的 anon key 設計上就是公開的，沒開 RLS 等於整張表對外開放。
alter table preferences      enable row level security;
alter table rule_packs       enable row level security;
alter table corpus_docs      enable row level security;
alter table review_records   enable row level security;
alter table rulepack_uploads enable row level security;
