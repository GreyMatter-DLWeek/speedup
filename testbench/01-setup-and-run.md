# 01 - Setup and Run

## 1) Clone and install
```bash
git clone <repo-url>
cd DLWeekNTU
npm install
```

## 2) Configure backend env
Create `.env` from `.env.example` and set:

```env
PORT=3000
ALLOWED_ORIGINS=http://localhost:3000,https://greymatter-dlweek.github.io

OPENAI_API_KEY=<your-openai-api-key>
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1

FIREBASE_PROJECT_ID=dlweek-ac284
FIREBASE_CLIENT_EMAIL=<service-account-client-email>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

FIREBASE_RAG_COLLECTION=speedup_rag_notes

CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>
ENABLE_FILE_STORAGE=true
```

Notes:
- `FIREBASE_PRIVATE_KEY` must be a single value with escaped `\n` newlines.
- Do not use `FIREBASE_SERVICE_ACCOUNT_JSON` unless intentionally testing legacy fallback.

## 3) Configure frontend Firebase client
Edit `frontend/public/config/firebase-config.js` with your Firebase web app values:
- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

## 4) Run app
```bash
npm start
```
Open:
- app: `http://localhost:3000`
- health: `http://localhost:3000/api/health`

Expected health flags:
- `ok: true`
- `services.firebaseConfigured: true`
- `services.openaiConfigured: true`

## 5) Auth consistency check
After login, run in browser DevTools:
```js
const token = await window.firebaseAuthClient.getIdToken(true);
const claims = JSON.parse(atob(token.split(".")[1]));
console.log({ aud: claims.aud, iss: claims.iss });
```
Expected:
- `aud` equals Firebase project id
- `iss` includes `securetoken.google.com/<project-id>`

## 6) Reset baseline (optional)
Use a new test account or clear user state by deleting the user document in Firestore before a clean test cycle.
