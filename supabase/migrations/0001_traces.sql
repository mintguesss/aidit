-- 執行紀錄（docs/BACKEND.md §6）
--
-- 欄位完全對應 src/lib/store/index.ts 的 SupabaseTraceStore，改任何一邊都要改另一邊。
-- 這裡只存去識別後的 trace。修課紀錄不落地（docs/SPEC.md §9），所以沒有對應的資料表，
-- 這是設計，不是還沒做。

create table traces (
  id                uuid        primary key,
  created_at        timestamptz not null,
  -- HMAC-SHA256(學號, AIDIT_TRACE_SECRET) 取前 32 字元，不可逆推
  student_hash      text        not null check (student_hash ~ '^[0-9a-f]{32}$'),
  rule_pack_id      text        not null,
  rule_pack_version text        not null,
  total_ms          integer     not null,
  status            text        not null check (status in ('ok', 'held', 'error')),
  llm_calls         integer     not null default 0,
  llm_cost_usd      numeric(10, 6) not null default 0,
  -- status = 'error' 時才有值
  abort_reason      text
);

-- 下面三張子表一律 on delete cascade。
-- 這不是可選的：purgeByStudent() 與 purgeExpired() 都只 delete traces 一張表，
-- 沒有 cascade 就會留下永遠刪不掉的孤兒列 —— 而那些列裡有工具調用的輸入輸出。
create table trace_steps (
  trace_id uuid    not null references traces(id) on delete cascade,
  idx      integer not null,
  name     text    not null,
  status   text    not null,
  summary  text    not null,
  ms       integer not null,
  retries  integer not null default 0,
  primary key (trace_id, idx)
);

create table tool_calls (
  trace_id    uuid    not null references traces(id) on delete cascade,
  step_idx    integer not null,
  seq         integer not null,
  name        text    not null,
  input_json  jsonb,
  output_json jsonb,
  ms          integer not null,
  status      text    not null,
  error       text,
  primary key (trace_id, step_idx, seq)
);

-- 被攔下來的外部內容。留存是為了證明攔截確實發生過，
-- 以及事後檢討誤攔（見 src/eval/injection/）。
create table blocked_content (
  id              bigserial   primary key,
  trace_id        uuid        not null references traces(id) on delete cascade,
  source_url      text        not null,
  excerpt         text        not null,
  pattern_matched text        not null,
  blocked_at      timestamptz not null
);

-- purgeByStudent()：資料主體的刪除權，以 student_hash 查
create index traces_student_hash_idx on traces (student_hash);
-- purgeExpired()：90 天保留政策，以 created_at 掃
create index traces_created_at_idx   on traces (created_at);

create index trace_steps_trace_idx      on trace_steps (trace_id);
create index tool_calls_trace_idx       on tool_calls (trace_id);
create index blocked_content_trace_idx  on blocked_content (trace_id);

-- RLS 全開、且不建任何 policy。
--
-- 這代表 anon 與 authenticated 一律讀不到、寫不進。應用程式用的是
-- service_role key，它繞過 RLS，所以功能不受影響。
-- 之所以要這樣做：Supabase 的 anon key 設計上就是公開的（會出現在前端），
-- 沒開 RLS 的資料表等於任何人拿 anon key 就能把整張 traces 撈走。
alter table traces          enable row level security;
alter table trace_steps     enable row level security;
alter table tool_calls      enable row level security;
alter table blocked_content enable row level security;
