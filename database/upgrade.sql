BEGIN;
LOCK TABLE public.progress IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.class_progress (
  student_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL CHECK(class_id IN ('science','english','pre-algebra','history','bible')),
  day integer NOT NULL CHECK(day BETWEEN 1 AND 170),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  student_note text,
  tutor_status text NOT NULL DEFAULT 'pending' CHECK(tutor_status IN ('pending','verified','returned')),
  tutor_note text,
  verified_at timestamptz,
  PRIMARY KEY(student_id,class_id,day)
);
INSERT INTO public.class_progress
SELECT student_id,'science',day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at FROM public.progress;
-- Keep writes from the old deployment synchronized during the rollout.
CREATE FUNCTION public.sync_legacy_science() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  INSERT INTO public.class_progress(student_id,class_id,day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at)
  VALUES(NEW.student_id,'science',NEW.day,NEW.completed,NEW.completed_at,NEW.student_note,NEW.tutor_status,NEW.tutor_note,NEW.verified_at)
  ON CONFLICT(student_id,class_id,day) DO UPDATE SET
    completed=EXCLUDED.completed,completed_at=EXCLUDED.completed_at,student_note=EXCLUDED.student_note,
    tutor_status=EXCLUDED.tutor_status,tutor_note=EXCLUDED.tutor_note,verified_at=EXCLUDED.verified_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_legacy_science() FROM PUBLIC;
CREATE TRIGGER sync_legacy_science AFTER INSERT OR UPDATE ON public.progress FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_science();
-- This application uses its Express API and a private server Postgres connection.
-- No browser accesses the tables through Supabase's public Data API.
ALTER TABLE public.class_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_progress,public.progress,public.users,public.user_sessions FROM anon,authenticated;
DO $$ BEGIN
  IF EXISTS(
    SELECT student_id,day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at FROM public.progress
    EXCEPT SELECT student_id,day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at FROM public.class_progress WHERE class_id='science'
  ) THEN RAISE EXCEPTION 'Science migration failed'; END IF;
END $$;
COMMIT;
