# Quick Start

Trek Wanderer is built from this repository with Docker Compose — there is no prebuilt image to pull.

![Login page](assets/Login.png)

## Prerequisites

- Docker with the Compose plugin
- Git
- Port `3000` available (or change it in `docker-compose.yml`)

## Install

```bash
git clone https://github.com/MelAnubis/trek.git
cd trek
docker compose up -d --build trek
```

Then open `http://localhost:3000`. On first boot an admin account is created: set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `docker-compose.yml` beforehand, or read the generated password in the log:

```bash
docker compose logs trek | grep -i password
```

Your data lives in the Docker volumes declared in `docker-compose.yml`, so rebuilding the container keeps it.

## Next steps

- [Updating](Updating) — get the latest changes
- [Environment Variables](Environment-Variables) — configure your instance
- [Reverse Proxy](Reverse-Proxy) — serve it under your own domain with HTTPS
