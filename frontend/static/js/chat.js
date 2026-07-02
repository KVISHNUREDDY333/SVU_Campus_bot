async function sendMessage() {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    resetHighlighting();
  }
  
  if (currentChatController) {
    console.warn("User cancelled generation early.");
    currentChatController.abort();
    currentChatController = null;
    hideTypingIndicator();
    setChatButtonState(false);
    return;
  }

  const userInputEl = document.getElementById("user-input");
  const text = userInputEl ? userInputEl.value?.trim() : "";
  if (!text) return;

  if (welcomeScreen && welcomeScreen.style.display !== "none") {
    welcomeScreen.style.display = "none";
  }

  appendMessage(text, "user", true);
  if (userInputEl) {
    userInputEl.value = "";
  }

  showTypingIndicator();

  currentChatController = new AbortController();
  setChatButtonState(true);

  scrollToBottom();

  let sessionId = sessionStorage.getItem("chat_session_id");
  if (!sessionId) {
    sessionId =
      "session-" +
      Date.now() +
      "-" +
      Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem("chat_session_id", sessionId);
  }

  try {
    const response = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        message: text,
        session_id: sessionId,
        language: document.getElementById("lang-select")?.value || "en",
      }),
      signal: currentChatController.signal,
    });

    if (response.status === 401) {
      await CustomDialog.alert("Session expired. Please log in again.", "Session Expired", "warning");
      logout();
      return;
    }

    if (!response.ok) throw new Error("Backend unavailable");
    const data = await response.json();

    hideTypingIndicator();

    const msgDiv = appendMessage(
      data.response || "I'm having trouble connecting right now.",
      "bot",
      true,
    );

    if (
      data.response &&
      (data.response.toLowerCase().includes("raise a ticket") ||
        data.response.toLowerCase().includes("don't know"))
    ) {
      const ticketBtn = document.createElement("button");
      ticketBtn.className = "ticket-action-btn";
      ticketBtn.innerText = "🎫 Raise a Ticket";
      ticketBtn.onclick = () => openTicketModal(text, data.response); 
      msgDiv.appendChild(ticketBtn);
    }
  } catch (err) {
    hideTypingIndicator();
    if (err.name === "AbortError") {
      appendMessage("Request explicitly cancelled by user.", "bot", false);
      console.log("Fetch aborted gracefully.");
    } else {
      appendMessage(
        "I apologize, but I'm unable to reach the server at the moment. Please try again later.",
        "bot",
      );
    }
  } finally {
    currentChatController = null;
    setChatButtonState(false);
  }

  scrollToBottom();
}

function speak(text) {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    
    const voices = window.speechSynthesis.getVoices();
    
    const preferredVoice =
      voices.find((v) => v.lang.includes("IN")) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;

    window.speechSynthesis.speak(utterance);
  }
}



