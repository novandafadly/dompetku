-- Replika skema DompetKu v1 (project yvapmbjtuhqvsunkmkxw), direkonstruksi read-only
-- dari pg_catalog pada 2026-10-29. Hanya untuk reproduksi temuan audit di Postgres lokal.
-- auth.* adalah stub minimal yang meniru Supabase (auth.uid() membaca GUC).
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, avatar_url text, currency text default 'IDR',
  created_at timestamptz default now(), updated_at timestamptz default now(),
  role text not null default 'trial' check (role in ('permanent','trial','admin')),
  trial_expires_at timestamptz);
create table public.wallets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, type text not null check (type in ('cash','bank','ewallet','investment')),
  balance numeric default 0, icon text, color text, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  pocket text not null default 'operasional' check (pocket in ('operasional','tabungan','kantor')),
  currency text not null default 'IDR', exchange_rate numeric not null default 1 check (exchange_rate > 0));
create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null, type text not null check (type in ('income','expense')),
  icon text, color text, is_default boolean default false, created_at timestamptz default now(),
  parent_id uuid references public.categories(id) on delete set null);
create table public.contacts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, phone text, note text, avatar_color text default '#3b82f6', created_at timestamptz default now());
create table public.assets (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, type text not null check (type in ('investment','property','vehicle','electronics','other')),
  value numeric not null default 0, purchase_date date, description text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  ticker text, qty numeric default 0, avg_price numeric default 0, current_price numeric default 0, last_price_update timestamptz);
create table public.debts (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('debt','receivable')), person_name text not null,
  total_amount numeric not null check (total_amount > 0), paid_amount numeric not null default 0,
  description text, due_date date, is_completed boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  contact_id uuid references public.contacts(id) on delete set null,
  wallet_id uuid references public.wallets(id) on delete set null,
  is_capital_loan boolean not null default false,
  trading_wallet_id uuid references public.wallets(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null);
create table public.trips (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, emoji text default '✈️', start_date date, end_date date, notes text,
  created_at timestamptz default now(), destination text, budget numeric);
create table public.savings_goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete cascade,
  name text not null, target_amount numeric not null check (target_amount > 0), target_date date,
  icon text default '🎯', color text default '#22c55e', is_completed boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  current_amount numeric default 0, notes text, asset_id uuid references public.assets(id) on delete set null);
create table public.transactions (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income','expense')), amount numeric not null check (amount > 0),
  description text, date date not null default current_date, created_at timestamptz default now(),
  debt_id uuid references public.debts(id) on delete set null,
  is_reimbursable boolean not null default false, reimbursed_at timestamptz,
  trip_id uuid references public.trips(id) on delete set null,
  savings_goal_id uuid references public.savings_goals(id) on delete set null,
  subcategory_id uuid references public.categories(id) on delete set null);
create table public.transfers (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references auth.users(id) on delete cascade,
  from_wallet_id uuid references public.wallets(id) on delete cascade,
  to_wallet_id uuid references public.wallets(id) on delete cascade,
  amount numeric not null check (amount > 0), note text, date date not null default current_date,
  created_at timestamptz default now(), fee numeric default 0 check (fee is null or fee >= 0), description text,
  to_asset_id uuid references public.assets(id) on delete set null,
  savings_goal_id uuid references public.savings_goals(id) on delete set null,
  savings_type text check (savings_type in ('topup','withdraw')),
  from_asset_id uuid references public.assets(id) on delete set null,
  debt_id uuid references public.debts(id) on delete set null);
create table public.budgets (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric not null check (amount > 0), period_month int not null check (period_month between 1 and 12),
  period_year int not null, created_at timestamptz default now(), rollover_enabled boolean not null default false,
  unique (user_id, category_id, period_month, period_year));
create table public.investment_lots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  action text not null check (action in ('buy','sell')), qty numeric not null, price numeric not null,
  total_amount numeric generated always as (qty * price) stored, date date not null default current_date,
  note text, created_at timestamptz default now());
create table public.savings_goal_wallets (
  id uuid primary key default gen_random_uuid(),
  savings_goal_id uuid not null references public.savings_goals(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id), created_at timestamptz default now(),
  unique (savings_goal_id, wallet_id));
