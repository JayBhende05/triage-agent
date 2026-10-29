CREATE TABLE IF NOT EXISTS customers (
  id    integer PRIMARY KEY,
  name  text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS orders (
  id          integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  status      text NOT NULL,
  total_inr   numeric(10,2) NOT NULL CHECK (total_inr > 0)
);

CREATE TABLE IF NOT EXISTS tickets (
  id           serial PRIMARY KEY,
  from_email   text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN
                 ('new','running','awaiting_approval','resolved','escalated','rejected','failed')),
  category     text,
  final_action text,
  draft_reply  text
);

CREATE TABLE IF NOT EXISTS refunds (
  id              serial PRIMARY KEY,
  ticket_id       integer NOT NULL REFERENCES tickets(id),
  order_id        integer NOT NULL REFERENCES orders(id),
  amount_inr      numeric(10,2) NOT NULL CHECK (amount_inr > 0),
  idempotency_key text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS approvals (
  id        serial PRIMARY KEY,
  ticket_id integer NOT NULL UNIQUE REFERENCES tickets(id),
  proposal  jsonb NOT NULL,
  reasons   jsonb NOT NULL,
  status    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decision  jsonb
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         serial PRIMARY KEY,
  ticket_id  integer NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('llm','tool','decision')),
  name       text NOT NULL,
  input      jsonb,
  output     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
