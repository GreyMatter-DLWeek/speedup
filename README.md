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

## GitHub Pages Hosting (Frontend)
This repo can auto-deploy static frontend to GitHub Pages via:
- [deploy-pages.yml](/d:/SIT_Y1T2_RootFolder/DLWeekNTU/.github/workflows/deploy-pages.yml)

Important:
- GitHub Pages hosts frontend only (no Node/Express backend).
- Your backend must be deployed separately (Render/Railway/Fly/VM).

Set backend URL for Pages:
1. Open [site-config.js](/d:/SIT_Y1T2_RootFolder/DLWeekNTU/site-config.js)
2. Set:
   - `window.SPEEDUP_API_BASE = "https://<your-backend-domain>";`
3. Commit + push to `main`.

Then enable in GitHub:
1. `Repo -> Settings -> Pages`
2. Source: `GitHub Actions`
3. Push to `main` and wait for workflow completion.

## Deploy Backend on Render
This repo includes Render Blueprint config:
- [render.yaml](/d:/SIT_Y1T2_RootFolder/DLWeekNTU/render.yaml)

Steps:
1. Go to Render Dashboard -> `New` -> `Blueprint`.
2. Connect this GitHub repo and deploy.
3. In Render service `Environment`, fill secret values:
   - `OPENAI_API_KEY`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
4. Keep non-secret env defaults from `render.yaml` (or copy from [.env.example](/d:/SIT_Y1T2_RootFolder/DLWeekNTU/.env.example)).
5. After deploy, copy backend URL:
   - Example: `https://speedup-api.onrender.com`
6. Update [site-config.js](/d:/SIT_Y1T2_RootFolder/DLWeekNTU/site-config.js):
   - Set `window.SPEEDUP_API_BASE = "https://<your-render-url>";`
7. Commit + push `main` so GitHub Pages frontend calls Render backend.

Quick health check:
- Open `https://<your-render-url>/api/health` and verify `ok: true`.

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
