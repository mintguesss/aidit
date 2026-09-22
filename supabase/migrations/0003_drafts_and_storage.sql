-- 草稿與原始 PDF（承 0002）
--
-- 這兩項補完規則產生流程的最後兩個缺口：
--   草稿  由 scripts/extract-rulepack.ts 在本機產生，只落在 .data/drafts/，
--         所以線上的校對頁永遠是空的 —— 校對根本沒辦法在線上做。
--   PDF   上傳後只留在暫存區，serverless 上換實例就沒了。校對時要能調出
--         原始那一份對照，不然「這條規則是從哪來的」只剩下檔名。

-- ─────────────────────────────────────────────────────────── 草稿
--
-- corpus 跟草稿存在同一列，不拆表。理由：草稿的引用要能回查原文才有意義，
-- 兩者分開就可能出現「草稿在、語料不在」的半套狀態，而那會讓校對頁顯示
-- 一堆對不上原文的引用，看起來像抽取品質很差，其實只是資料沒到齊。
create table rulepack_drafts (
  pack_id    text        primary key,
  draft      jsonb       not null,
  -- { docId: 原文全文 }。citation.verify 逐字比對，不得經過任何改寫
  corpus     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null
);

alter table rulepack_drafts enable row level security;

-- ────────────────────────────────────────────────── 原始規劃表 PDF
--
-- 非公開 bucket：裡面是學校的規劃表原件，沒有理由對外開放。
-- 應用程式用 service_role key 存取，需要給人看時簽發短效連結。
insert into storage.buckets (id, name, public)
values ('rulepack-uploads', 'rulepack-uploads', false)
on conflict (id) do nothing;
