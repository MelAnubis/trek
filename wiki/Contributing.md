# Contributing

Thanks for your interest in contributing to TREK! Here are the guidelines for submitting pull requests.

## Before You Start

- **Ask in Discord first** — Before writing any code, pitch your idea in the `#github-pr` channel on our [Discord server](https://discord.gg/NhZBDSd4qW). We'll let you know if the PR is wanted and give direction. PRs without prior approval will be closed
- **Check existing issues** — Look for open issues or discussions before starting work
- **Target the `dev` branch** — All PRs must be opened against `dev`, not `main`
- **One thing per PR** — Keep PRs focused on a single change. Don't bundle unrelated fixes

## Pull Request Guidelines

### Code Quality

- Write clean, readable code that matches the existing style
- No unnecessary abstractions or over-engineering
- Don't add features beyond what was discussed in the issue
- Don't add comments unless the logic isn't self-evident
- Don't add error handling for scenarios that can't happen

### What We Look For

- **Does it solve the stated problem?** — The PR should match the issue it addresses
- **Is it minimal?** — No extra refactoring, no "while I'm here" changes
- **Does it break anything?** — Breaking changes are not acceptable
- **Is the code clean?** — Consistent style, no debug logs, no dead code

### Commit Messages

Use conventional commits:
```
fix(component): short description of what was fixed
feat(component): short description of new feature
```

### PR Description

Include:
1. **Summary** — What does this PR do? (1-3 bullet points)
2. **Test plan** — How was this tested?
3. **Related issue** — Link the issue (e.g. `Fixes #123`)

### What Will Get Your PR Closed

- PRs that weren't discussed and approved in `#github-pr` on Discord first
- PRs that add unnecessary complexity (e.g. a redo button when undo already exists)
- PRs with breaking changes
- PRs that change code style or formatting across unrelated files
- PRs that add dependencies without justification

## Development Setup

```bash
git clone https://github.com/mauriceboe/TREK.git
cd TREK

# Server
cd server
npm install
npm run dev

# Client (separate terminal)
cd client
npm install
npm run dev
```

- Server runs on `http://localhost:3001`
- Client runs on `http://localhost:5173` (with proxy to server)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Zustand, Leaflet, Tailwind CSS, Vite |
| Backend | Express, TypeScript, better-sqlite3 |
| Real-time | WebSocket (ws) |
| Database | SQLite with WAL mode |
| Auth | JWT (HS256), bcrypt, TOTP MFA, OIDC |
| Maps | Leaflet + react-leaflet, OSRM, Nominatim, CartoDB tiles |
| i18n | 13 languages (EN, DE, ES, FR, NL, IT, PT-BR, CS, PL, HU, RU, ZH, AR) |
