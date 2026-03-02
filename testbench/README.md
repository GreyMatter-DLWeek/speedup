# SpeedUp Testbench

This folder contains a complete grader runbook for setup, execution, and verification.

## Contents
- `01-setup-and-run.md`: environment setup and local run instructions
- `02-functional-test-cases.md`: end-to-end feature tests with expected results
- `03-api-test-cases.md`: API-level checks (auth, AI routes, practice generation)
- `04-submission-checklist.md`: round-1 deliverable checklist
- `samples/practice-input.txt`: sample text for practice analysis and quiz/flashcard generation

## Scope
This testbench validates:
- authenticated-only app access
- Firebase-backed user state persistence
- OpenAI-backed tutor/explain/recommendation paths
- practice file/text analysis and quiz/flashcard generation
- RAG note indexing and retrieval

## Prerequisites
- Node.js 18+
- Firebase project with Email/Password auth enabled
- OpenAI API key
- Cloudinary account (optional for file URL storage, recommended)

Start with `01-setup-and-run.md`.
