-- Private image metadata and single-use capabilities for the Storage bridge.
CREATE TABLE public.chat_images (
 id uuid PRIMARY KEY,
 author_id integer NOT NULL REFERENCES public.users(id),
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),
 uploaded boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_images_author_created_idx ON public.chat_images(author_id,created_at);
CREATE TABLE public.chat_image_tickets (
 token_hash text PRIMARY KEY,
 image_id uuid NOT NULL REFERENCES public.chat_images(id) ON DELETE CASCADE,
 action text NOT NULL CHECK(action IN ('upload','read')),
 expires_at timestamptz NOT NULL
);
CREATE INDEX chat_image_tickets_expiry_idx ON public.chat_image_tickets(expires_at);
ALTER TABLE public.chat_messages ADD COLUMN image_id uuid UNIQUE REFERENCES public.chat_images(id);
ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_body_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_body_check
 CHECK(char_length(body)<=2000 AND (char_length(btrim(body))>0 OR image_id IS NOT NULL));
ALTER TABLE public.chat_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_image_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_images,public.chat_image_tickets FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE,DELETE ON public.chat_images TO service_role;
GRANT SELECT,DELETE ON public.chat_image_tickets TO service_role;
-- The bridge needs only message attachment references, never message text.
GRANT SELECT(image_id) ON public.chat_messages TO service_role;
