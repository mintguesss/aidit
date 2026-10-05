-- 開課資料（承 0003）
--
-- 以前開課資料只放在 repo（src/lib/offerings/data/*.json），跟程式一起部署：
-- 每學期抓完都要 commit、push、等部署，repo 也每學期多七百班。
-- 搬進資料庫後，抓完用 scripts/push-offerings.ts 上傳，網站下次載入就生效。
--
-- 一學期一列（學校＋學年＋學期），整學期一起換：開課資料是一次抓完的快照，
-- 逐班更新會出現「一半是新的、一半是舊的」的狀態，而排課看不出來。
--
-- 開課資料是公開資訊，沒有個資。repo 裡的檔案仍然保留，給 CI 與離線環境用；
-- 同一學期兩邊都有時以資料庫為準。
create table offerings (
  school     text        not null,
  year       int         not null,
  term       int         not null check (term in (1, 2)),
  -- RawOffering 陣列（src/lib/offerings/raw.ts），與 repo 裡的 JSON 同一個格式
  rows       jsonb       not null,
  -- 這一份是從哪裡抓的，例如「輔大學生資訊平台課程查詢」
  source     text        not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (school, year, term)
);

alter table offerings enable row level security;
