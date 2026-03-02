# SpeedUp Dashboard (OpenAI + Firebase)

Production-style student learning dashboard with:
- Live AI explanations/recommendations (`OpenAI API`)
- Per-user auth (`Firebase Auth`)
- Per-user state + RAG note index (`Firestore`)
- Practice paper file storage (`Cloudinary`)

## Stack
- Frontend: `index.html`, `app.js`, `firebase-auth-client.js`
- Backend: `server.js` (Express)
- Data/Auth: Firebase Admin SDK + Firebase Web SDK

## 1) Install
```bash
npm install
```

## 2) Configure backend env
Create `.env` from `.env.example` and fill:
- `OPENAI_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON` (recommended), or split Firebase admin vars
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

## 3) Configure frontend Firebase web app
In [index.html](/d:/SIT_Y1T2_RootFolder/DLWeekNTU/index.html), fill:
- `window.FIREBASE_CLIENT_CONFIG.apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

Also enable Firebase Auth provider:
- Firebase Console -> Authentication -> Sign-in method -> `Email/Password` -> Enable

## 4) Start
```bash
npm start
```
Open `http://localhost:3000`.
You will be redirected to `/login.html` until authenticated.

## Main APIs
- `GET /api/health`
- `GET /api/user/profile` (auth)
- `PUT /api/user/profile` (auth)
- `GET /api/user/state` (auth)
- `PUT /api/user/state` (auth)
- `GET /api/user/bootstrap` (auth)
- `POST /api/user/event` (auth)
- `POST /api/user/exam` (auth)
- `POST /api/user/controls` (auth)
- `POST /api/explain`
- `POST /api/highlight/analyze`
- `POST /api/rag/index-note`
- `POST /api/rag/query`
- `POST /api/recommendations`
- `POST /api/practice/analyze` (multipart: `paper`, or `pastedText`)

## Notes
- Uploaded files are stored in Cloudinary under `speedup/practice-papers/<uid>/...`.
- API routes now include basic request throttling for AI-heavy endpoints.
- If Firebase/OpenAI is not configured, UI falls back partially to local state/demo behavior.
