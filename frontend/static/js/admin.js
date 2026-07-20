/**
 * admin.js
 * Handles the Admin Dashboard data loading and UI rendering.
 * Requires apiClient.js to be loaded first.
 */

let roleChartInstance = null;
let sentimentChartInstance = null;

async function loadDashboard() {
  console.warn("[DEBUG] loadDashboard function STARTED");
  
  // Use ApiClient which handles token automatically
  const { data, error, status } = await ApiClient.get("/dashboard-stats");

  if (error) {
    console.error("Dashboard API Failed:", status, error);
    showStatusPopup("Failed to refresh dashboard: " + error, 3000);
    return;
  }

  console.warn("[DEBUG] Dashboard Data Received:", data);

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText("total-queries", data.total_queries);
  setText("active-users", data.active_users);
  const newUsers = data.new_users_today !== undefined ? data.new_users_today : 0;
  const newUsersWrapper = document.getElementById("new-users-today-wrapper");
  if (newUsersWrapper) {
    if (newUsers > 0) {
      setText("new-users-today", newUsers);
      newUsersWrapper.style.display = "";
    } else {
      newUsersWrapper.style.display = "none";
    }
  }

  const docCount = data.total_documents !== undefined ? data.total_documents : 0;
  setText("total-documents", docCount);

  const faqCount = data.total_faqs !== undefined ? data.total_faqs : 0;
  setText("total-faqs", faqCount);

  if (typeof renderCharts === "function") {
      renderCharts(data.role_distribution, data.sentiment_stats);
  }

  if (typeof loadSystemHealth === "function") loadSystemHealth();
  if (typeof loadFAQs === "function") loadFAQs();
  if (typeof loadDocuments === "function") loadDocuments();
  if (typeof loadUsers === "function") loadUsers();
}

async function loadUsers() {
  console.warn("Using loadUsers - see user management sections.");
}

async function loadDocuments() {
  const { data, error } = await ApiClient.get("/admin/documents");
  
  if (error) {
      console.error("Load Documents Error:", error);
      return;
  }
  
  window.allDocuments = data;
  if (typeof renderDocuments === "function") {
      renderDocuments(data);
  }
}

window.filterDocuments = function() {
  const input = document.getElementById("admin-search-input");
  if (!input || !window.allDocuments) return;
  const term = input.value.toLowerCase().trim();
  
  if (!term) {
    if (typeof renderDocuments === "function") renderDocuments(window.allDocuments);
    return;
  }
  
  const filtered = window.allDocuments.filter(doc => {
    try {
      const fn = String(doc.filename || "").toLowerCase();
      const tp = String(doc.type || "").toLowerCase();
      const ub = String(doc.uploaded_by || "admin").toLowerCase();
      
      return fn.includes(term) || tp.includes(term) || ub.includes(term);
    } catch (e) {
      console.error("Error filtering document:", e, doc);
      return false;
    }
  });
  
  if (typeof renderDocuments === "function") renderDocuments(filtered);
};

/**
 * Global Helper to refresh all admin data tables and stats.
 * Call this after any CRUD or training operation to ensure UI consistency.
 */
window.refreshAdminData = function refreshAdminData() {
  console.log("[SYNC] Refreshing all admin data...");
  if (typeof loadDocuments === "function") loadDocuments();
  if (typeof window.loadTrainStatus === "function") window.loadTrainStatus();
  if (typeof loadDashboard === "function") loadDashboard();
  if (typeof window.loadAllFAQs === "function") window.loadAllFAQs(); 
  if (typeof window.loadSuggestedFAQs === "function") window.loadSuggestedFAQs(); 
  if (typeof window.loadFAQs === "function") window.loadFAQs(); 
}

// Attach to window so they are globally accessible like before
window.loadDashboard = loadDashboard;
window.loadUsers = loadUsers;
window.loadDocuments = loadDocuments;
let allFaqsData = [];
let currentFilteredFAQs = [];
let currentFAQPage = 0;
const FAQ_BATCH_SIZE = 50;
let activeFAQFilterDocId = null;
let activeFAQFilterSource = null;

