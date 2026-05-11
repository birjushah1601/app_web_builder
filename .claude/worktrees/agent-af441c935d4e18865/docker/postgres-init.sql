-- Runs once on container bootstrap (via /docker-entrypoint-initdb.d/).
-- Bootstrap user is `postgres` (SUPERUSER); this script creates `atlas`
-- as a regular app role so that RLS FORCE actually enforces against it.

CREATE ROLE atlas WITH LOGIN PASSWORD 'atlas' NOSUPERUSER NOBYPASSRLS CREATEDB;

CREATE DATABASE atlas_dev OWNER atlas;
CREATE DATABASE atlas_test OWNER atlas;

GRANT ALL PRIVILEGES ON DATABASE atlas_dev TO atlas;
GRANT ALL PRIVILEGES ON DATABASE atlas_test TO atlas;
