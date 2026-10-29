-- Tambahan untuk menjalankan v1 di Supabase lokal (uji UI). Berbeda dari produksi pada satu hal:
-- handle_new_user TIDAK memakai whitelist email, agar akun uji bisa dibuat.
alter table public.profiles enable row level security;
alter table public.budgets enable row level security;
alter table public.contacts enable row level security;
alter table public.investment_lots enable row level security;
alter table public.trips enable row level security;
alter table public.trip_excluded_transactions enable row level security;
create table if not exists public.budget_plan (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  period_month smallint not null check (period_month between 1 and 12), period_year smallint not null,
  estimated_income numeric not null default 0, savings_allocations jsonb not null default '[]',
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (user_id, period_month, period_year));
create table if not exists public.credit_cards (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, bank text not null, card_limit numeric not null default 0, used_amount numeric not null default 0,
  billing_date int check (billing_date between 1 and 31), due_date int check (due_date between 1 and 31), color text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null, category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income','expense')), amount numeric not null, description text,
  frequency text not null check (frequency in ('daily','weekly','monthly','yearly')),
  day_of_month int check (day_of_month between 1 and 31), day_of_week int check (day_of_week between 0 and 6),
  next_due date not null, last_executed date, is_active boolean not null default true, auto_execute boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null, total_balance numeric not null default 0, total_assets numeric not null default 0,
  total_debt numeric not null default 0, net_worth numeric generated always as (total_balance + total_assets - total_debt) stored,
  created_at timestamptz default now(), unique (user_id, snapshot_date));
alter table public.budget_plan enable row level security;
alter table public.credit_cards enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.net_worth_snapshots enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users can view own budgets" on public.budgets for select using (auth.uid() = user_id);
create policy "Users can insert own budgets" on public.budgets for insert with check (auth.uid() = user_id);
create policy "Users can update own budgets" on public.budgets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own budgets" on public.budgets for delete using (auth.uid() = user_id);
create policy "Users can update own categories" on public.categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own non-default categories" on public.categories for delete using ((auth.uid() = user_id) and (is_default = false));
create policy "Users can view own cards" on public.credit_cards for select using (auth.uid() = user_id);
create policy "Users can insert own cards" on public.credit_cards for insert with check (auth.uid() = user_id);
create policy "Users can update own cards" on public.credit_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own cards" on public.credit_cards for delete using (auth.uid() = user_id);
create policy "Users can manage own budget_plan" on public.budget_plan for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own contacts" on public.contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own investment_lots" on public.investment_lots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own snapshots" on public.net_worth_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own recurring_transactions" on public.recurring_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users can manage own trips" on public.trips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own trip exclusions" on public.trip_excluded_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on all tables in schema public to authenticated, anon;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $f$
begin
  insert into public.profiles (id, full_name, role, trial_expires_at) values (NEW.id, coalesce(NEW.raw_user_meta_data->>'full_name', NEW.email), 'permanent', null);
  insert into public.wallets (user_id, name, type, balance, icon, color) values (NEW.id, 'Dompet Cash', 'cash', 0, '💵', '#22c55e');
  insert into public.categories (user_id, name, type, icon, color, is_default) values
  (NEW.id, 'Makanan & Minuman', 'expense', '🍔', '#ef4444', true), (NEW.id, 'Transportasi', 'expense', '🚗', '#f97316', true),
  (NEW.id, 'Belanja', 'expense', '🛒', '#eab308', true), (NEW.id, 'Tagihan & Utilitas', 'expense', '💡', '#3b82f6', true),
  (NEW.id, 'Hiburan', 'expense', '🎮', '#8b5cf6', true), (NEW.id, 'Kesehatan', 'expense', '🏥', '#ec4899', true),
  (NEW.id, 'Pendidikan', 'expense', '📚', '#06b6d4', true), (NEW.id, 'Lainnya', 'expense', '📦', '#6b7280', true),
  (NEW.id, 'Gaji', 'income', '💰', '#22c55e', true), (NEW.id, 'Freelance', 'income', '💻', '#10b981', true),
  (NEW.id, 'Investasi', 'income', '📈', '#14b8a6', true), (NEW.id, 'Hadiah', 'income', '🎁', '#f59e0b', true),
  (NEW.id, 'Lainnya', 'income', '📦', '#6b7280', true);
  return NEW;
end; $f$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
notify pgrst, 'reload schema';