async function loadAllFAQs() {
  console.log(
    "loadAllFAQs called",
    activeFAQFilterSource
      ? "Filtering by: " + activeFAQFilterSource
      : "Show All",
  );
  const list = document.getElementById("all-faqs-list");
  const empty = document.getElementById("all-faqs-empty");
  if (!list) return;

  list.innerHTML =
    '<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color);"></i><p style="margin-top:15px;color:var(--text-secondary);">Loading FAQs...</p></div>';
  empty.style.display = "none";

  const actionContainer = document.getElementById("modal-action-container");
  if (actionContainer) {
    actionContainer.innerHTML = "";
  }

  try {
    let url = `${API_URL}/admin/faqs`;
    if (activeFAQFilterDocId) {
      url = `${API_URL}/admin/documents/${activeFAQFilterDocId}/faqs`;
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!res.ok) throw new Error("Failed to fetch FAQs: " + res.status);
    const faqs = await res.json();

    allFaqsData = Array.isArray(faqs) ? faqs : [];
    currentFilteredFAQs = allFaqsData; 

    currentFAQPage = 0;
    renderAllFAQs(true);
    updateFAQCount();
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px;">Error: ${e.message}</div>`;
  }
}

async function viewDocFaqs(docId, filename) {
  activeFAQFilterDocId = docId;
  activeFAQFilterSource = filename;

  const modal = document.getElementById("all-faqs-modal");
  if (modal) {
    modal.classList.add("active");

    const modalTitle = document.getElementById("faq-modal-title");
    const modalSubtitle = document.getElementById("faq-modal-subtitle");
    if (modalTitle) modalTitle.textContent = "Extracted FAQs";
    if (modalSubtitle) modalSubtitle.textContent = `Source: ${filename}`;

    const searchInput = document.getElementById("faq-search-input");
    if (searchInput) searchInput.value = "";

    await loadAllFAQs();
  }
}

async function openAllFaqsModal() {
  activeFAQFilterDocId = null;
  activeFAQFilterSource = null;

  const modal = document.getElementById("all-faqs-modal");
  if (modal) {
    modal.classList.add("active");

    const modalTitle = document.getElementById("faq-modal-title");
    const modalSubtitle = document.getElementById("faq-modal-subtitle");
    if (modalTitle) modalTitle.textContent = "Knowledge Base FAQs";
    if (modalSubtitle)
      modalSubtitle.textContent = "Browse, edit, and manage all extracted FAQs";

    await loadAllFAQs();
  }
}

function closeAllFaqsModal() {
  const modal = document.getElementById("all-faqs-modal");
  if (modal) {
    modal.classList.remove("active");
    activeFAQFilterDocId = null;
    activeFAQFilterSource = null;
  }
}

function updateFAQCount() {
  const countEl = document.getElementById("faq-count");
  if (countEl) {
    const span = countEl.querySelector("span");
    const text = `Showing ${Math.min((currentFAQPage + 1) * FAQ_BATCH_SIZE, currentFilteredFAQs.length)} of ${currentFilteredFAQs.length} FAQs`;
    if (span) {
      span.textContent = text;
    } else {
      countEl.textContent = text;
    }
  }
}

function renderAllFAQs(reset = false) {
  const list = document.getElementById("all-faqs-list");
  const empty = document.getElementById("all-faqs-empty");
  if (!list) return;

  if (currentFilteredFAQs.length === 0) {
    list.style.display = "none";
    empty.style.display = "block";
    return;
  }

  list.style.display = "block";
  empty.style.display = "none";

  if (reset) {
    list.innerHTML = "";
    currentFAQPage = 0;
  }

  const start = currentFAQPage * FAQ_BATCH_SIZE;
  const end = start + FAQ_BATCH_SIZE;
  const batch = currentFilteredFAQs.slice(start, end);

  batch.forEach((f) => {
    list.appendChild(renderFAQItem(f));
  });

  const existingBtn = document.getElementById("faq-view-more-btn");
  if (existingBtn) existingBtn.remove();

  if (end < currentFilteredFAQs.length) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.id = "faq-view-more-btn";
    loadMoreBtn.className = "btn-secondary";
    loadMoreBtn.style.display = "block";
    loadMoreBtn.style.width = "100%";
    loadMoreBtn.style.marginTop = "20px";
    loadMoreBtn.innerHTML = `View More (${currentFilteredFAQs.length - end} remaining)`;
    loadMoreBtn.onclick = () => {
      currentFAQPage++;
      renderAllFAQs(false);
      updateFAQCount();
    };
    list.appendChild(loadMoreBtn);
  }
}

