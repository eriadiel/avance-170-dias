CREATE TABLE public.daily_progress(
 student_id integer NOT NULL REFERENCES public.users(id),
 day integer NOT NULL CHECK(day BETWEEN 1 AND 170),
 completed boolean NOT NULL DEFAULT false,
 completed_at timestamptz,
 tutor_status text NOT NULL DEFAULT 'pending' CHECK(tutor_status IN ('pending','verified','returned')),
 verified_at timestamptz,
 PRIMARY KEY(student_id,day)
);
ALTER TABLE public.daily_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_progress FROM PUBLIC,anon,authenticated;