-- New role values. Kept in their own migration: PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'recruit';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'veteran';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
