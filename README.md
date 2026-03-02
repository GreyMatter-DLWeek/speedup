# SpeedUp — Adaptive AI Learning Intelligence Platform

## Executive Summary
SpeedUp is an AI-powered educational platform that models a student’s evolving learning state and converts interaction data into actionable, explainable study guidance.  
The product is designed for sustained educational use over weeks and months, not a one-time prediction demo.

The implementation combines authenticated per-user state, context-grounded AI generation, and responsible AI controls to improve trust, clarity, and practical decision-making for students.

## Problem Context
Students generate large volumes of digital learning signals (attempts, scores, timestamps, topic progression), but still lack clear answers to high-impact questions:
- Which weaknesses are conceptual versus careless?
- Is performance improving, stagnating, or regressing?
- What should be prioritized under limited study time?
- Why are mistakes repeating despite revision?

Learning behavior is non-linear. Students show inactivity gaps, bursts of revision, and changing mastery profiles. A practical solution must adapt over time while remaining transparent to the user.

## Solution Overview
SpeedUp implements a full adaptive loop:
1. Student authenticates securely.
2. Student uploads practice material (PDF/DOCX/PPTX/TXT or pasted text).
3. AI extracts and analyzes learning signals from that context.
4. Student selects a specific uploaded source to generate:
- Quiz (difficulty, count, type configurable)
- Flashcards (exact count configurable)
5. Student uses AI Tutor with `Clear` / `Still confused` loop.
6. State persists per user for longitudinal personalization.

## Architecture
### Frontend
- Static web app using HTML/CSS/JavaScript.
- Modular feature-based structure under `frontend/public/src`.
- Hosted on GitHub Pages (deployment branch: `hosting`).

### Backend
- Node.js + Express API.
- Handles auth verification, AI orchestration, parsing, persistence integration.
- Hosted on Render.

### Identity and Data
- Firebase Authentication (Email/Password).
- Firestore-backed user state persistence.

### File Storage
- Cloudinary for uploaded practice files.

### AI Integration
- OpenAI API for:
- Tutor explanations and simplification loops
- Recommendations
- Practice analysis
- Quiz generation
- Flashcard generation

## AI Pattern Justification
### 1. Human-in-the-loop clarification loop
Tutor supports explicit comprehension feedback (`Clear` / `Still confused`) and re-generates simplified responses accordingly.  
Why: preserves human agency and improves explainability.

### 2. Context-grounded generation
Quiz and flashcards are generated from selected uploaded context, not generic prompts.  
Why: improves relevance and reduces off-topic responses.

### 3. Reliability via fallback behavior
When model outputs are unavailable or malformed, deterministic fallback paths keep the app functional.  
Why: improves consistency and production resilience.

### 4. Longitudinal personalization
User-scoped persisted state enables adaptation over time instead of stateless interactions.  
Why: aligns with real educational usage patterns.

## Responsible AI Considerations
- Explainability: AI outputs are framed with rationale structure.
- User control: retry, simplify, and regenerate interactions are explicit.
- Reliability: guarded routes, structured outputs, fallback behavior.
- Privacy: per-user auth and scoped storage.
- Data minimization: store only necessary user learning artifacts.
- Fairness posture: recommendations rely on behavior signals, not demographic profiling.

## Core Features
### AI Tutor
- Conversation history persistence.
- Clarification loop with multi-attempt simplification.
- Natural greeting handling and context-aware responses.

### Practice Studio
- Upload + analyze academic practice content.
- Supported file types: PDF, DOCX, PPTX, TXT, pasted text.
- Source selector for quiz/flashcard grounding.
- Quiz controls: difficulty, question count, question type.
- Flashcard controls: exact card count.

### Learning-State Persistence
- Per-user profile and learning artifacts persisted across sessions.

