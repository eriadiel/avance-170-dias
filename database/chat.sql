-- Shared room accessed only through authenticated Express endpoints.
CREATE TABLE public.chat_messages (
 id serial PRIMARY KEY,
 author_id integer NOT NULL REFERENCES public.users(id),
 body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
 client_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(author_id,client_id)
);
CREATE INDEX chat_messages_author_created_idx ON public.chat_messages(author_id,created_at);
CREATE TABLE public.chat_reads (
 user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 last_message_id integer NOT NULL DEFAULT 0 CHECK(last_message_id>=0)
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_messages,public.chat_reads FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.chat_messages_id_seq FROM PUBLIC,anon,authenticated;
