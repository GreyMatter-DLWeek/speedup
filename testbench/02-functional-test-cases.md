# 02 - Functional Test Cases

## Test Account
- Create a fresh account using `signup.html`
- Use email/password auth

## F-01: Access control (no anonymous)
Steps:
1. Open `http://localhost:3000/index.html` in a new private window.
2. Do not log in.

Expected:
- redirected to `login.html`
- dashboard/layout not rendered before authentication

## F-02: Sign up and login
Steps:
1. Create account in `signup.html`.
2. Login in `login.html`.

Expected:
- redirected into app
- sidebar/profile loads
- authenticated API calls succeed

## F-03: Practice analysis from pasted text
Input: use `samples/practice-input.txt` text (copy paste)
Steps:
1. Go to Practice page.
2. Paste text and click Analyze.

Expected:
- analysis summary shown
- likely topics + weak signals present
- upload entry added to list

## F-04: Generate quiz from selected source
Steps:
1. On Practice page, select uploaded source.
2. Set difficulty `medium`, type `mcq`, count `5`.
3. Click Generate Quiz.

Expected:
- quiz appears with 5 questions
- each question has answer and explanation
- status shows success

## F-05: Generate flashcards from selected source
Steps:
1. Select source.
2. Set flashcard count `6`.
3. Click Generate Flashcards.

Expected:
- exactly 6 cards rendered
- each card has question + answer

## F-06: AI Tutor response quality baseline
Steps:
1. Open Tutor panel.
2. Ask: `Explain retrieval practice in simple steps`.

Expected:
- coherent response
- context-aware educational structure
- no crash/fallback unless service unavailable

## F-07: Explain and simplify loop
Steps:
1. In Active Reading, trigger explanation.
2. Click `Still confused`.

Expected:
- simplified follow-up response generated
- response remains actionable and concise

## F-08: Recommendations endpoint usage
Steps:
1. Perform at least one practice analysis and one quiz generation.
2. Trigger recommendation refresh.

Expected:
- recommendation card updates
- provider indicates model-backed or deterministic fallback

## F-09: Persistence across sessions
Steps:
1. Add activity (practice upload, highlight, tutor message).
2. Logout and login again.

Expected:
- user-scoped state restored
- prior artifacts visible for same account only

## F-10: RAG note indexing/query
Steps:
1. Index a note from highlight/notes context.
2. Run a related RAG query.

Expected:
- non-empty retrieval hits for matching terms
- no cross-user leakage
