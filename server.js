require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(__dirname)));

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  },
  azureSearch: {
    endpoint: process.env.AZURE_SEARCH_ENDPOINT || "",
    key: process.env.AZURE_SEARCH_API_KEY || "",
    indexName: process.env.AZURE_SEARCH_INDEX_NAME || "speedup-notes-index",
    idField: process.env.AZURE_SEARCH_ID_FIELD || "id",
    titleField: process.env.AZURE_SEARCH_TITLE_FIELD || "title",
    contentField: process.env.AZURE_SEARCH_CONTENT_FIELD || "content",
    sourceField: process.env.AZURE_SEARCH_SOURCE_FIELD || "source"
  },
  storage: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || "",
    container: process.env.AZURE_STORAGE_CONTAINER || "speedup-students"
  }
};

const blobClient = createBlobClient();

app.get("/api/health", async (req, res) => {
  res.json({
    ok: true,
    services: {
      openaiConfigured: Boolean(config.openai.apiKey && config.openai.model),
      searchConfigured: Boolean(config.azureSearch.endpoint && config.azureSearch.key && config.azureSearch.indexName),
      blobConfigured: Boolean(blobClient)
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/api/state/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
    if (!blobClient) {
      return res.status(503).json({ error: "Azure Blob Storage is not configured." });
    }
    const blobName = `students/${studentId}.json`;
    const containerClient = blobClient.getContainerClient(config.storage.container);
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const exists = await blockBlobClient.exists();
    if (!exists) {
      return res.status(404).json({ error: "State not found." });
    }

    const download = await blockBlobClient.download();
    const data = await streamToString(download.readableStreamBody);
    res.json(JSON.parse(data));
  } catch (error) {
    handleError(res, "Failed to load student state", error);
  }
});

app.put("/api/state/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
    const state = req.body;
    if (!state || typeof state !== "object") {
      return res.status(400).json({ error: "Invalid state payload." });
    }
    if (!blobClient) {
      return res.status(503).json({ error: "Azure Blob Storage is not configured." });
    }

    const containerClient = blobClient.getContainerClient(config.storage.container);
    await containerClient.createIfNotExists();
    const blobName = `students/${studentId}.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const payload = JSON.stringify(state, null, 2);
    await blockBlobClient.upload(payload, Buffer.byteLength(payload), {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });

    res.json({ ok: true, studentId, savedAt: new Date().toISOString() });
  } catch (error) {
    handleError(res, "Failed to save student state", error);
  }
});

app.post("/api/explain", async (req, res) => {
  try {
    const { paragraph, attempt = 0, feedback = "", topicHint = "" } = req.body || {};
    if (!paragraph || typeof paragraph !== "string") {
      return res.status(400).json({ error: "paragraph is required." });
    }

    const prompt = [
      "You are an educational AI tutor for university students.",
      "Return strict JSON with keys: concept, context, example, check, confidenceLabel.",
      "Explanations must be clear, concise, and actionable.",
      "If attempt > 0 or feedback says not clear, simplify using plain language and short sentences.",
      "Do not invent source citations."
    ].join(" ");

    const userContent = {
      paragraph,
      attempt,
      feedback,
      topicHint
    };

    const output = await callOpenAIChat([
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify(userContent) }
    ], 0.2);

    const parsed = safeParseJson(output);
    if (parsed) {
      return res.json({
        ...parsed,
        provider: "openai-api"
      });
    }

    res.json({
      concept: paragraph.split(".")[0] + ".",
      context: "This concept often appears in exam questions requiring both speed and accuracy.",
      example: "Practice one worked example, then solve one timed question without notes.",
      check: "Can you restate this rule in one sentence and apply it to a fresh question?",
      confidenceLabel: attempt > 0 ? `Simplified x${attempt + 1}` : "High Confidence",
      provider: "fallback"
    });
  } catch (error) {
    handleError(res, "Failed to generate explanation", error);
  }
});

app.post("/api/highlight/analyze", async (req, res) => {
  try {
    const { text, topic = "General" } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required." });
    }

    const prompt = [
      "You are an academic learning assistant.",
      "Return strict JSON with keys: summary, context, followUpQuestion.",
      "Summary max 25 words. Context max 35 words."
    ].join(" ");

    const output = await callOpenAIChat([
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify({ text, topic }) }
    ], 0.2);

    const parsed = safeParseJson(output);
    if (parsed) {
      return res.json({ ...parsed, provider: "openai-api" });
    }

    res.json({
      summary: text.split(" ").slice(0, 20).join(" ") + (text.split(" ").length > 20 ? "..." : ""),
      context: `Revisit ${topic} with one worked example and one timed check.`,
      followUpQuestion: "What common mistake should you avoid when applying this concept?",
      provider: "fallback"
    });
  } catch (error) {
    handleError(res, "Failed to analyze highlight", error);
  }
});

app.post("/api/rag/query", async (req, res) => {
  try {
    const { query, topK = 5 } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required." });
    }

    const hits = await searchDocuments(query, topK);
    res.json({ query, hits });
  } catch (error) {
    handleError(res, "Failed to query Azure AI Search", error);
  }
});

app.post("/api/rag/index-note", async (req, res) => {
  try {
    const { studentId = "default-student", title = "Untitled", text, source = "notes" } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required." });
    }

    if (!isSearchConfigured()) {
      return res.status(503).json({ error: "Azure AI Search is not configured." });
    }

    const docId = `${normalizeStudentId(studentId)}-${Date.now()}`;
    const searchDoc = {
      "@search.action": "upload",
      [config.azureSearch.idField]: docId,
      [config.azureSearch.titleField]: title,
      [config.azureSearch.contentField]: text,
      [config.azureSearch.sourceField]: source,
      studentId,
      createdAt: new Date().toISOString()
    };

    const endpoint = `${trimSlash(config.azureSearch.endpoint)}/indexes/${config.azureSearch.indexName}/docs/index?api-version=2024-07-01`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.azureSearch.key
      },
      body: JSON.stringify({ value: [searchDoc] })
    });

    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: payload?.error?.message || "Indexing failed.", details: payload });
    }

    res.json({ ok: true, docId, result: payload });
  } catch (error) {
    handleError(res, "Failed to index note", error);
  }
});

app.post("/api/recommendations", async (req, res) => {
  try {
    const learningState = req.body?.state;
    if (!learningState || typeof learningState !== "object") {
      return res.status(400).json({ error: "state is required." });
    }

    const weaknessQuery = (learningState.topics || [])
      .slice(0, 3)
      .map((t) => t.name)
      .join(" ") || "study skills";

    let sources = [];
    try {
      sources = await searchDocuments(weaknessQuery, 4);
    } catch {
      sources = [];
    }

    const system = [
      "You are an educational planning assistant.",
      "Return strict JSON with keys: recommendation, qualityCheck, why, nextActions.",
      "nextActions must be an array of exactly 3 actionable strings.",
      "why must cite concrete evidence from the provided student metrics and retrieved context."
    ].join(" ");

    const user = {
      learningState: {
        mastery: learningState.mastery || [],
        topics: learningState.topics || [],
        examHistory: learningState.examHistory || [],
        productiveSlot: learningState.student?.productiveSlot,
        weeklyHours: learningState.student?.weeklyHours
      },
      retrievedContext: sources.map((s) => ({ title: s.title, source: s.source, snippet: s.snippet }))
    };

    const raw = await callOpenAIChat([
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) }
    ], 0.2);

    const parsed = safeParseJson(raw);
    if (parsed && Array.isArray(parsed.nextActions)) {
      return res.json({ ...parsed, sources, provider: "openai-api-rag" });
    }

    res.json({
      recommendation: "Focus on your top weak concept with short feedback loops and one timed checkpoint daily.",
      qualityCheck: "Compare confidence with outcome after each session to calibrate study strategy.",
      why: "Generated from your recent exam trends and weak-topic risk levels.",
      nextActions: [
        "Do a 25-minute weak-topic drill with immediate correction.",
        "Attempt one timed mini quiz in your productive window.",
        "Log one reflection note on recurring mistakes."
      ],
      sources,
      provider: "fallback"
    });
  } catch (error) {
    handleError(res, "Failed to generate recommendations", error);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.resolve(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`SpeedUp server running on http://localhost:${port}`);
});

function createBlobClient() {
  const cs = String(config.storage.connectionString || "").trim();
  if (!cs || cs.startsWith("<") || cs.includes("your-storage-connection-string")) {
    return null;
  }
  try {
    return BlobServiceClient.fromConnectionString(cs);
  } catch (error) {
    console.warn("Blob storage disabled due to invalid connection string.");
    return null;
  }
}

async function streamToString(readableStream) {
  if (!readableStream) return "";
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(chunk.toString());
  }
  return chunks.join("");
}