function renderDocuments(docs) {
  const tbody = document.getElementById("documents-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (docs.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align: center; padding: 20px;">No documents found.</td></tr>';
    return;
  }

  docs.forEach((doc) => {
    const dateStr = new Date(
      doc.uploaded_at || doc.upload_date,
    ).toLocaleDateString();
    let iconClass = "fa-file-pdf";
    let typeLabel = "PDF";
    let badgeClass = "success";

    if (doc.type === "url") {
      iconClass = "fa-link";
      typeLabel = "URL";
      badgeClass = "warning";
    } else if (doc.type === "text") {
      iconClass = "fa-pen";
      typeLabel = "TEXT";
      badgeClass = "info";
    } else if (doc.type === "faq_import") {
      iconClass = "fa-file-import";
      typeLabel = "IMPORT";
      badgeClass = "warning";
    }

    tbody.innerHTML += `
            <tr>
                <td style="display: flex; align-items: center; gap: 8px;" title="${escapeHtml(doc.filename)}">
                    <i class="fa-solid ${iconClass}" style="color: var(--accent-color);"></i>
                    ${escapeHtml(doc.filename)}
                </td>
                <td title="${typeLabel}"><span class="badge ${badgeClass}">${typeLabel}</span></td>
                <td style="text-align: center;">${doc.chunks || 0}</td>
                <td style="text-align: center;">${doc.extracted_faqs || 0}</td>
                <td style="text-align: center;" title="${escapeHtml(doc.uploaded_by || "Admin")}">${doc.uploaded_by || "Admin"}</td>
                <td style="display: flex; gap: 8px; justify-content: flex-end;">
                    ${doc.skipped_faqs && doc.skipped_faqs.length > 0 ? `
                    <button class="icon-btn" onclick="viewSkippedFaqs('${doc._id}', '${escapeHtml(doc.filename)}')" style="color: #f59e0b;" title="View Skipped/Duplicate FAQs">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </button>
                    ` : ''}
                    <button class="icon-btn" onclick="viewDocFaqs('${doc._id}', '${escapeHtml(doc.filename)}')" style="color: var(--accent-color);" title="View FAQs">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="icon-btn" onclick="deleteDocument('${doc._id}')" style="color: #ef4444;" title="Delete Document">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
  });

}

async function deleteDocument(docId) {
  if (!(await CustomDialog.confirm("Are you sure you want to delete this document?")))
    return;
  try {
    const res = await fetch(`${API_URL}/admin/documents/${docId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (res.ok) {
      showStatusPopup("Document deleted.");
      refreshAdminData();
    }
  } catch (e) {
    console.error(e);
  }
}


document.addEventListener("DOMContentLoaded", () => {
  const userInputEl = document.getElementById("user-input");
  if (userInputEl) {
    userInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // Initialize Premium Custom Language Dropdown
  const customLangBtn = document.getElementById("custom-lang-btn");
  const customLangDropdown = document.getElementById("custom-lang-dropdown");
  const customLangSelector = document.getElementById("custom-lang-selector");
  const langSelect = document.getElementById("lang-select");

  if (customLangBtn && customLangDropdown && langSelect) {
    // Synchronize selection state
    const syncLanguageSelection = (val) => {
      const options = customLangDropdown.querySelectorAll(".custom-lang-option");
      options.forEach(opt => {
        const isActive = opt.getAttribute("data-value") === val;
        opt.classList.toggle("active", isActive);
        opt.setAttribute("aria-selected", isActive ? "true" : "false");
        if (isActive) {
          const name = opt.querySelector(".lang-name").textContent;
          document.getElementById("current-lang-label").textContent = name;
        }
      });
      langSelect.value = val;
    };

    // Toggle dropdown visibility
    customLangBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = customLangSelector.classList.contains("open");
      customLangSelector.classList.toggle("open", !isOpen);
      customLangBtn.setAttribute("aria-expanded", !isOpen ? "true" : "false");
    });

    // Option selection handler
    customLangDropdown.addEventListener("click", (e) => {
      const option = e.target.closest(".custom-lang-option");
      if (option) {
        const val = option.getAttribute("data-value");
        syncLanguageSelection(val);
        customLangSelector.classList.remove("open");
        customLangBtn.setAttribute("aria-expanded", "false");
        // Dispatch change event to notify any external integrations
        langSelect.dispatchEvent(new Event("change"));
      }
    });

    // Close dropdown on clicking outside
    document.addEventListener("click", (e) => {
      if (!customLangSelector.contains(e.target)) {
        customLangSelector.classList.remove("open");
        customLangBtn.setAttribute("aria-expanded", "false");
      }
    });

    // Keyboard accessibility support
    customLangSelector.addEventListener("keydown", (e) => {
      const options = Array.from(customLangDropdown.querySelectorAll(".custom-lang-option"));
      const activeOption = customLangDropdown.querySelector(".custom-lang-option.active");
      let activeIndex = options.indexOf(activeOption);

      if (e.key === "Escape") {
        customLangSelector.classList.remove("open");
        customLangBtn.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!customLangSelector.classList.contains("open")) {
          customLangSelector.classList.add("open");
        } else {
          activeIndex = (activeIndex + 1) % options.length;
          syncLanguageSelection(options[activeIndex].getAttribute("data-value"));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (customLangSelector.classList.contains("open")) {
          activeIndex = (activeIndex - 1 + options.length) % options.length;
          syncLanguageSelection(options[activeIndex].getAttribute("data-value"));
        }
      }
    });

    // Sync initial select state
    syncLanguageSelection(langSelect.value || "en");
  }
});

function appendMessage(text, sender, save = true) {
  if (save) {
    chatHistory.push({ text, sender });
    sessionStorage.setItem("svu_chat_history", JSON.stringify(chatHistory));
  }

  const div = document.createElement("div");
  div.classList.add("message", sender);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "message-body"; 

  const bubble = document.createElement("div");
  bubble.className = "text"; 

  if (sender === "bot") {
    const botIconDiv = document.createElement("div");
    botIconDiv.className = "bot-icon";
    botIconDiv.innerHTML =
      '<img src="/static/images/bot_avatar.svg" alt="Bot" style="width: 100%; height: 100%;">';

    const textSpan = document.createElement("div");
    textSpan.className = "message-content";
    
    textSpan.innerHTML = marked.parse(text);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "speech-btn";
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.onclick = () => copyText(textSpan, copyBtn);

    const speakBtn = document.createElement("button");
    speakBtn.className = "speech-btn";
    speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    speakBtn.onclick = () => speakText(text, textSpan, speakBtn);

    const ticketBtn = document.createElement("button");
    ticketBtn.className = "speech-btn";
    ticketBtn.title = "Raise Support Ticket";
    ticketBtn.innerHTML = '<i class="fa-solid fa-ticket"></i>';

    const upBtn = document.createElement("button");
    upBtn.className = "speech-btn feedback-up";
    upBtn.title = "Good Response";
    upBtn.innerHTML = '<i class="fa-regular fa-thumbs-up"></i>';

    const downBtn = document.createElement("button");
    downBtn.className = "speech-btn feedback-down";
    downBtn.title = "Poor Response";
    downBtn.innerHTML = '<i class="fa-regular fa-thumbs-down"></i>';

    let triggeredQuery = "Unknown context";
    for (let i = chatHistory.length - 2; i >= 0; i--) {
      if (chatHistory[i].sender === "user") {
        triggeredQuery = chatHistory[i].text;
        break;
      }
    }

    upBtn.onclick = () => sendFeedback(triggeredQuery, text, 1, upBtn);
    downBtn.onclick = () => sendFeedback(triggeredQuery, text, -1, downBtn);
    ticketBtn.onclick = () => openTicketModal(triggeredQuery, text);

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(speakBtn);
    actionsDiv.appendChild(ticketBtn);
    actionsDiv.appendChild(upBtn);
    actionsDiv.appendChild(downBtn);

    bubble.appendChild(textSpan);
    contentWrapper.appendChild(bubble);
    contentWrapper.appendChild(actionsDiv);

    div.appendChild(botIconDiv);
    div.appendChild(contentWrapper);
  } else {
    const textSpan = document.createElement("div");
    textSpan.className = "message-content";
    textSpan.textContent = text;

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "speech-btn";
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.onclick = () => copyText(textSpan, copyBtn);

    actionsDiv.appendChild(copyBtn);

    bubble.appendChild(textSpan);
    contentWrapper.appendChild(bubble);
    contentWrapper.appendChild(actionsDiv);

    div.appendChild(contentWrapper);
  }

  if (typingIndicator) {
    chatBox.insertBefore(div, typingIndicator);
  } else {
    chatBox.appendChild(div);
  }

  return div;
}

async function sendFeedback(userQuery, botResponse, rating, btn) {
  
  const originalContent = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/chat/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        message: userQuery,
        response: botResponse,
        rating: rating,
      }),
    });

    if (res.ok) {
      
      if (rating === 1) {
        btn.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
        btn.style.color = "#10b981";
      } else {
        btn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
        btn.style.color = "#ef4444";
      }

      const parent = btn.parentElement;
      parent.querySelectorAll(".feedback-up, .feedback-down").forEach((b) => {
        b.disabled = true;
        b.style.pointerEvents = "none";
        if (b !== btn) {
          b.style.opacity = "0.3";
          b.style.filter = "grayscale(1)";
        }
      });

      showToast(
        rating === 1
          ? "Thanks for reflecting! 👍"
          : "Feedback noted. We'll improve! 📝",
        "info",
      );
    } else {
      const errData = await res.json();
      throw new Error(errData.detail || "Feedback failed");
    }
  } catch (e) {
    btn.innerHTML = originalContent;
    btn.disabled = false;
    console.error("Feedback error:", e);
    showToast(`Feedback Error: ${e.message}`, "error");
  }
}

