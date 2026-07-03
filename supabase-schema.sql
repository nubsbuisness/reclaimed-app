-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  scan_balance integer not null default 3,
  plan text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Automatically create a profile row (with 3 free scans) whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, scan_balance, plan)
  values (new.id, new.email, 3, 'free');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
