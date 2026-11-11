# Updating

Pull the latest code and rebuild the container. Your data (database and uploads) lives in Docker volumes and is kept.

```bash
cd trek
git pull origin main
docker compose up -d --build trek
```

Database migrations run automatically when the server starts.

## Android app

When a release changes the native parts (GPS tracking, camera…), rebuild the Android app as well:

```bash
cd client
npm install
npm run cap:sync
npx cap open android
```

Build and install the APK from Android Studio.

## Backups

Before a big update, download a backup from **Admin → Backup** (or rely on the automatic backups if you enabled them).
