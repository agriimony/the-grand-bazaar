create table if not exists items_1155 (
  token_id numeric(78,0) primary key,
  name text not null,
  symbol text,
  description text default '',
  image text not null,
  attributes jsonb default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_items_1155_updated_at on items_1155(updated_at desc);
