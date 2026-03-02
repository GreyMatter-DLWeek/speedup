# 03 - API Test Cases

Base URL (local): `http://localhost:3000`

Important: protected routes require `Authorization: Bearer <firebase-id-token>`.

## A-01: Health
```bash
curl http://localhost:3000/api/health
```
Expected: HTTP 200, `ok: true`

## A-02: Unauthorized access is blocked
```bash
curl http://localhost:3000/api/user/state
```
Expected: HTTP 401

## A-03: Authenticated user state
```bash
curl -H "Authorization: Bearer <ID_TOKEN>" http://localhost:3000/api/user/state
```
Expected: HTTP 200 with state object

## A-04: Explain
```bash
curl -X POST http://localhost:3000/api/explain \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"paragraph":"Spaced repetition improves retention.","attempt":0}'
```
Expected: concept/context/example/check payload

## A-05: Practice analyze (pasted text)
```bash
curl -X POST http://localhost:3000/api/practice/analyze \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -F "topic=Memory" \
  -F "pastedText=Spaced repetition and retrieval practice improve long-term retention."
```
Expected:
- `ok: true`
- `analysis` object present
- `sourceTextSnippet` present

## A-06: Generate quiz
```bash
curl -X POST http://localhost:3000/api/practice/generate-quiz \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"difficulty":"medium","numQuestions":4,"questionType":"mcq","sourceText":"Spaced repetition improves long-term memory through scheduled recall."}'
```
Expected:
- `ok: true`
- `quiz.questions.length === 4`

## A-07: Generate flashcards
```bash
curl -X POST http://localhost:3000/api/practice/generate-flashcards \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"count":3,"sourceText":"Retrieval practice requires recalling information without notes."}'
```
Expected:
- `ok: true`
- `flashcards.cards.length === 3`

## A-08: RAG index and query
Index:
```bash
curl -X POST http://localhost:3000/api/rag/index-note \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Memory Note","text":"Retrieval practice improves recall speed.","source":"notes"}'
```
Query:
```bash
curl -X POST http://localhost:3000/api/rag/query \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"recall speed","topK":3}'
```
Expected: relevant hit(s)

## A-09: Invalid token behavior
Use malformed token:
```bash
curl -H "Authorization: Bearer invalid.token.here" http://localhost:3000/api/user/state
```
Expected: HTTP 401

## A-10: Role isolation sanity
- Authenticate as User A, create notes/uploads.
- Authenticate as User B, query state.
Expected: User B cannot read A's state/artifacts.
