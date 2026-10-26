BEGIN;

CREATE TABLE organizations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    plan       TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'ENT')),
    sla_mins   INTEGER NOT NULL DEFAULT 480 CHECK (sla_mins > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