function showTypingIndicator() {
  if (typingIndicator) {
    typingIndicator.classList.remove("hidden");
    scrollToBottom();
  }
}

function hideTypingIndicator() {
  if (typingIndicator) typingIndicator.classList.add("hidden");
}

function copyText(textContainer, btn) {
  let textToCopy = "";
  
  if (textContainer instanceof HTMLElement) {
    
    const clone = textContainer.cloneNode(true);
    const buttons = clone.querySelectorAll("button");
    buttons.forEach((b) => b.remove());
    textToCopy = clone.innerText;
  }
  
  else if (typeof textContainer === "string") {
    textToCopy = textContainer;
  }
  
  else if (textContainer.tagName === "BUTTON") {
    btn = textContainer; 
    const parent = btn.parentElement;
    const clone = parent.cloneNode(true);
    const copyBtnClone = clone.querySelector(".copy-btn");
    if (copyBtnClone) copyBtnClone.remove();
    textToCopy = clone.innerText;
  }

  navigator.clipboard
    .writeText(textToCopy.trim())
    .then(() => {
      const icon = btn.querySelector("i");
      if (icon) {
        const originalClass = icon.className;
        icon.className = "fa-solid fa-check";
        setTimeout(() => (icon.className = originalClass), 1500);
      }
    })
    .catch((err) => console.error("Failed to copy", err));
}

