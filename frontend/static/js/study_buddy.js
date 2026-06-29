async function loadStudyBuddy() {
  if (!ACCESS_TOKEN) return;
  const listEl = document.getElementById("study-materials-list");
  if (!listEl) return;

  try {
    const res = await fetch(`${API_URL}/study-buddy/materials`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (res.ok) {
      const materials = await res.json();
      if (materials.length === 0) {
        listEl.innerHTML = `
          <div class="p-60 text-center text-secondary bg-ghost rounded-24 border-dashed border-2 animate-fadeIn">
            <i class="fa-solid fa-cloud-arrow-up text-40 mb-20 opacity-40 text-accent"></i>
            <p class="font-bold text-xl text-primary mb-8 ls-neg-01">Your research archive is empty.</p>
            <p class="text-md opacity-70 mb-25">Upload your first material to begin your high-fidelity analysis journey.</p>
            <button class="btn-primary rounded-12 px-25 py-12 shadow-premium" onclick="openUploadModal('study')">
              <i class="fa-solid fa-plus mr-8"></i> Begin Upload
            </button>
          </div>`;
      } else {
        listEl.className = "premium-material-grid"; 
        const html = materials.map((m) => {
          const date = new Date(m.upload_date).toLocaleDateString();
          return `
            <div class="premium-material-card" onclick="summarizeMaterial('${m.id}')">
                <div class="material-type-icon shadow-teal">
                    <i class="fa-solid fa-file-pdf"></i>
                </div>
                <div class="material-meta">
                    <div class="material-name">${escapeHtml(m.filename)}</div>
                    <div class="material-date">
                      <i class="fa-regular fa-calendar-check"></i> Captured on ${date}
                    </div>
                </div>
                <div class="material-actions" onclick="event.stopPropagation()">
                    <button class="material-mini-btn" title="Deep Analysis" onclick="summarizeMaterial('${m.id}')">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                    </button>
                    <button class="material-mini-btn danger" title="Remove" onclick="deleteStudyMaterial('${m.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>`;
        }).join("");
        listEl.innerHTML = html;
      }
    }
  } catch (e) {
    console.error("Load Materials Error", e);
  }
}
window.loadStudyBuddy = loadStudyBuddy;

async function deleteStudyMaterial(id) {
  if (!(await CustomDialog.confirm("Are you sure you want to delete this material?", "Delete Material", "warning"))) return;

  try {
    const res = await fetch(`${API_URL}/study-buddy/materials/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (res.ok) {
      showStatusPopup("Material deleted");
      loadStudyBuddy();
      document.getElementById("material-summary-content").innerHTML =
        "Select a document to generate a smart AI summary.";
    }
  } catch (e) {
    console.error(e);
  }
}

let currentStudyMaterialId = null;

function openStudyTextModal() {
  const modal = document.getElementById("study-text-modal");
  if (modal) {
    modal.classList.add("active");
    document.getElementById("study-text-title").value = "";
    document.getElementById("study-text-content").value = "";
  }
}

function closeStudyTextModal() {
  const modal = document.getElementById("study-text-modal");
  if (modal) modal.classList.remove("active");
}

async function submitStudyText() {
  const title = document.getElementById("study-text-title").value.trim();
  const content = document.getElementById("study-text-content").value.trim();

  if (!title || !content) {
    await CustomDialog.alert("Please enter both a title and some content.", "Validation Error", "warning");
    return;
  }

  const btn = document.querySelector("#study-text-modal .btn-primary");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/study-buddy/upload-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ title, content }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Upload failed");
    }

    const data = await res.json();
    showStatusPopup("Text analyzed successfully!");
    closeStudyTextModal();
    loadStudyBuddy();
  } catch (e) {
    await CustomDialog.alert("Error: " + e.message, "Upload Failed", "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
window.openStudyTextModal = openStudyTextModal;
window.closeStudyTextModal = closeStudyTextModal;
window.submitStudyText = submitStudyText;

async function summarizeMaterial(id) {
  if (!ACCESS_TOKEN) return;
  const summaryEl = document.getElementById("material-summary-content");
  if (!summaryEl) return;

  if (currentChatController) currentChatController.abort();
  currentChatController = new AbortController();

  summaryEl.innerHTML = `
    <div class="flex items-center justify-center gap-12 p-30 bg-ghost rounded-12">
        <i class="fa-solid fa-spinner fa-spin text-accent text-2xl"></i>
        <div class="text-secondary font-medium">Zen is reading your notes...</div>
    </div>`;
  
  const history = document.getElementById("document-chat-history");
  if (history) {
    history.innerHTML = `
      <div class="bot-msg-standard-study" style="text-align: center; opacity: 0.5;">
        Preparing workspace...
      </div>
    `;
  }
  
  try {
    const res = await fetch(`${API_URL}/study-buddy/summarize/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: currentChatController.signal
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Summary extraction failed");
    }

    const data = await res.json();
    summaryEl.innerHTML = `<div class="markdown-body p-10">${marked.parse(data.summary)}</div>`;

    currentStudyMaterialId = id;
    
    toggleStudyArchive(false);

    const chatCard = document.getElementById("document-chat-card");
    if (chatCard) {
      chatCard.style.display = "flex";
      const history = document.getElementById("document-chat-history");
      if (history) {
        history.innerHTML = `
          <div class="bot-msg-standard-study" style="background: rgba(13, 148, 136, 0.05); padding: 20px; border-radius: 16px; border: 1px dashed var(--accent-color); margin-bottom: 25px;">
            <p style="margin: 0 0 10px 0; font-weight: 700; color: var(--accent-color); font-size: 15px; font-family: 'Outfit', sans-serif;">
              <i class="fa-solid fa-sparkles"></i> Neural Analysis Complete
            </p>
            <p style="margin: 0; font-size: 14px; color: var(--text-primary); line-height: 1.6; opacity: 0.9;">
              I have successfully synthesized these lecture notes. You can now interrogate the document content using the follow-up field below. I will respond with <strong>high-fidelity academic precision</strong>.
            </p>
          </div>
        `;
      }
      
      setTimeout(() => {
        const docInput = document.getElementById("document-chat-input");
        if (docInput) docInput.focus();
      }, 100);
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    const summaryEl = document.getElementById("material-summary-content");
    if (summaryEl) summaryEl.innerHTML = `<p style="color: #ef4444; padding: 20px;">Failed to generate summary: ${e.message}</p>`;
    console.error(e);
  }
}

/**
 * Toggles between Lecture Archive and Analysis Workspace
 * @param {boolean} showArchive - if true, shows archive and hides workspace
 */
function toggleStudyArchive(showArchive) {
    console.log("Toggling Study View - Show Archive:", showArchive);
    const archive = document.getElementById("study-archive-card");
    const workspace = document.getElementById("analysis-workspace");
    const container = document.getElementById("study-notes-view");
    
    if (showArchive) {
        if (archive) {
            archive.classList.remove("hidden");
            archive.style.display = "block";
        }
        if (workspace) {
            workspace.classList.add("hidden");
            workspace.style.display = "none";
            
            const summaryEl = document.getElementById("material-summary-content");
            if (summaryEl) summaryEl.innerHTML = "Synthesizing academic insights...";
            
            const history = document.getElementById("document-chat-history");
            if (history) {
                history.innerHTML = `
                  <div class="bot-msg-standard-study">
                    Please ask any specific questions about the analyzed material.
                  </div>
                `;
            }
            
            const input = document.getElementById("document-chat-input");
            if (input) {
                input.value = "";
                input.placeholder = "Ask a follow-up question about this document...";
            }
            
            currentStudyMaterialId = null;
        }
        if (container) container.classList.remove("full-analysis-layout");
    } else {
        if (archive) {
            archive.classList.add("hidden");
            archive.style.display = "none";
        }
        if (workspace) {
            workspace.classList.remove("hidden");
            workspace.style.display = "block";
        }
        if (container) container.classList.add("full-analysis-layout");
    }
}

async function askStudyBuddy() {
  if (!currentStudyMaterialId) return;
  const input = document.getElementById("document-chat-input");
  const history = document.getElementById("document-chat-history");
  const query = input.value.trim();

  if (!query) return;

  window.setStudyInput = (text) => {
    input.value = text;
    input.focus();
  };

  const userMsg = document.createElement("div");
  userMsg.className = "zen-message-item user mb-16";
  userMsg.innerHTML = `
    <div class="zen-message user">
        ${escapeHtml(query)}
    </div>`;
  history.appendChild(userMsg);
  input.value = "";

  const typing = document.createElement("div");
  typing.className = "typing-indicator mb-16";
  typing.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
  `;
  history.appendChild(typing);
  history.scrollTop = history.scrollHeight;

  try {
    const res = await fetch(`${API_URL}/study-buddy/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      signal: currentChatController.signal,
      body: JSON.stringify({
        material_id: currentStudyMaterialId,
        query: query,
      }),
    });

    if (typing.parentNode) history.removeChild(typing);
    if (!res.ok) throw new Error("Chat failed");
    
    const data = await res.json();
    const aiMsg = document.createElement("div");
    aiMsg.className = "zen-message-item zen mb-24 animate-fadeIn";
    aiMsg.innerHTML = `
      <div class="zen-message zen" style="box-shadow: var(--shadow-lg); border-left: 4px solid var(--accent-color); padding: 22px; border-radius: 20px;">
          <div class="markdown-body">
            ${marked.parse(data.response)}
          </div>
          <div style="margin-top: 18px; padding-top: 15px; border-top: 1px solid rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 8px; opacity: 0.8; font-weight: 500;">
                <i class="fa-solid fa-microchip text-accent"></i> Synthesized from Lecture Content
            </div>
            <div style="font-weight: 800; color: var(--accent-color); letter-spacing: 0.8px; text-transform: uppercase;">Zen AI Analysis</div>
          </div>
      </div>`;
    history.appendChild(aiMsg);
    
    if (typeof renderZenContent === 'function') {
        renderZenContent(aiMsg);
    }
    
    history.scrollTop = history.scrollHeight;
    
    input.placeholder = "Ask another follow-up question...";
    input.focus();

  } catch (e) {
    if (e.name === 'AbortError') return;
    if (typing.parentNode) history.removeChild(typing);
    const errorMsg = document.createElement("div");
    errorMsg.style.cssText = "text-align: center; color: #ef4444; font-size: 12px; padding: 10px;";
    errorMsg.textContent = "AI had trouble accessing the document context.";
    history.appendChild(errorMsg);
  }
}