## File Structure
```text
DLWeekNTU/
├─ backend/
│  ├─ server.js
│  └─ firebase/
│     ├─ firebaseAdmin.js
│     ├─ firebaseAuth.js
│     └─ firebaseStore.js
├─ frontend/
│  └─ public/
│     ├─ index.html
│     ├─ login.html
│     ├─ signup.html
│     ├─ app.js
│     ├─ styles.css
│     ├─ auth/
│     │  ├─ auth-pages.js
│     │  └─ firebase-auth-client.js
│     ├─ config/
│     │  ├─ firebase-config.js
│     │  └─ site-config.js
│     └─ src/
│        ├─ layout/
│        │  ├─ base.css
│        │  ├─ load-app.js
│        │  ├─ modals.html
│        │  └─ sidebar.html
│        ├─ pages/
│        │  ├─ dashboard.html
│        │  ├─ notes.html
│        │  ├─ study-notes.html
│        │  ├─ tutor.html
│        │  ├─ practice.html
│        │  ├─ timetable.html
│        │  ├─ progress.html
│        │  ├─ recommendations.html
│        │  └─ responsible.html
│        └─ feature-modules/
│           ├─ feature1.js
│           ├─ feature2.js
│           ├─ feature3.js
│           ├─ feature4.js
│           ├─ feature5.js
│           ├─ feature6.js
│           ├─ feature7.js
│           └─ feature8.js
├─ .github/
│  └─ workflows/
│     └─ deploy-pages.yml
├─ render.yaml
├─ server.js
├─ package.json
├─ package-lock.json
└─ README.md
```

## Local Setup
### 1) Install
```bash
npm install
```

### 2) Configure environment
Create `.env` from `.env.example` and set:
- `OPENAI_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (single-line string with `\n` escaped newlines)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `ALLOWED_ORIGINS`

Do not use `FIREBASE_SERVICE_ACCOUNT_JSON` unless you intentionally need legacy fallback mode.

### 3) Configure frontend Firebase web config
Edit `frontend/public/config/firebase-config.js`:
- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

Enable Email/Password in Firebase Auth console.

### 4) Run locally
```bash
npm start
```
Open `http://localhost:3000`.

### 5) Validate auth wiring
Health check:
```bash
curl http://localhost:3000/api/health
```
Expected: `firebaseConfigured: true`

Browser token check (DevTools console after login):
```js
const token = await window.firebaseAuthClient.getIdToken(true);
const claims = JSON.parse(atob(token.split(".")[1]));
console.log({ aud: claims.aud, iss: claims.iss });
```
Expected:
- `aud` equals your Firebase project id (for this project: `dlweek-ac284`)
- `iss` contains `securetoken.google.com/<project-id>`

## Deployment
### Frontend (GitHub Pages)
- Workflow: `.github/workflows/deploy-pages.yml`
- Branch trigger: `hosting`
- Source in GitHub Pages settings: `GitHub Actions`

### Backend (Render)
- Blueprint: `render.yaml`
- Set required secrets in Render environment.
- Verify: `https://<your-render-url>/api/health`

## API Surface (Primary)
- `GET /api/health`
- `GET /api/user/state` (auth)
- `PUT /api/user/state` (auth)
- `POST /api/explain`
- `POST /api/highlight/analyze`
- `POST /api/practice/analyze`
- `POST /api/practice/generate-quiz`
- `POST /api/practice/generate-flashcards`
- `POST /api/recommendations`
- `POST /api/rag/query`
- `POST /api/rag/index-note`

## Current Limitations
- Output quality depends on uploaded source quality.
- Free-tier hosting can introduce cold-start latency.
- Retrieval ranking can be improved further.
- Formal psychometric calibration is not yet implemented.

## Recommended Next Additions
### Engineering
- Add API contract tests and parser regression tests.
- Add telemetry for quality, latency, and user-action outcomes.
- Add prompt/output quality evaluator layer.

### AI Extensions (beyond LLM-only)
- Knowledge tracing (`BKT` / `DKT`) for mastery forecasting.
- IRT-based adaptive question selection.
- Speech AI for oral explanation practice.
- Vision AI for handwritten/diagram analysis.
- RAG reranker for improved context relevance.
- Evaluator model for generated quiz/flashcard quality control.