function formatText(text) {
  
  let safeText = escapeHtml(text);

  if (safeText.includes("[Map Link]")) {
    
    safeText = safeText.replace(
      "[Map Link]",
      `<a href="https://www.google.com/maps/search/?api=1&query=Sri+Venkateswara+University+Tirupati" target="_blank" class="map-link-btn"><i class="fa-solid fa-map-location-dot"></i> View on Map</a>`,
    );
  }

  return safeText
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>") 
    .replace(/\*(.*?)\*/g, "<i>$1</i>") 
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}

function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clearChat() {
  
  chatHistory = [];
  sessionStorage.removeItem("svu_chat_history");

  const messages = chatBox.querySelectorAll(".message");
  messages.forEach((msg) => msg.remove());

  if (welcomeScreen) welcomeScreen.style.display = "flex";
  const userInputEl = document.getElementById("user-input");
  if (userInputEl) {
    userInputEl.value = "";
    userInputEl.focus();
  }
}

const synth = window.speechSynthesis;
let currentSpeechBtn = null;
let currentHighlightedElement = null;
let originalHtmlContent = null;

let availableVoices = [];
function loadVoices() {
  availableVoices = synth.getVoices();
  console.log(`[TTS] Voices loaded: ${availableVoices.length}`);
}
loadVoices();
if (window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

// Global Speech Queue State
let speechState = {
  chunks: [],
  currentIndex: 0,
  spans: [],
  element: null,
  button: null,
  originalHtmlContent: null,
  currentUtterance: null,
  isCancelled: false,
  keepAliveInterval: null,
  sessionId: null
};

function resetSpeechState() {
  if (speechState.keepAliveInterval) {
    clearInterval(speechState.keepAliveInterval);
  }
  
  if (speechState.currentUtterance) {
    speechState.currentUtterance.onstart = null;
    speechState.currentUtterance.onboundary = null;
    speechState.currentUtterance.onend = null;
    speechState.currentUtterance.onerror = null;
  }
  
  if (speechState.element && speechState.originalHtmlContent) {
    speechState.element.innerHTML = speechState.originalHtmlContent;
  }
  
  if (speechState.button) {
    speechState.button.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    speechState.button.style.color = "";
  }
  
  speechState = {
    chunks: [],
    currentIndex: 0,
    spans: [],
    element: null,
    button: null,
    originalHtmlContent: null,
    currentUtterance: null,
    isCancelled: true,
    keepAliveInterval: null,
    sessionId: null
  };
  
  currentSpeechBtn = null;
  currentHighlightedElement = null;
  originalHtmlContent = null;
}

function getSpeechChunks(text) {
  const regex = /[^.!?\n]+[.!?\n]*/g;
  let match;
  const rawChunks = [];
  
  while ((match = regex.exec(text)) !== null) {
    const chunkText = match[0];
    const startIndex = match.index;
    if (chunkText.trim()) {
      rawChunks.push({
        text: chunkText,
        start: startIndex
      });
    }
  }
  
  if (rawChunks.length === 0 && text.trim()) {
    rawChunks.push({ text: text, start: 0 });
  }
  
  const finalChunks = [];
  for (const chunk of rawChunks) {
    if (chunk.text.length <= 150) {
      finalChunks.push(chunk);
    } else {
      const words = chunk.text.split(/(\s+)/);
      let currentSub = "";
      let subStart = chunk.start;
      
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (currentSub.length + word.length > 150) {
          if (currentSub.trim()) {
            finalChunks.push({
              text: currentSub,
              start: subStart
            });
          }
          subStart += currentSub.length;
          currentSub = word;
        } else {
          currentSub += word;
        }
      }
      if (currentSub.trim()) {
        finalChunks.push({
          text: currentSub,
          start: subStart
        });
      }
    }
  }
  return finalChunks;
}