create table public.trip_excluded_transactions (
  trip_id uuid not null references public.trips(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(),
  primary key (trip_id, transaction_id));

-- ── Functions & triggers (verbatim dari pg_get_functiondef v1) ──
create or replace function public.prevent_direct_balance_update() returns trigger language plpgsql as $f$
begin
  if NEW.balance <> OLD.balance and current_setting('app.allow_balance_update', true) is distinct from 'true' then
    NEW.balance := OLD.balance;
  end if;
  return NEW;
end; $f$;
create trigger trg_prevent_direct_balance_update before update on public.wallets for each row execute function prevent_direct_balance_update();

create or replace function public.update_wallet_balance_on_transaction() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  perform set_config('app.allow_balance_update', 'true', true);
  if TG_OP = 'INSERT' then
    if NEW.type = 'income' then update wallets set balance = balance + NEW.amount where id = NEW.wallet_id;
    elsif NEW.type = 'expense' then update wallets set balance = balance - NEW.amount where id = NEW.wallet_id; end if;
  elsif TG_OP = 'DELETE' then
    if OLD.type = 'income' then update wallets set balance = balance - OLD.amount where id = OLD.wallet_id;
    elsif OLD.type = 'expense' then update wallets set balance = balance + OLD.amount where id = OLD.wallet_id; end if;
  end if;
  perform set_config('app.allow_balance_update', 'false', true);
  return coalesce(NEW, OLD);
end; $f$;
create trigger on_transaction_change after insert or delete on public.transactions for each row execute function update_wallet_balance_on_transaction();

create or replace function public.update_wallet_balance_on_transfer() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  perform set_config('app.allow_balance_update', 'true', true);
  if TG_OP = 'INSERT' then
    if NEW.from_wallet_id is not null then
      if not exists (select 1 from public.wallets where id = NEW.from_wallet_id and user_id = NEW.user_id) then raise exception 'Unauthorized: from_wallet does not belong to this user'; end if;
      update public.wallets set balance = balance - NEW.amount - coalesce(NEW.fee, 0) where id = NEW.from_wallet_id;
    elsif NEW.from_asset_id is not null then
      if not exists (select 1 from public.assets where id = NEW.from_asset_id and user_id = NEW.user_id) then raise exception 'Unauthorized: from_asset does not belong to this user'; end if;
      update public.assets set value = value - NEW.amount - coalesce(NEW.fee, 0) where id = NEW.from_asset_id;
    end if;
    if NEW.to_wallet_id is not null then
      if not exists (select 1 from public.wallets where id = NEW.to_wallet_id and user_id = NEW.user_id) then raise exception 'Unauthorized: to_wallet does not belong to this user'; end if;
      update public.wallets set balance = balance + NEW.amount where id = NEW.to_wallet_id;
    elsif NEW.to_asset_id is not null then
      if not exists (select 1 from public.assets where id = NEW.to_asset_id and user_id = NEW.user_id) then raise exception 'Unauthorized: to_asset does not belong to this user'; end if;
      update public.assets set value = value + NEW.amount where id = NEW.to_asset_id;
    end if;
  elsif TG_OP = 'DELETE' then
    if OLD.from_wallet_id is not null then update public.wallets set balance = balance + OLD.amount + coalesce(OLD.fee, 0) where id = OLD.from_wallet_id;
    elsif OLD.from_asset_id is not null then update public.assets set value = value + OLD.amount + coalesce(OLD.fee, 0) where id = OLD.from_asset_id; end if;
    if OLD.to_wallet_id is not null then update public.wallets set balance = balance - OLD.amount where id = OLD.to_wallet_id;
    elsif OLD.to_asset_id is not null then update public.assets set value = value - OLD.amount where id = OLD.to_asset_id; end if;
  end if;
  perform set_config('app.allow_balance_update', 'false', true);
  return coalesce(NEW, OLD);
end; $f$;
create trigger on_transfer_change after insert or delete on public.transfers for each row execute function update_wallet_balance_on_transfer();

create or replace function public.recalculate_asset_investment() returns trigger language plpgsql set search_path to 'public' as $f$
declare v_asset_id uuid; v_total_qty numeric; v_total_cost numeric; v_avg numeric;
begin
  if TG_OP = 'DELETE' then v_asset_id := OLD.asset_id; else v_asset_id := NEW.asset_id; end if;
  select coalesce(sum(case when action='buy' then qty else -qty end), 0), coalesce(sum(case when action='buy' then qty * price else 0 end), 0)
    into v_total_qty, v_total_cost from investment_lots where asset_id = v_asset_id;
  if v_total_qty > 0 then
    v_avg := v_total_cost / nullif((select sum(case when action='buy' then qty else 0 end) from investment_lots where asset_id = v_asset_id), 0);
  else v_avg := 0; end if;
  update assets set qty = greatest(v_total_qty, 0), avg_price = coalesce(v_avg, 0),
    value = greatest(v_total_qty, 0) * coalesce(nullif(current_price, 0), coalesce(v_avg, 0)), updated_at = now()
  where id = v_asset_id;
  return NEW;
end; $f$;
create trigger trg_recalc_investment after insert or delete or update on public.investment_lots for each row execute function recalculate_asset_investment();

create or replace function public.check_category_depth() returns trigger language plpgsql as $f$
begin
  if NEW.parent_id is not null then
    if exists (select 1 from categories where id = NEW.parent_id and parent_id is not null) then
      raise exception 'Subcategory tidak bisa punya sub-subcategory (max 2 level)';
    end if;
  end if;
  return NEW;
end; $f$;
create trigger trg_check_category_depth before insert or update on public.categories for each row execute function check_category_depth();

-- ── RLS (verbatim dari pg_policies v1; ringkas: tabel yang relevan untuk repro) ──
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.transfers enable row level security;
alter table public.assets enable row level security;
alter table public.debts enable row level security;
alter table public.categories enable row level security;
alter table public.savings_goals enable row level security;
alter table public.savings_goal_wallets enable row level security;
create policy "Users can view own wallets" on public.wallets for select using (auth.uid() = user_id);
create policy "Users can insert own wallets" on public.wallets for insert with check (auth.uid() = user_id);
create policy "Users can update own wallets" on public.wallets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own wallets" on public.wallets for delete using (auth.uid() = user_id);
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check ((auth.uid() = user_id) and ((wallet_id is null) or exists (select 1 from wallets where wallets.id = transactions.wallet_id and wallets.user_id = auth.uid())));
create policy "Users can update own transactions" on public.transactions for update using (auth.uid() = user_id) with check ((auth.uid() = user_id) and ((wallet_id is null) or exists (select 1 from wallets where wallets.id = transactions.wallet_id and wallets.user_id = auth.uid())));
create policy "Users can delete own transactions" on public.transactions for delete using (auth.uid() = user_id);
create policy "Users can view own transfers" on public.transfers for select using (auth.uid() = user_id);
create policy "Users can insert own transfers" on public.transfers for insert with check ((auth.uid() = user_id)
  and ((from_wallet_id is null) or exists (select 1 from wallets where wallets.id = transfers.from_wallet_id and wallets.user_id = auth.uid()))
  and ((to_wallet_id is null) or exists (select 1 from wallets where wallets.id = transfers.to_wallet_id and wallets.user_id = auth.uid()))
  and ((to_asset_id is null) or exists (select 1 from assets where assets.id = transfers.to_asset_id and assets.user_id = auth.uid())));
create policy "Users can update own transfers" on public.transfers for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own transfers" on public.transfers for delete using (auth.uid() = user_id);
create policy "Users can view own assets" on public.assets for select using (auth.uid() = user_id);
create policy "Users can insert own assets" on public.assets for insert with check (auth.uid() = user_id);
create policy "Users can update own assets" on public.assets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own assets" on public.assets for delete using (auth.uid() = user_id);
create policy "Users can view own debts" on public.debts for select using (auth.uid() = user_id);
create policy "Users can insert own debts" on public.debts for insert with check ((auth.uid() = user_id) and ((wallet_id is null) or exists (select 1 from wallets where wallets.id = debts.wallet_id and wallets.user_id = auth.uid())));
create policy "Users can update own debts" on public.debts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own debts" on public.debts for delete using (auth.uid() = user_id);
create policy "Users can view own categories" on public.categories for select using ((auth.uid() = user_id) or (user_id is null));
create policy "Users can insert own categories" on public.categories for insert with check (auth.uid() = user_id);
create policy "Users can manage own savings_goals" on public.savings_goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can view own savings_goal_wallets" on public.savings_goal_wallets for select using (auth.uid() = user_id);
create policy "Users can insert own savings_goal_wallets" on public.savings_goal_wallets for insert with check (auth.uid() = user_id);
create policy "Users can delete own savings_goal_wallets" on public.savings_goal_wallets for delete using (auth.uid() = user_id);

grant select, insert, update, delete on all tables in schema public to authenticated;
