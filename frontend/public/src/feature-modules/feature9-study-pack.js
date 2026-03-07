function makeId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function toSectionRef(index) {
  const chapter = Math.floor(index / 3) + 1;
  const part = (index % 3) + 1;
  return `${chapter}.${part}`;
}

function safeText(value, max = 4000) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function sentenceSnippet(text, words = 26) {
  const trimmed = safeText(text, 12000);
  if (!trimmed) return "";
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] || "";
  const source = firstSentence || trimmed;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length <= words) return source;
  return `${parts.slice(0, words).join(" ")}...`;
}

function normalizeTopicKey(value) {
  return safeText(value, 140)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((x) => x.length > 2)
    .slice(0, 5)
    .join(" ");
}

function renderQuizBlock(escapeHtml, quiz) {
  if (!quiz?.questions?.length) {
    return "<div class=\"study-pack-empty\">No generated checkpoint quiz yet. Click <strong>Generate checkpoint quiz</strong>.</div>";
  }

  return `
    <div class="study-pack-quiz-wrap">
      <div class="study-pack-mini-head">${escapeHtml(quiz.title || "Checkpoint Quiz")}</div>
      ${(quiz.questions || [])
        .slice(0, 4)
        .map((q, idx) => {
          const options = Array.isArray(q.options)
            ? `<ul>${q.options.map((opt) => `<li>${escapeHtml(opt)}</li>`).join("")}</ul>`
            : "";
          return `
            <div class="study-pack-quiz-q">
              <div><strong>Q${idx + 1}.</strong> ${escapeHtml(q.question || "")}</div>
              ${options}
              <div class="study-pack-quiz-a">Answer: ${escapeHtml(q.answer || "")}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function initFeature9StudyPack(ctx) {
  const { runtime, API, apiPostForm, apiPost, escapeHtml, logAudit, scheduleSave } = ctx;
  let initialized = false;

  function ensureHub() {
    if (!runtime.state.studyPackHub || typeof runtime.state.studyPackHub !== "object") {
      runtime.state.studyPackHub = {
        uploads: [],
        packs: [],
        activePackId: "",
        activeSectionId: "",
        notes: [],
        weaknessRecommendations: []
      };
    }
    const hub = runtime.state.studyPackHub;
    if (!Array.isArray(hub.uploads)) hub.uploads = [];
    if (!Array.isArray(hub.packs)) hub.packs = [];
    if (!Array.isArray(hub.notes)) hub.notes = [];
    if (!Array.isArray(hub.weaknessRecommendations)) hub.weaknessRecommendations = [];
    if (typeof hub.activePackId !== "string") hub.activePackId = "";
    if (typeof hub.activeSectionId !== "string") hub.activeSectionId = "";
    return hub;
  }

  function getPackById(packId, hub = ensureHub()) {
    return (hub.packs || []).find((pack) => pack.id === packId) || null;
  }

  function resolveActivePack(hub = ensureHub()) {
    const chosen = getPackById(hub.activePackId, hub);
    if (chosen) return chosen;
    if (!hub.packs.length) return null;
    hub.activePackId = hub.packs[0].id;
    return hub.packs[0];
  }

  function resolveActiveSection(pack, hub = ensureHub()) {
    if (!pack) return null;
    const direct = (pack.sections || []).find((section) => section.id === hub.activeSectionId);
    if (direct) return direct;
    if (!(pack.sections || []).length) return null;
    hub.activeSectionId = pack.sections[0].id;
    return pack.sections[0];
  }

  function buildSectionFromUpload(packId, uploadName, sectionRaw, index) {
    const ref = safeText(sectionRaw?.ref || toSectionRef(index), 30) || toSectionRef(index);
    const baseId = safeText(sectionRaw?.id || `s-${index + 1}`, 60) || `s-${index + 1}`;
    const sectionId = `${packId}-${toSlug(baseId || ref || String(index + 1))}-${index + 1}`;
    const title = safeText(sectionRaw?.title || `Section ${ref}`, 180) || `Section ${ref}`;
    const text = safeText(sectionRaw?.text || "", 20000);
    const summary = safeText(sectionRaw?.summary || sentenceSnippet(text, 24), 450);
    const checkpoints = Array.isArray(sectionRaw?.checkpoints) ? sectionRaw.checkpoints.slice(0, 3) : [];
    const anchorId = `study-pack-section-${toSlug(packId)}-${index + 1}`;

    return {
      id: sectionId,
      ref,
      title,
      text,
      summary,
      sourceName: uploadName,
      checkpoints,
      anchorId
    };
  }

  function computeWeaknessRecommendations(pack, hub = ensureHub()) {
    if (!pack) {
      hub.weaknessRecommendations = [];
      return [];
    }

    const uploads = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
    const scoredTopics = new Map();

    uploads.slice(0, 16).forEach((upload, idx) => {
      const weight = Math.max(1, 16 - idx);
      const analysis = upload?.analysis || {};
      const rawSignals = [
        ...(Array.isArray(analysis.likelyTopics) ? analysis.likelyTopics : []),
        ...(Array.isArray(analysis.weakSignals) ? analysis.weakSignals : [])
      ];

      rawSignals.forEach((raw) => {
        const key = normalizeTopicKey(raw);
        if (!key) return;
        const existing = scoredTopics.get(key) || {
          key,
          label: safeText(raw, 120) || key,
          count: 0,
          weight: 0
        };
        existing.count += 1;
        existing.weight += weight;
        if (existing.label.length < String(raw || "").length) {
          existing.label = safeText(raw, 120) || existing.label;
        }
        scoredTopics.set(key, existing);
      });
    });

    const rankedTopics = [...scoredTopics.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);

    const recommendations = rankedTopics
      .map((topic) => {
        const tokens = topic.key.split(" ").filter(Boolean);
        let best = null;

        (pack.sections || []).forEach((section) => {
          const hay = `${section.ref} ${section.title} ${section.summary} ${section.text}`.toLowerCase();
          let score = 0;
          tokens.forEach((token) => {
            if (token.length > 2 && hay.includes(token)) score += 2;
          });
          if (tokens.length >= 2 && hay.includes(tokens.join(" "))) score += 4;
          if (score <= 0) return;
          if (!best || score > best.score) {
            best = {
              score,
              sectionId: section.id,
              sectionRef: section.ref,
              sectionTitle: section.title,
              jumpRef: section.anchorId
            };
          }
        });

        if (!best) return null;
        return {
          topic: topic.label,
          count: topic.count,
          sectionId: best.sectionId,
          sectionRef: best.sectionRef,
          sectionTitle: best.sectionTitle,
          jumpRef: best.jumpRef,
          message: `You keep missing ${topic.label} → revise Section ${best.sectionRef}`
        };
      })
      .filter(Boolean)
      .slice(0, 3);

    hub.weaknessRecommendations = recommendations;
    return recommendations;
  }

  function renderUploadQueue(hub = ensureHub()) {
    const list = document.getElementById("studyPackUploadList");
    if (!list) return;

    if (!hub.uploads.length) {
      list.innerHTML = "<div class='study-pack-empty'>No uploaded PDFs yet. Upload one or more PDFs first.</div>";
      return;
    }

    list.innerHTML = hub.uploads
      .map((upload) => {
        const sectionCount = Array.isArray(upload.sections) ? upload.sections.length : 0;
        return `
          <div class="study-pack-upload-item">
            <div>
              <div class="study-pack-upload-title">${escapeHtml(upload.name || "PDF")}</div>
              <div class="study-pack-upload-meta">${escapeHtml(upload.uploadedAt || "")} · ${sectionCount} sections · ${Number(upload.textLength || 0)} chars</div>
            </div>
            <button class="btn btn-ghost" data-upload-remove="${escapeHtml(upload.id)}" style="padding:6px 10px;font-size:12px;">Remove</button>
          </div>
        `;
      })
      .join("");
  }

  function renderPackLibrary(hub = ensureHub()) {
    const list = document.getElementById("studyPackLibraryList");
    if (!list) return;

    if (!hub.packs.length) {
      list.innerHTML = "<div class='study-pack-empty'>Your Study Pack library is empty. Create your first pack from uploaded PDFs.</div>";
      return;
    }

    list.innerHTML = hub.packs
      .map((pack) => {
        const activeClass = pack.id === hub.activePackId ? "active" : "";
        return `
          <button class="study-pack-library-item ${activeClass}" data-pack-id="${escapeHtml(pack.id)}">
            <div class="study-pack-library-main">
              <div class="study-pack-library-title">${escapeHtml(pack.title || "Untitled Pack")}</div>
              <div class="study-pack-library-meta">${(pack.sections || []).length} sections · ${escapeHtml(pack.createdAt || "")}</div>
            </div>
            <span class="study-pack-library-pill">Open</span>
          </button>
        `;
      })
      .join("");
  }

  function renderWeaknessPanel(hub = ensureHub()) {
    const host = document.getElementById("studyPackWeaknessList");
    if (!host) return;

    const pack = resolveActivePack(hub);
    const recommendations = computeWeaknessRecommendations(pack, hub);
    if (!recommendations.length) {
      host.innerHTML = "<div class='study-pack-empty'>No weakness signals yet. Analyze practice papers to unlock targeted section recommendations.</div>";
      return;
    }

    host.innerHTML = recommendations
      .map(
        (rec) => `
          <div class="study-pack-weak-item">
            <div class="study-pack-weak-text">${escapeHtml(rec.message)}</div>
            <div class="study-pack-weak-sub">Suggested: ${escapeHtml(rec.sectionTitle)}</div>
            <button class="btn btn-secondary" data-weak-section="${escapeHtml(rec.sectionId)}" style="margin-top:8px;padding:6px 10px;font-size:12px;">Jump to section</button>
          </div>
        `
      )
      .join("");
  }

  function renderMyNotes(hub = ensureHub()) {
    const host = document.getElementById("studyPackMyNotesList");
    if (!host) return;

    if (!hub.notes.length) {
      host.innerHTML = "<div class='study-pack-empty'>No saved notes yet. Use <strong>Add to my notes</strong> from tutor answers.</div>";
      return;
    }

    host.innerHTML = hub.notes
      .slice(0, 14)
      .map(
        (row) => `
          <div class="study-pack-note-item">
            <div class="study-pack-note-meta">${escapeHtml(row.ts || "")} · ${escapeHtml(row.sectionLabel || "General")}</div>
            <div class="study-pack-note-text">${escapeHtml(row.text || "")}</div>
          </div>
        `
      )
      .join("");
  }

  function renderPackViewer(hub = ensureHub()) {
    const titleEl = document.getElementById("studyPackActiveTitle");
    const metaEl = document.getElementById("studyPackActiveMeta");
    const toc = document.getElementById("studyPackToc");
    const sectionTitleEl = document.getElementById("studyPackSectionTitle");
    const sectionMetaEl = document.getElementById("studyPackSectionMeta");
    const sectionBodyEl = document.getElementById("studyPackSectionBody");
    const checkpointEl = document.getElementById("studyPackCheckpointPanel");
    const cheatsheetEl = document.getElementById("studyPackCheatsheetOutput");
    const lectureEl = document.getElementById("studyPackTeachOutput");

    if (!titleEl || !metaEl || !toc || !sectionTitleEl || !sectionMetaEl || !sectionBodyEl || !checkpointEl || !cheatsheetEl || !lectureEl) {
      return;
    }

    const pack = resolveActivePack(hub);
    const section = resolveActiveSection(pack, hub);

    if (!pack) {
      titleEl.textContent = "Pack Viewer";
      metaEl.textContent = "Select or create a Study Pack to view TOC and sections.";
      toc.innerHTML = "<div class='study-pack-empty'>No TOC yet.</div>";
      sectionTitleEl.textContent = "No section selected";
      sectionMetaEl.textContent = "";
      sectionBodyEl.innerHTML = "<div class='study-pack-empty'>Upload PDFs, create a pack, then select a section from the TOC.</div>";
      checkpointEl.innerHTML = "<div class='study-pack-empty'>Checkpoint quiz will appear here.</div>";
      cheatsheetEl.innerHTML = "<div class='study-pack-empty'>Generate a cheatsheet from your current pack.</div>";
      lectureEl.innerHTML = "<div class='study-pack-empty'>Teach mode output will appear here.</div>";
      return;
    }

    titleEl.textContent = pack.title || "Study Pack";
    metaEl.textContent = `${(pack.sections || []).length} sections · ${escapeHtml(pack.createdAt || "")}`;

    toc.innerHTML = (pack.sections || [])
      .map((item) => {
        const active = item.id === hub.activeSectionId ? "active" : "";
        return `
          <button class="study-pack-toc-item ${active}" data-section-id="${escapeHtml(item.id)}">
            <span class="study-pack-toc-ref">Section ${escapeHtml(item.ref || "")}</span>
            <span class="study-pack-toc-title">${escapeHtml(item.title || "Untitled")}</span>
          </button>
        `;
      })
      .join("");

    if (!section) {
      sectionTitleEl.textContent = "No section selected";
      sectionMetaEl.textContent = "";
      sectionBodyEl.innerHTML = "<div class='study-pack-empty'>This pack has no sections.</div>";
      checkpointEl.innerHTML = "<div class='study-pack-empty'>No section selected.</div>";
      cheatsheetEl.innerHTML = "<div class='study-pack-empty'>No cheatsheet yet.</div>";
      lectureEl.innerHTML = "<div class='study-pack-empty'>No teach-mode output yet.</div>";
      return;
    }

    sectionTitleEl.textContent = `Section ${section.ref} · ${section.title}`;
    sectionMetaEl.textContent = `Source: ${section.sourceName || "PDF"}`;
    sectionBodyEl.innerHTML = `
      <article class="study-pack-section-article" id="${escapeHtml(section.anchorId)}">
        <div class="study-pack-section-summary">${escapeHtml(section.summary || "")}</div>
        <div class="study-pack-section-text">${escapeHtml(section.text || "").replace(/\n+/g, "<br><br>")}</div>
      </article>
    `;

    const quiz = pack.sectionQuizzes?.[section.id] || null;
    checkpointEl.innerHTML = renderQuizBlock(escapeHtml, quiz);

    const cheatsheet = safeText(pack.cheatsheet || "", 12000);
    cheatsheetEl.innerHTML = cheatsheet
      ? `<div class="study-pack-generated-text">${escapeHtml(cheatsheet).replace(/\n+/g, "<br><br>")}</div>`
      : "<div class='study-pack-empty'>No cheatsheet yet. Click <strong>Summarise cheatsheet</strong>.</div>";

    const lecture = safeText(pack.sectionLectures?.[section.id] || "", 12000);
    lectureEl.innerHTML = lecture
      ? `<div class="study-pack-generated-text">${escapeHtml(lecture).replace(/\n+/g, "<br><br>")}</div>`
      : "<div class='study-pack-empty'>No teach-mode output yet. Click <strong>Teach mode</strong>.</div>";
  }

  function renderAll() {
    const hub = ensureHub();
    renderUploadQueue(hub);
    renderPackLibrary(hub);
    renderPackViewer(hub);
    renderWeaknessPanel(hub);
    renderMyNotes(hub);
  }

  async function uploadPdfs() {
    const fileInput = document.getElementById("studyPackPdfInput");
    const status = document.getElementById("studyPackUploadStatus");
    const files = Array.from(fileInput?.files || []);
    if (!files.length) {
      if (status) status.textContent = "Select one or more PDF files first.";
      return;
    }

    if (status) status.textContent = `Uploading ${files.length} file(s)...`;
    const hub = ensureHub();
    let successCount = 0;

    for (const file of files) {
      const form = new FormData();
      form.append("pdf", file);
      try {
        const out = await apiPostForm(API.studyPackUploadPdf, form);
        hub.uploads.unshift({
          id: makeId("upload"),
          name: out?.file?.name || file.name,
          uploadedAt: new Date().toISOString().slice(0, 10),
          textLength: Number(out?.textLength || 0),
          sections: Array.isArray(out?.sections) ? out.sections : []
        });
        successCount += 1;
        if (status) status.textContent = `Parsed ${successCount}/${files.length}: ${file.name}`;
      } catch (error) {
        if (status) status.textContent = `Failed ${file.name}: ${error.message || "unknown error"}`;
      }
    }

    if (fileInput) fileInput.value = "";
    if (successCount > 0) {
      logAudit(`Study Pack upload parsed (${successCount} file${successCount > 1 ? "s" : ""}).`);
      scheduleSave();
    }
    if (status && successCount === files.length) {
      status.textContent = `Upload complete. Parsed ${successCount} file${successCount > 1 ? "s" : ""}.`;
    }

    renderAll();
  }

  function removeUpload(uploadId) {
    const hub = ensureHub();
    hub.uploads = (hub.uploads || []).filter((item) => item.id !== uploadId);
    scheduleSave();
    renderAll();
  }

  function clearUploadsQueue() {
    const hub = ensureHub();
    hub.uploads = [];
    scheduleSave();
    renderAll();
  }

  function createStudyPack() {
    const hub = ensureHub();
    const status = document.getElementById("studyPackCreateStatus");
    const titleInput = document.getElementById("studyPackTitleInput");
    const descInput = document.getElementById("studyPackDescInput");
    const title = safeText(titleInput?.value || "", 120);
    const description = safeText(descInput?.value || "", 400);

    if (!title) {
      if (status) status.textContent = "Give your Study Pack a title first.";
      return;
    }
    if (!hub.uploads.length) {
      if (status) status.textContent = "Upload at least one PDF before creating a pack.";
      return;
    }

    const packId = makeId("pack");
    let sectionIndex = 0;
    const sections = hub.uploads.flatMap((upload) => {
      const rows = Array.isArray(upload.sections) ? upload.sections : [];
      return rows.map((row) => {
        const section = buildSectionFromUpload(packId, upload.name, row, sectionIndex);
        sectionIndex += 1;
        return section;
      });
    });

    if (!sections.length) {
      if (status) status.textContent = "Could not extract sections from uploaded PDFs. Try another file.";
      return;
    }

    const pack = {
      id: packId,
      title,
      description,
      createdAt: new Date().toISOString().slice(0, 10),
      sourceFiles: hub.uploads.map((upload) => ({
        id: upload.id,
        name: upload.name,
        textLength: upload.textLength
      })),
      sections,
      sectionQuizzes: {},
      sectionLectures: {},
      cheatsheet: ""
    };

    hub.packs.unshift(pack);
    hub.activePackId = pack.id;
    hub.activeSectionId = sections[0].id;
    hub.uploads = [];

    scheduleSave();
    logAudit(`Study Pack created: ${title}`);

    if (titleInput) titleInput.value = "";
    if (descInput) descInput.value = "";
    if (status) status.textContent = `Study Pack created with ${sections.length} sections.`;

    renderAll();
  }

  function openLatestPack() {
    const hub = ensureHub();
    if (!hub.packs.length) return;
    hub.activePackId = hub.packs[0].id;
    hub.activeSectionId = hub.packs[0].sections?.[0]?.id || "";
    scheduleSave();
    renderAll();
  }

  function selectPack(packId) {
    const hub = ensureHub();
    const pack = getPackById(packId, hub);
    if (!pack) return;
    hub.activePackId = pack.id;
    hub.activeSectionId = pack.sections?.[0]?.id || "";
    scheduleSave();
    renderAll();
  }

  function selectSection(sectionId) {
    const hub = ensureHub();
    const pack = resolveActivePack(hub);
    if (!pack) return;
    const exists = (pack.sections || []).some((s) => s.id === sectionId);
    if (!exists) return;
    hub.activeSectionId = sectionId;
    scheduleSave();
    renderAll();
  }

  function focusSectionByAnchor(anchorId) {
    if (!anchorId) return false;
    const hub = ensureHub();
    let foundPack = null;
    let foundSection = null;

    (hub.packs || []).some((pack) => {
      const section = (pack.sections || []).find((row) => row.anchorId === anchorId);
      if (section) {
        foundPack = pack;
        foundSection = section;
        return true;
      }
      return false;
    });

    if (!foundPack || !foundSection) return false;

    hub.activePackId = foundPack.id;
    hub.activeSectionId = foundSection.id;
    scheduleSave();
    renderAll();

    const el = document.getElementById(anchorId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("study-pack-highlight-jump");
      setTimeout(() => el.classList.remove("study-pack-highlight-jump"), 1300);
      return true;
    }
    return false;
  }

  async function generateCheckpointQuiz() {
    const status = document.getElementById("studyPackTutorHint");
    const hub = ensureHub();
    const pack = resolveActivePack(hub);
    const section = resolveActiveSection(pack, hub);
    if (!pack || !section) {
      if (status) status.textContent = "Select a Study Pack section first.";
      return;
    }

    if (status) status.textContent = "Generating checkpoint quiz...";
    try {
      const out = await apiPost(API.studyPackCheckpointQuiz, {
        packTitle: pack.title,
        sectionRef: section.ref,
        sectionTitle: section.title,
        text: section.text
      });
      pack.sectionQuizzes = pack.sectionQuizzes || {};
      pack.sectionQuizzes[section.id] = out.quiz;
      scheduleSave();
      logAudit(`Checkpoint quiz generated for ${pack.title} / Section ${section.ref}.`);
      if (status) status.textContent = "Checkpoint quiz ready.";
    } catch (error) {
      if (status) status.textContent = `Quiz generation failed: ${error.message || "unknown error"}`;
    }
    renderAll();
  }

  async function generateCheatsheet() {
    const status = document.getElementById("studyPackTutorHint");
    const hub = ensureHub();
    const pack = resolveActivePack(hub);
    if (!pack) {
      if (status) status.textContent = "Select a Study Pack first.";
      return;
    }

    const composite = (pack.sections || []).map((s) => `Section ${s.ref} ${s.title}\n${s.summary}\n${s.text}`).join("\n\n");
    if (status) status.textContent = "Generating cheatsheet...";
    try {
      const out = await apiPost(API.studyPackCheatsheet, {
        packTitle: pack.title,
        text: composite
      });
      pack.cheatsheet = safeText(out?.cheatsheet || "", 16000);
      scheduleSave();
      logAudit(`Cheatsheet generated for ${pack.title}.`);
      if (status) status.textContent = "Cheatsheet generated.";
    } catch (error) {
      if (status) status.textContent = `Cheatsheet generation failed: ${error.message || "unknown error"}`;
    }
    renderAll();
  }

  async function teachModeLecture() {
    const status = document.getElementById("studyPackTutorHint");
    const hub = ensureHub();
    const pack = resolveActivePack(hub);
    const section = resolveActiveSection(pack, hub);
    if (!pack || !section) {
      if (status) status.textContent = "Select a section first for Teach mode.";
      return;
    }

    if (status) status.textContent = "Generating lecture-style explanation...";
    try {
      const out = await apiPost(API.studyPackTeachMode, {
        packTitle: pack.title,
        sectionRef: section.ref,
        sectionTitle: section.title,
        text: section.text
      });
      pack.sectionLectures = pack.sectionLectures || {};
      pack.sectionLectures[section.id] = safeText(out?.lecture || "", 16000);
      scheduleSave();
      logAudit(`Teach mode generated for ${pack.title} / Section ${section.ref}.`);
      if (status) status.textContent = "Teach mode ready.";
    } catch (error) {
      if (status) status.textContent = `Teach mode failed: ${error.message || "unknown error"}`;
    }
    renderAll();
  }

  function askPackTutor() {
    const input = document.getElementById("studyPackAskInput");
    const question = safeText(input?.value || "", 500);
    if (!question) return;

    if (typeof window.openTutorPanel === "function") {
      window.openTutorPanel("study-notes");
    }

    setTimeout(() => {
      const tutorInput = document.getElementById("tutorInput");
      if (!tutorInput) return;
      tutorInput.value = question;
      if (typeof window.sendTutorMessage === "function") window.sendTutorMessage();
    }, 120);

    if (input) input.value = "";
  }

  function saveQuickNote() {
    const input = document.getElementById("studyPackQuickNoteInput");
    const text = safeText(input?.value || "", 1400);
    if (!text) return;
    addTutorNote(text, { source: "manual" });
    if (input) input.value = "";
  }

  function addTutorNote(text, options = {}) {
    const content = safeText(text, 1800);
    if (!content) return;

    const hub = ensureHub();
    const pack = resolveActivePack(hub);
    const section = pack ? resolveActiveSection(pack, hub) : null;
    const sectionLabel =
      safeText(options.sectionLabel || "", 120) ||
      (section ? `Section ${section.ref} · ${section.title}` : pack ? pack.title : "General");

    hub.notes.unshift({
      id: makeId("sp-note"),
      text: content,
      ts: new Date().toISOString().slice(0, 16).replace("T", " "),
      sectionId: safeText(options.sectionId || section?.id || "", 120),
      sectionLabel,
      source: safeText(options.source || "tutor", 40)
    });
    hub.notes = hub.notes.slice(0, 80);
    scheduleSave();
    renderMyNotes(hub);
  }

  function getTutorContextPayload() {
    const hub = ensureHub();
    const pack = resolveActivePack(hub);
    const section = resolveActiveSection(pack, hub);
    const selection = safeText(window.getSelection?.()?.toString?.() || "", 1200);

    if (!pack) {
      return {
        packName: "Study Pack",
        sectionLabel: "No pack selected",
        context: {
          packName: "Study Pack",
          section: "",
          selection,
          activeSection: null,
          sections: [],
          weaknessSignals: []
        }
      };
    }

    const weaknessSignals = Array.isArray(hub.weaknessRecommendations)
      ? hub.weaknessRecommendations.map((rec) => ({
        topic: rec.topic,
        sectionRef: rec.sectionRef,
        sectionTitle: rec.sectionTitle,
        jumpRef: rec.jumpRef,
        message: rec.message
      }))
      : [];

    return {
      packName: pack.title,
      sectionLabel: section ? `Section ${section.ref}` : "No section selected",
      context: {
        packName: pack.title,
        section: section ? `Section ${section.ref} · ${section.title}` : "",
        selection: selection || safeText(section?.summary || "", 600),
        activeSection: section
          ? {
            id: section.id,
            ref: section.ref,
            title: section.title,
            text: safeText(section.text, 2600),
            jumpRef: section.anchorId
          }
          : null,
        sections: (pack.sections || []).slice(0, 14).map((row) => ({
          id: row.id,
          ref: row.ref,
          title: row.title,
          text: safeText(row.text, 2400),
          summary: safeText(row.summary, 320),
          jumpRef: row.anchorId
        })),
        weaknessSignals,
        highlights: (runtime.state.highlights || []).slice(0, 4).map((h) => ({
          text: h.text,
          summary: h.summary,
          section: section ? `Section ${section.ref}` : "Highlights"
        }))
      }
    };
  }

  function bindEventsOnce() {
    document.getElementById("studyPackUploadBtn")?.addEventListener("click", uploadPdfs);
    document.getElementById("studyPackClearUploadsBtn")?.addEventListener("click", clearUploadsQueue);
    document.getElementById("studyPackCreateBtn")?.addEventListener("click", createStudyPack);
    document.getElementById("studyPackOpenLatestBtn")?.addEventListener("click", openLatestPack);
    document.getElementById("studyPackCheckpointBtn")?.addEventListener("click", generateCheckpointQuiz);
    document.getElementById("studyPackCheatsheetBtn")?.addEventListener("click", generateCheatsheet);
    document.getElementById("studyPackTeachBtn")?.addEventListener("click", teachModeLecture);
    document.getElementById("studyPackAskBtn")?.addEventListener("click", askPackTutor);
    document.getElementById("studyPackQuickNoteBtn")?.addEventListener("click", saveQuickNote);

    document.getElementById("studyPackLibraryList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pack-id]");
      if (!button) return;
      const packId = button.dataset.packId;
      if (packId) selectPack(packId);
    });

    document.getElementById("studyPackToc")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-section-id]");
      if (!button) return;
      const sectionId = button.dataset.sectionId;
      if (sectionId) selectSection(sectionId);
    });

    document.getElementById("studyPackUploadList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-upload-remove]");
      if (!button) return;
      const uploadId = button.dataset.uploadRemove;
      if (uploadId) removeUpload(uploadId);
    });

    document.getElementById("studyPackWeaknessList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-weak-section]");
      if (!button) return;
      const sectionId = button.dataset.weakSection;
      if (sectionId) selectSection(sectionId);
    });
  }

  function initStudyPack() {
    ensureHub();
    if (initialized) {
      renderAll();
      return;
    }
    initialized = true;
    bindEventsOnce();
    renderAll();
  }

  function refreshStudyPack() {
    ensureHub();
    renderAll();
  }

  return {
    initStudyPack,
    refreshStudyPack,
    openLatestPack,
    focusSectionByAnchor,
    askPackTutor,
    addTutorNote,
    uploadPdfs,
    createStudyPack,
    generateCheckpointQuiz,
    generateCheatsheet,
    teachModeLecture,
    getTutorContextPayload,
    saveQuickNote
  };
}
