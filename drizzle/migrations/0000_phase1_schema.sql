CREATE TYPE public.app_role AS ENUM ('admin','caller');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "roles read own or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'caller');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.lead_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.lead_batches(id) ON DELETE CASCADE,
  company text,
  contact_name text,
  phone text,
  email text,
  city text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  attempts int NOT NULL DEFAULT 0,
  last_called_at timestamptz,
  last_called_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_status_idx ON public.leads(status, last_called_at);
CREATE INDEX leads_batch_idx ON public.leads(batch_id);
CREATE TABLE public.lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.status_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid,
  old_status text,
  new_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid,
  due_at timestamptz NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  user_id uuid,
  starts_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_batches, public.leads, public.lead_notes, public.status_changes, public.callbacks, public.appointments TO authenticated;
GRANT ALL ON public.lead_batches, public.leads, public.lead_notes, public.status_changes, public.callbacks, public.appointments TO service_role;

ALTER TABLE public.lead_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Team tool: all signed-in callers share leads; deletes are admin-only.
CREATE POLICY "batches read" ON public.lead_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "batches insert" ON public.lead_batches FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "batches delete admin" ON public.lead_batches FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "leads read" ON public.leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "leads insert" ON public.leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "leads update" ON public.leads FOR UPDATE TO authenticated USING (true);
CREATE POLICY "leads delete admin" ON public.leads FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "notes read" ON public.lead_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes insert own" ON public.lead_notes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "sc read" ON public.status_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY "sc insert own" ON public.status_changes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "cb read" ON public.callbacks FOR SELECT TO authenticated USING (true);
CREATE POLICY "cb insert own" ON public.callbacks FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cb update" ON public.callbacks FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "ap insert own" ON public.appointments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ap update" ON public.appointments FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));