let searchFAQTimeout = null;

async function filterFAQs() {
  const searchInput = document.getElementById("faq-search-input");
  if (!searchInput) return;

  const term = searchInput.value.toLowerCase().trim();

  // Clear previous timeout
  if (searchFAQTimeout) clearTimeout(searchFAQTimeout);

  if (term.length < 3) {
    // Revert to local filtering if term is short or empty
    let filtered = allFaqsData;
    if (term) {
      filtered = filtered.filter((f) => {
        const qMatch = f.question && f.question.toLowerCase().includes(term);
        const aMatch = f.answer && f.answer.toLowerCase().includes(term);
        const catMatch = f.category && f.category.toLowerCase().includes(term);
        return qMatch || aMatch || catMatch;
      });
    }
    currentFilteredFAQs = filtered;
    renderAllFAQs(true);
    updateFAQCount();
    return;
  }

  // Use debounced API call for semantic + keyword search
  searchFAQTimeout = setTimeout(async () => {
    try {
      const countEl = document.getElementById("faq-count");
      if (countEl) {
        countEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-8"></i><span>Running AI Search...</span>`;
      }
      
      const res = await fetch(`${API_URL}/admin/faqs/search?query=${encodeURIComponent(term)}`, {
        headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      currentFilteredFAQs = data.faqs || [];
      renderAllFAQs(true);
      
      if (countEl) {
        countEl.innerHTML = `<i class="fa-solid fa-bolt mr-8 opacity-7 text-primary"></i><span>Found ${currentFilteredFAQs.length} relevant FAQs</span>`;
      }
    } catch (err) {
      console.error("FAQ Search Error:", err);
      // Fallback to local filtering
      let filtered = allFaqsData.filter((f) => {
        const qMatch = f.question && f.question.toLowerCase().includes(term);
        const aMatch = f.answer && f.answer.toLowerCase().includes(term);
        return qMatch || aMatch;
      });
      currentFilteredFAQs = filtered;
      renderAllFAQs(true);
      updateFAQCount();
    }
  }, 400); // 400ms debounce
}

/**
 * Shared FAQ Item Renderer
 */
function renderFAQItem(f) {
  const item = document.createElement("div");
  item.className = "faq-card-premium";
  item.id = `all-faq-item-${f.id}`;

  item.innerHTML = `
        <div class="faq-display-mode">
            <div style="font-weight: 700; color: var(--accent-color); margin-bottom: 8px; font-size: 15px; display: flex; align-items: flex-start; gap: 8px;">
                <span style="opacity: 0.6; flex-shrink: 0;">Q:</span>
                <span>${escapeHtml(f.question)}</span>
            </div>
            <div style="color: var(--text-primary); line-height: 1.6; font-size: 14px; display: flex; align-items: flex-start; gap: 8px;">
                <span style="opacity: 0.6; flex-shrink: 0; font-weight: 600;">A:</span>
                <span>${escapeHtml(f.answer)}</span>
            </div>
            <div style="margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border-color); display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <span class="badge success" style="font-size: 9px; padding: 4px 10px; border-radius: 50px;">${escapeHtml(f.category || "General")}</span>
                ${f.source_urls && f.source_urls.length > 0 ? `<span style="font-size: 11px; color: var(--text-secondary); opacity: 0.8;">Source: ${escapeHtml(f.source_urls[0])}</span>` : ""}
                <div style="margin-left: auto; display: flex; gap: 12px;">
                    <button onclick="enableEditAllFAQ('${f.id}')" style="background: none; border: none; color: var(--accent-color); cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-pen-to-square"></i> Edit
                    </button>
                    <button onclick="deleteAllFAQ('${f.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </div>
            </div>
        </div>
        
        <div class="faq-edit-mode" style="display: none;">
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <label style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--accent-color);">Question</label>
                <input type="text" id="all-edit-q-${f.id}" value="${escapeHtml(f.question)}" class="input-premium">
                <label style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--accent-color);">Answer</label>
                <textarea id="all-edit-a-${f.id}" rows="4" class="input-premium">${escapeHtml(f.answer)}</textarea>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <select id="all-edit-c-${f.id}" class="custom-select" style="flex: 1;">
                        <option value="General" ${f.category === "General" ? "selected" : ""}>General</option>
                        <option value="Academic" ${f.category === "Academic" ? "selected" : ""}>Academic</option>
                        <option value="Admissions" ${f.category === "Admissions" ? "selected" : ""}>Admissions</option>
                        <option value="Facilities" ${f.category === "Facilities" ? "selected" : ""}>Facilities</option>
                        <option value="Hostels" ${f.category === "Hostels" ? "selected" : ""}>Hostels</option>
                        <option value="Placements" ${f.category === "Placements" ? "selected" : ""}>Placements</option>
                        <option value="User added faqs" ${f.category === "User added faqs" ? "selected" : ""}>User Contributions</option>
                    </select>
                    <button onclick="cancelEditAllFAQ('${f.id}')" class="btn-ghost" style="padding: 10px 20px;">Cancel</button>
                    <button onclick="updateAllFAQ('${f.id}')" class="btn-primary" style="padding: 10px 25px;">Update</button>
                </div>
            </div>
        </div>
    `;
  return item;
}

function enableEditAllFAQ(id) {
  const item = document.getElementById(`all-faq-item-${id}`);
  if (!item) return;
  item.querySelector(".faq-display-mode").style.display = "none";
  item.querySelector(".faq-edit-mode").style.display = "block";
}

function cancelEditAllFAQ(id) {
  const item = document.getElementById(`all-faq-item-${id}`);
  if (!item) return;
  item.querySelector(".faq-display-mode").style.display = "block";
  item.querySelector(".faq-edit-mode").style.display = "none";
}

async function updateAllFAQ(id) {
  const q = document.getElementById(`all-edit-q-${id}`).value;
  const a = document.getElementById(`all-edit-a-${id}`).value;
  const c = document.getElementById(`all-edit-c-${id}`).value;

  if (!q || !a)
    return await CustomDialog.alert("Question and Answer are required", "Validation Error", "error");

  try {
    const res = await fetch(`${API_URL}/admin/faqs/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ question: q, answer: a, category: c }),
    });

    if (res.ok) {
      showStatusPopup("FAQ Updated Successfully");
      refreshAdminData(); 
    } else {
      let errMsg = "Failed to update FAQ";
      try {
        const errData = await res.json();
        errMsg = errData.detail || errMsg;
      } catch (_) {}
      console.error("FAQ Update Error:", res.status, errMsg);
      await CustomDialog.alert(errMsg, "Update Failed", "error");
    }
  } catch (e) {
    console.error("FAQ Update Network Error:", e);
    await CustomDialog.alert("Network error. Please try again.", "Update Failed", "error");
  }
}


async function deleteAllFAQ(id) {
  if (!(await CustomDialog.confirm("Delete this FAQ?"))) return;

  try {
    const res = await fetch(`${API_URL}/admin/faqs/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("FAQ Deleted");
      refreshAdminData(); 
    } else {
      await CustomDialog.alert("Failed to delete FAQ", "Delete Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

function renderCharts(roleData, sentimentData) {
  
  const ctxRole = document.getElementById("roleChart").getContext("2d");

  if (roleChartInstance) roleChartInstance.destroy();

  roleChartInstance = new Chart(ctxRole, {
    type: "doughnut",
    data: {
      labels: Object.keys(roleData),
      datasets: [
        {
          data: Object.values(roleData),
          backgroundColor: ["#0f766e", "#f59e0b", "#ef4444", "#6366f1"],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: "Queries by User Role" },
      },
    },
  });

  const ctxSent = document.getElementById("sentimentChart").getContext("2d");
  if (sentimentChartInstance) sentimentChartInstance.destroy();
  sentimentChartInstance = new Chart(ctxSent, {
    type: "bar",
    data: {
      labels: Object.keys(sentimentData),
      datasets: [
        {
          label: "User Emotions",
          data: Object.values(sentimentData),
          backgroundColor: ["#10b981", "#94a3b8", "#ef4444"],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "User Sentiment Analysis" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}


let currentSkippedFaqs = [];
let currentSkippedDocId = null;

async function viewSkippedFaqs(docId, filename) {
  const modal = document.getElementById("skipped-faqs-modal");
  if (modal) {
    currentSkippedDocId = docId;
    modal.classList.add("active");
    
    const subtitle = document.getElementById("skipped-faqs-subtitle");
    if (subtitle) subtitle.textContent = `Source: ${filename}`;
    
    const countEl = document.getElementById("skipped-faqs-count");
    const span = countEl ? countEl.querySelector("span") : null;
    if (span) span.textContent = "Loading...";
    
    const list = document.getElementById("skipped-faqs-list");
    const empty = document.getElementById("skipped-faqs-empty");
    
    list.innerHTML = "";
    list.style.display = "none";
    empty.style.display = "none";
    
    try {
      const res = await fetch(`${API_URL}/admin/documents/${docId}/skipped-faqs`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
      if (!res.ok) throw new Error("Failed to fetch");
      
      const faqs = await res.json();
      currentSkippedFaqs = faqs;
      
      if (faqs.length === 0) {
        empty.style.display = "block";
        if (span) span.textContent = "0 skipped FAQs";
      } else {
        list.style.display = "block";
        if (span) span.textContent = `Showing ${faqs.length} skipped FAQs`;
        
        faqs.forEach((faq, index) => {
          list.innerHTML += `
            <div class="faq-card-premium mb-15" id="skipped-faq-${index}">
                <div class="faq-display-mode" id="skipped-display-${index}">
                    <div style="font-weight: 700; color: var(--accent-color); margin-bottom: 8px; font-size: 15px; display: flex; align-items: flex-start; gap: 8px;">
                        <span style="opacity: 0.6; flex-shrink: 0;">Q:</span>
                        <span>${escapeHtml(faq.question)}</span>
                    </div>
                    <div style="color: var(--text-primary); line-height: 1.6; font-size: 14px; display: flex; align-items: flex-start; gap: 8px;">
                        <span style="opacity: 0.6; flex-shrink: 0; font-weight: 600;">A:</span>
                        <span>${escapeHtml(faq.answer)}</span>
                    </div>
                    <div style="margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border-color); display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                        <span class="badge success" style="font-size: 9px; padding: 4px 10px; border-radius: 50px; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(faq.category || "General")}</span>
                        <div class="flex gap-10">
                            <button class="btn-ghost btn-small" onclick="editSkippedFaq(${index})"><i class="fa-solid fa-pen"></i> Edit</button>
                            <button class="btn-primary btn-small rounded-10" onclick="importSkippedFaq(${index}, false)"><i class="fa-solid fa-file-import"></i> Import to DB</button>
                        </div>
                    </div>
                </div>
                
                <div class="faq-edit-mode hidden" id="skipped-edit-${index}" style="margin-top: 10px;">
                    <div class="mb-10">
                        <label class="text-xs text-secondary mb-4 block">Question</label>
                        <textarea id="skipped-q-${index}" class="admin-input text-sm" rows="2" style="width: 100%; border-radius: 8px;">${escapeHtml(faq.question)}</textarea>
                    </div>
                    <div class="mb-10">
                        <label class="text-xs text-secondary mb-4 block">Answer</label>
                        <textarea id="skipped-a-${index}" class="admin-input text-sm" rows="3" style="width: 100%; border-radius: 8px;">${escapeHtml(faq.answer)}</textarea>
                    </div>
                    <div class="mb-15">
                        <label class="text-xs text-secondary mb-4 block">Category</label>
                        <input id="skipped-c-${index}" class="admin-input text-sm" style="width: 100%; border-radius: 8px;" value="${escapeHtml(faq.category || "General")}" />
                    </div>
                    <div class="flex justify-end gap-10">
                        <button class="btn-ghost btn-small" onclick="cancelEditSkippedFaq(${index})">Cancel</button>
                        <button class="btn-primary btn-small rounded-10" onclick="importSkippedFaq(${index}, true)"><i class="fa-solid fa-check"></i> Save & Import</button>
                    </div>
                </div>
            </div>
          `;
        });
      }
    } catch (e) {
      console.error(e);
      showStatusPopup("Error loading skipped FAQs", true);
    }
  }
}

function closeSkippedFaqsModal() {
  const modal = document.getElementById("skipped-faqs-modal");
  if (modal) modal.classList.remove("active");
}

window.viewSkippedFaqs = viewSkippedFaqs;
window.closeSkippedFaqsModal = closeSkippedFaqsModal;

window.editSkippedFaq = function(index) {
  document.getElementById(`skipped-display-${index}`).style.display = "none";
  document.getElementById(`skipped-edit-${index}`).classList.remove("hidden");
};

window.cancelEditSkippedFaq = function(index) {
  document.getElementById(`skipped-display-${index}`).style.display = "block";
  document.getElementById(`skipped-edit-${index}`).classList.add("hidden");
};

window.importSkippedFaq = async function(index, useEditedValues = false) {
  const faq = currentSkippedFaqs[index];
  if (!faq) return;

  const q = useEditedValues ? document.getElementById(`skipped-q-${index}`).value.trim() : faq.question;
  const a = useEditedValues ? document.getElementById(`skipped-a-${index}`).value.trim() : faq.answer;
  const c = useEditedValues ? document.getElementById(`skipped-c-${index}`).value.trim() : (faq.category || "General");

  if (!q || !a) {
    if (typeof CustomDialog !== "undefined") {
      CustomDialog.alert("Question and Answer are required.", "Error", "error");
    } else {
      alert("Question and Answer are required.");
    }
    return;
  }

  const card = document.getElementById(`skipped-faq-${index}`);
  if (card) {
    card.style.opacity = "0.5";
    card.style.pointerEvents = "none";
  }

  try {
    const res = await fetch(`${API_URL}/admin/faqs`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}` 
      },
      body: JSON.stringify({ question: q, answer: a, category: c })
    });

    if (!res.ok) throw new Error("Failed to import FAQ");
    
    // Call endpoint to remove from skipped_faqs array in the document
    if (currentSkippedDocId) {
      try {
        await fetch(`${API_URL}/admin/documents/${currentSkippedDocId}/skipped-faqs/${index}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
        });
      } catch (removeErr) {
        console.error("Failed to remove skipped FAQ from doc:", removeErr);
      }
    }
    
    if (typeof showStatusPopup !== "undefined") {
      showStatusPopup("FAQ Imported successfully!");
    } else {
      alert("FAQ Imported successfully!");
    }
    
    if (typeof refreshAdminData === "function") {
      refreshAdminData();
    }
    
    // Re-fetch the list to prevent index mismatches
    if (currentSkippedDocId) {
       const subtitle = document.getElementById("skipped-faqs-subtitle");
       const filename = subtitle ? subtitle.textContent.replace("Source: ", "") : "Document";
       await viewSkippedFaqs(currentSkippedDocId, filename);
    }
    
  } catch (err) {
    console.error(err);
    if (typeof showStatusPopup !== "undefined") {
      showStatusPopup("Error importing FAQ", true);
    } else {
      alert("Error importing FAQ");
    }
    if (card) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("download-skipped-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (!currentSkippedFaqs || currentSkippedFaqs.length === 0) {
        showStatusPopup("No FAQs to download", true);
        return;
      }
      
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentSkippedFaqs, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "skipped_faqs.json");
      document.body.appendChild(downloadAnchorNode); 
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  }
});