function getTargetLangCode() {
  const selectedLang = document.getElementById("lang-select")?.value || "en";
  if (selectedLang === "te") return "te-IN";
  if (selectedLang === "hi") return "hi-IN";
  return "en-US";
}

function selectBestVoice() {
  if (availableVoices.length === 0) {
    availableVoices = synth.getVoices();
  }
  
  const selectedLang = document.getElementById("lang-select")?.value || "en";
  const targetLangCode = getTargetLangCode();
  
  let voiceKeywords = [
    "google us english",
    "microsoft zira",
    "samantha",
    "victoria",
    "ava",
    "female",
  ];

  if (selectedLang === "te") {
    voiceKeywords = [
      "shruti",
      "google telugu",
      "rani",
      "vani",
      "hema",
      "female",
    ];
  } else if (selectedLang === "hi") {
    voiceKeywords = ["swara", "google hindi", "kalpana", "heera", "female"];
  }

  const getVoiceScore = (voice) => {
    let score = 0;
    const nameLower = voice.name.toLowerCase();

    if (voice.lang === targetLangCode) score += 20;
    else if (voice.lang.split("-")[0] === selectedLang) score += 10;
    else return -1;

    for (const kw of voiceKeywords) {
      if (nameLower.includes(kw.toLowerCase())) {
        score += 5;
        if (kw === "natural") score += 10;
        if (kw === "premium") score += 10;
      }
    }

    if (nameLower.includes("microsoft") && nameLower.includes("online"))
      score += 15;

    return score;
  };

  const bestVoice = availableVoices
    .map((v) => ({ voice: v, score: getVoiceScore(v) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  let preferredVoice = bestVoice ? bestVoice.voice : null;

  // If selected language is English, try to get standard English voice
  if (!preferredVoice && selectedLang === "en") {
    preferredVoice = availableVoices.find(
      (v) =>
        v.name.includes("Zira") ||
        (v.name.includes("Google") && v.lang === "en-US"),
    );
  }

  // Fallback to first voice matching the language if possible
  if (!preferredVoice && availableVoices.length > 0) {
    preferredVoice = availableVoices.find((v) => v.lang.startsWith(selectedLang));
  }
  return preferredVoice;
}

function speakNextChunk() {
  if (speechState.isCancelled) return;
  
  if (speechState.currentIndex >= speechState.chunks.length) {
    console.log("[TTS] Finished all chunks.");
    resetSpeechState();
    return;
  }
  
  const chunk = speechState.chunks[speechState.currentIndex];
  const utterance = new SpeechSynthesisUtterance(chunk.text);
  utterance.sessionId = speechState.sessionId;
  speechState.currentUtterance = utterance;
  
  const preferredVoice = selectBestVoice();
  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang;
  } else {
    utterance.lang = getTargetLangCode();
  }
  
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  utterance.onboundary = (event) => {
    if (utterance.sessionId !== speechState.sessionId || speechState.isCancelled) return;
    if (event.name === "word" && speechState.element) {
      const absoluteCharIndex = chunk.start + event.charIndex;
      highlightWordAt(absoluteCharIndex, speechState.spans);
    }
  };
  
  utterance.onend = () => {
    if (utterance.sessionId !== speechState.sessionId || speechState.isCancelled) return;
    speechState.currentIndex++;
    speakNextChunk();
  };
  
  utterance.onerror = (e) => {
    console.error("[TTS] Utterance error:", e);
    if (utterance.sessionId !== speechState.sessionId || speechState.isCancelled) return;
    if (e.error === "interrupted") {
      return;
    }
    speechState.currentIndex++;
    setTimeout(speakNextChunk, 50);
  };
  
  try {
    if (speechState.keepAliveInterval) {
      clearInterval(speechState.keepAliveInterval);
    }
    
    speechState.keepAliveInterval = setInterval(() => {
      if (speechState.isCancelled) {
        clearInterval(speechState.keepAliveInterval);
        return;
      }
      if (synth && synth.speaking) {
        // Chromium keep-alive: pause and resume to reset Chrome's 15s timer
        synth.pause();
        synth.resume();
      }
    }, 10000);
    
    if (synth) {
      synth.speak(utterance);
    }
  } catch (err) {
    console.error("[TTS] Failed to speak chunk:", err);
    speechState.currentIndex++;
    setTimeout(speakNextChunk, 50);
  }
}

function speakText(text, element = null, button = null) {
  console.log("[TTS] speakText called");

  if (!window.speechSynthesis) {
    showStatusPopup("Your browser does not support Text-to-Speech.", 3000);
    return;
  }

  // Cancel any active STT listening when bot starts speaking
  stopSTT();

  const isSameElement = speechState.element === element;

  const wasSpeaking = synth && synth.speaking;
  if (synth) {
    try {
      synth.resume();
    } catch (e) {
      console.warn("[TTS] Error resuming before cancel:", e);
    }
    synth.cancel();
  }
  resetSpeechState();

  if (wasSpeaking && isSameElement && element !== null) {
    return;
  }

  speechState.isCancelled = false;
  speechState.sessionId = Math.random().toString(36).substring(2);
  speechState.element = element;
  speechState.button = button;

  if (button) {
    currentSpeechBtn = button;
    button.innerHTML = '<i class="fa-solid fa-stop"></i>';
    button.style.color = "#ef4444";
  }

  let textToSpeak = text;
  
  if (element) {
    currentHighlightedElement = element;
    speechState.originalHtmlContent = element.innerHTML;
    originalHtmlContent = element.innerHTML;

    const result = wrapWordsAndGetText(element);
    speechState.spans = result.spans;
    textToSpeak = result.fullText;
  } else {
    textToSpeak = text.replace(/[*#`]/g, "");
  }

  if (!textToSpeak.trim()) {
    console.warn("[TTS] Empty text, skipping");
    resetSpeechState();
    return;
  }

  speechState.chunks = getSpeechChunks(textToSpeak);
  speechState.currentIndex = 0;

  speakNextChunk();
}

function wrapWordsAndGetText(element) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue.length > 0) {
      // Exclude text nodes inside code blocks, scripts or styles
      let parent = node.parentNode;
      let inCode = false;
      while (parent && parent !== element) {
        const tag = parent.tagName.toLowerCase();
        if (tag === "code" || tag === "pre" || tag === "script" || tag === "style") {
          inCode = true;
          break;
        }
        parent = parent.parentNode;
      }
      if (!inCode) {
        textNodes.push(node);
      }
    }
  }

  const allSpans = [];
  let fullText = "";
  let runningCharCount = 0;

  textNodes.forEach((textNode) => {
    const originalText = textNode.nodeValue;
    const parts = originalText.split(/(\s+)/);
    const fragment = document.createDocumentFragment();

    parts.forEach((part) => {
      if (part.length === 0) return;

      if (/^\s+$/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
        fullText += part;
        runningCharCount += part.length;
      } else {
        const span = document.createElement("span");
        span.textContent = part;
        span.dataset.start = runningCharCount;
        span.dataset.end = runningCharCount + part.length;
        span.className = "speech-word";
        fragment.appendChild(span);
        allSpans.push(span);

        fullText += part;
        runningCharCount += part.length;
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });

  return { spans: allSpans, fullText: fullText };
}

function highlightWordAt(charIndex, spans) {
  if (!speechState.element) return;

  const active = speechState.element.querySelector(".speaking-word");
  if (active) active.classList.remove("speaking-word");

  let targetSpan = spans.find((span) => {
    const start = parseInt(span.dataset.start);
    const end = parseInt(span.dataset.end);
    return charIndex >= start && charIndex < end;
  });

  if (!targetSpan) {
    targetSpan = spans.find(
      (span) => parseInt(span.dataset.start) === charIndex,
    );
  }

  if (!targetSpan) {
    let closest = null;
    let minDiff = 5;

    spans.forEach((span) => {
      const start = parseInt(span.dataset.start);
      const diff = Math.abs(start - charIndex);
      if (diff < minDiff) {
        minDiff = diff;
        closest = span;
      }
    });
    targetSpan = closest;
  }

  if (targetSpan) {
    targetSpan.classList.add("speaking-word");
  }
}

function resetHighlighting() {
  resetSpeechState();
}

// Unified Speech-to-Text Manager
let activeSpeechRecognition = null;
let activeSTTListening = false;
let activeSTTInputElement = null;
let activeSTTMicButtonElement = null;

function toggleSTT(inputElement, micButtonElement, onResultCallback) {
  // Cancel active TTS before starting STT
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      console.warn("[TTS] Error cancelling:", e);
    }
    resetSpeechState();
  }

  if (activeSTTListening && activeSpeechRecognition) {
    stopSTT();
    return;
  }

  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    showStatusPopup("Speech-to-Text is not supported in this browser.", 3000);
    return;
  }

  activeSTTInputElement = inputElement;
  activeSTTMicButtonElement = micButtonElement;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognizer = new SpeechRecognition();

  recognizer.continuous = false;
  recognizer.interimResults = false;

  const langSelect = document.getElementById("lang-select");
  const selectedLang = langSelect ? langSelect.value : "en";
  const langMap = {
    en: "en-US",
    te: "te-IN",
    hi: "hi-IN",
  };
  recognizer.lang = langMap[selectedLang] || "en-US";
  console.log(`[STT] Initialized for: ${recognizer.lang}`);

  recognizer.onstart = () => {
    activeSTTListening = true;
    if (micButtonElement) {
      micButtonElement.classList.add("listening");
      micButtonElement.classList.add("active");
    }
    if (inputElement) {
      if (!inputElement.dataset.originalPlaceholder) {
        inputElement.dataset.originalPlaceholder = inputElement.placeholder || "";
      }
      inputElement.placeholder = "Listening... Speak now";
    }
  };

  recognizer.onend = () => {
    // If not already set to null by stopSTT
    if (activeSpeechRecognition === recognizer) {
      activeSTTListening = false;
      if (micButtonElement) {
        micButtonElement.classList.remove("listening");
        micButtonElement.classList.remove("active");
      }
      if (inputElement) {
        inputElement.placeholder = inputElement.dataset.originalPlaceholder || "Ask anything... (Type or Speak)";
      }
      activeSpeechRecognition = null;
      activeSTTInputElement = null;
      activeSTTMicButtonElement = null;
    }
  };

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log(`[STT] Heard: "${transcript}"`);
    if (inputElement) {
      inputElement.value = transcript;
    }
    if (onResultCallback) {
      onResultCallback(transcript);
    }
  };

  recognizer.onerror = (event) => {
    console.error("[STT] Error:", event.error);
    activeSTTListening = false;
    if (micButtonElement) {
      micButtonElement.classList.remove("listening");
      micButtonElement.classList.remove("active");
    }
    if (inputElement) {
      inputElement.placeholder = inputElement.dataset.originalPlaceholder || "Ask anything... (Type or Speak)";
    }
    
    if (event.error === "not-allowed") {
      showStatusPopup("Microphone access denied. Please enable permissions.", 4000);
    } else if (event.error === "no-speech") {
      showStatusPopup("No speech detected. Please try again.", 2000);
    } else if (event.error === "network") {
      showStatusPopup("Network error. Please check your internet connection.", 3000);
    }
  };

  activeSpeechRecognition = recognizer;
  try {
    recognizer.start();
  } catch (e) {
    console.error("[STT] Failed to start recognition:", e);
    activeSTTListening = false;
    activeSpeechRecognition = null;
    activeSTTInputElement = null;
    activeSTTMicButtonElement = null;
  }
}

function stopSTT() {
  if (activeSpeechRecognition) {
    try {
      activeSpeechRecognition.abort();
    } catch (e) {
      console.warn("[STT] Error aborting:", e);
    }
    activeSpeechRecognition = null;
  }
  activeSTTListening = false;
  
  if (activeSTTMicButtonElement) {
    activeSTTMicButtonElement.classList.remove("listening");
    activeSTTMicButtonElement.classList.remove("active");
  }
  if (activeSTTInputElement) {
    activeSTTInputElement.placeholder = activeSTTInputElement.dataset.originalPlaceholder || "Ask anything... (Type or Speak)";
  }
  activeSTTInputElement = null;
  activeSTTMicButtonElement = null;
}

const micBtn = document.getElementById("mic-btn");
let recognition = null;
let isListening = false;

function initializeSTT() {
  return null;
}

function toggleVoiceInput() {
  const userInputEl = document.getElementById("user-input");
  const micBtnEl = document.getElementById("mic-btn");
  toggleSTT(userInputEl, micBtnEl, (transcript) => {
    setTimeout(() => sendMessage(), 500);
  });
}

function stopVoiceInput() {
  stopSTT();
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (end - start) + start);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

function scrollToBottom() {
  const chatBox = document.getElementById("chat-box");
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

