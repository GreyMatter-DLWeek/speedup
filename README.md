# SpeedUp Dashboard (Cloud-Integrated)

SpeedUp is now a full-stack dashboard with:

- OpenAI API for live explanations/recommendations/generations
- Azure AI Search for RAG retrieval + note indexing
- Azure Blob Storage for persistent student state

## Architecture

- Frontend: `index.html` (reference template with embedded CSS), `app.js`
- Backend API: `server.js` (Express)
- Storage: Azure Blob (`/api/state/:studentId`)
- RAG: Azure AI Search (`/api/rag/query`, `/api/rag/index-note`)
- LLM: OpenAI API (`/api/explain`, `/api/highlight/analyze`, `/api/recommendations`)

## Files

- `index.html` UI (includes cloud health + RAG panel)
- `app.js` frontend logic and API integration
- `server.js` backend routes + OpenAI/Azure integrations
- `.env.example` environment template
- `package.json` dependencies/scripts

## Setup

1. Create `.env` from `.env.example` and fill required values.
2. Install dependencies:
   - Preferred: `npm install`
   - If `npm` is not available but Node is installed:
     - `"C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install`
3. Start app:
   - Preferred: `npm start`
   - Fallback (no npm): `node server.js`
4. Open:
   - `http://localhost:3000`

## Windows troubleshooting (`npm` not found / `npm.cmd` fails)

If Node works but `npm start` fails with an error like:
`Program 'npm.cmd' failed to run: The system cannot find the file specified`

Use one of these workarounds:

- Run directly with Node:
  - `node server.js`
- Or invoke npm CLI through Node:
  - `"C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" start`

Then fix your terminal/environment setup:

- Ensure Node is installed in `C:\Program Files\nodejs`
- Restart VS Code/terminal after installation
- Confirm PATH includes `C:\Program Files\nodejs`
- Verify `%ComSpec%` points to a valid `cmd.exe`

Once terminal setup is corrected, `npm install` and `npm start` should work normally.

## Required Resources

- OpenAI API key + model name
- Azure AI Search service + index
- Azure Storage Account (Blob) + connection string

## Azure AI Search index notes

Your index should include fields compatible with these env mappings:

- `id` (key)
- `title`
- `content`
- `source`

Adjust mappings with:

- `AZURE_SEARCH_ID_FIELD`
- `AZURE_SEARCH_TITLE_FIELD`
- `AZURE_SEARCH_CONTENT_FIELD`
- `AZURE_SEARCH_SOURCE_FIELD`

## API Endpoints

- `GET /api/health`
- `GET /api/state/:studentId`
- `PUT /api/state/:studentId`
- `POST /api/explain`
- `POST /api/highlight/analyze`
- `POST /api/rag/query`
- `POST /api/rag/index-note`
- `POST /api/recommendations`

## Notes

- If cloud configs are missing, frontend falls back to local behavior.
- Local persistence still uses `localStorage` as safety fallback.
- Production hardening (auth, rate limits, tenant isolation) should be added before deployment.
