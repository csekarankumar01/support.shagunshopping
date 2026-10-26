-- Temporary rule for Step 3 auth. Step 4 replaces it with UNIQUE (org_id, email).
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