function normalizeStudentId(value) {
  return String(value || "default-student")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-");
}

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function handleError(res, label, error) {
  console.error(label, error?.message || error);
  res.status(500).json({ error: label, details: error?.message || "Unknown error" });
}

function safeParseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callOpenAIChat(messages, temperature = 0.2) {
  if (!isOpenAIConfigured()) {
    throw new Error("OpenAI API is not configured.");
  }

  const endpoint = `${trimSlash(config.openai.baseUrl)}/chat/completions`;
  const requestBody = {
    model: config.openai.model,
    messages,
    temperature,
    max_tokens: 800,
    response_format: { type: "json_object" }
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let payload = await response.json();
  if (!response.ok && isTemperatureUnsupported(payload?.error?.message)) {
    delete requestBody.temperature;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  if (!response.ok) {
    const errMsg = payload?.error?.message || "OpenAI request failed.";
    // Fallback for responses-only models.
    if (errMsg.includes("supported in v1/responses")) {
      return callOpenAIResponses(messages, temperature);
    }
    // Fallback for legacy non-chat completion models.
    if (errMsg.includes("not a chat model")) {
      return callOpenAICompletions(messages, temperature);
    }
    throw new Error(errMsg);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response.");
  }
  return content;
}

async function callOpenAICompletions(messages, temperature = 0.2) {
  const endpoint = `${trimSlash(config.openai.baseUrl)}/completions`;
  const prompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  const requestBody = {
    model: config.openai.model,
    prompt,
    temperature,
    max_tokens: 800
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let payload = await response.json();
  if (!response.ok && isTemperatureUnsupported(payload?.error?.message)) {
    delete requestBody.temperature;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  if (!response.ok) {
    const errMsg = payload?.error?.message || "OpenAI completions request failed.";
    if (errMsg.includes("supported in v1/responses")) {
      return callOpenAIResponses(messages, temperature);
    }
    throw new Error(errMsg);
  }

  const text = payload?.choices?.[0]?.text;
  if (!text) {
    throw new Error("OpenAI completions returned empty response.");
  }
  return text;
}

async function callOpenAIResponses(messages, temperature = 0.2) {
  const endpoint = `${trimSlash(config.openai.baseUrl)}/responses`;
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text", text: String(m.content || "") }]
  }));

  const requestBody = {
    model: config.openai.model,
    input,
    temperature,
    text: { format: { type: "json_object" } }
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let payload = await response.json();
  if (!response.ok && isTemperatureUnsupported(payload?.error?.message)) {
    delete requestBody.temperature;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  // Some models may not support structured text format.
  if (!response.ok && /Unsupported parameter/i.test(payload?.error?.message || "") && /text\.format/i.test(payload?.error?.message || "")) {
    delete requestBody.text;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || "OpenAI responses request failed.");
  }

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const joined = (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!joined) {
    throw new Error("OpenAI responses returned empty output.");
  }
  return joined;
}

async function searchDocuments(query, topK = 5) {
  if (!isSearchConfigured()) {
    return [];
  }

  const endpoint = `${trimSlash(config.azureSearch.endpoint)}/indexes/${config.azureSearch.indexName}/docs/search?api-version=2024-07-01`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.azureSearch.key
    },
    body: JSON.stringify({
      search: query,
      top: Math.max(1, Math.min(10, Number(topK) || 5)),
      queryType: "simple"
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Azure AI Search request failed.");
  }

  return (payload?.value || []).map((doc) => ({
    id: doc[config.azureSearch.idField],
    title: doc[config.azureSearch.titleField] || "Untitled",
    snippet: snippet(doc[config.azureSearch.contentField] || ""),
    source: doc[config.azureSearch.sourceField] || "unknown"
  }));
}

function snippet(text) {
  const value = String(text || "").trim();
  if (value.length <= 260) return value;
  return value.slice(0, 257) + "...";
}

function isOpenAIConfigured() {
  return Boolean(config.openai.apiKey && config.openai.model);
}

function isSearchConfigured() {
  return Boolean(config.azureSearch.endpoint && config.azureSearch.key && config.azureSearch.indexName);
}

function isTemperatureUnsupported(message) {
  return /Unsupported parameter/i.test(String(message || "")) && /temperature/i.test(String(message || ""));
}
