# Developer Setup Guide

Set up a local copy of Trek Wanderer to run and change it.

## 1. Clone

```bash
git clone https://github.com/MelAnubis/trek.git
cd trek
```

## 2. Install and run

```bash
cd server && npm install && npm run dev
```

In a second terminal:

```bash
cd client && npm install && npm run dev
```

The client runs on `http://localhost:5173` and talks to the server on port `3001`.

## 3. Tests

```bash
cd client && npm test
cd server && npm test
```

## 4. Contribute

Open a Pull Request against `main` of [MelAnubis/trek](https://github.com/MelAnubis/trek).
