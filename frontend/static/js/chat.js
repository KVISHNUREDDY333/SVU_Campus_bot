async function sendMessage() {
  
  if (currentChatController) {
    console.warn("User cancelled generation early.");
    currentChatController.abort();
    currentChatController = null;
    hideTypingIndicator();
    setChatButtonState(false);
    return;
  }

  const text = userInput.value?.trim();
  if (!text) return;

  if (welcomeScreen && welcomeScreen.style.display !== "none") {
    welcomeScreen.style.display = "none";
  }

  appendMessage(text, "user", true);
  userInput.value = "";

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


if (userInput) {
  userInput.addEventListener("keypress", (e) => {
    
    if (e.key === "Enter") {
      e.preventDefault();
      if (!currentChatController) {
        sendMessage();
      }
    }
  });
}

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
  userInput.value = "";
  userInput.focus();
}

const synth = window.speechSynthesis;
let currentSpeechBtn = null;
let currentUtterance = null; 
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

function speakText(text, element = null, button = null) {
  console.log("[TTS] speakText called");

  if (!window.speechSynthesis) {
    showStatusPopup("Your browser does not support Text-to-Speech.", 3000);
    return;
  }

  if (synth.speaking || currentHighlightedElement) {
    
    const isSameElement = currentHighlightedElement === element;

    resetHighlighting();
    synth.cancel();

    if (isSameElement) {
      return;
    }
  }

  if (button) {
    currentSpeechBtn = button;
    button.innerHTML = '<i class="fa-solid fa-stop"></i>';
    button.style.color = "#ef4444";
  }

  let textToSpeak = text;
  let spans = [];

  if (element) {
    currentHighlightedElement = element;
    originalHtmlContent = element.innerHTML;

    const result = wrapWordsAndGetText(element);
    spans = result.spans;
    textToSpeak = result.fullText;
  } else {
    textToSpeak = text.replace(/[*#`]/g, "");
  }

  if (!textToSpeak.trim()) {
    console.warn("[TTS] Empty text, skipping");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(textToSpeak);

  if (availableVoices.length === 0) {
    availableVoices = synth.getVoices();
  }

  const selectedLang = document.getElementById("lang-select")?.value || "en";
  let targetLangCode = "en-US";
  
  let voiceKeywords = [
    "google us english",
    "microsoft zira",
    "samantha",
    "victoria",
    "ava",
    "female",
  ];

  if (selectedLang === "te") {
    targetLangCode = "te-IN";
    
    voiceKeywords = [
      "shruti",
      "google telugu",
      "rani",
      "vani",
      "hema",
      "female",
    ];
  } else if (selectedLang === "hi") {
    targetLangCode = "hi-IN";
    
    voiceKeywords = ["swara", "google hindi", "kalpana", "heera", "female"];
  }

  console.log(`[TTS] Target Lang: ${targetLangCode}`);

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

  if (!preferredVoice && selectedLang !== "en") {
    console.warn(
      `[TTS] No voice found for ${selectedLang}, falling back to English.`,
    );
    preferredVoice = availableVoices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Female") || v.name.includes("Google")),
    );
  }

  if (!preferredVoice && selectedLang === "en") {
    
    preferredVoice = availableVoices.find(
      (v) =>
        v.name.includes("Zira") ||
        (v.name.includes("Google") && v.lang === "en-US"),
    );
  }

  if (!preferredVoice && availableVoices.length > 0) {
    
    preferredVoice =
      availableVoices.find((v) => v.lang.startsWith(selectedLang)) ||
      availableVoices[0];
  }

  if (preferredVoice) {
    console.log(
      `[TTS] Using voice: ${preferredVoice.name} (${preferredVoice.lang})`,
    );
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang;
  } else {
    
    utterance.lang = targetLangCode;
  }

  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  currentUtterance = utterance;

  if (element) {
    utterance.onboundary = (event) => {
      if (event.name === "word") {
        highlightWordAt(event.charIndex, spans);
      }
    };

    utterance.onend = () => {
      console.log("[TTS] Finished");
      resetHighlighting();
    };

    utterance.onerror = (e) => {
      console.error("[TTS] Utterance Error:", e);
      resetHighlighting();
    };
  }

  console.log("[TTS] Executing commands...");
  try {
    
    synth.cancel();

    const speechTimeout = setTimeout(() => {
      if (synth.speaking) return; 
      console.warn("[TTS] Speech didn't start, forcing resume...");
      synth.cancel();
      synth.resume();
      synth.speak(utterance);
    }, 300);

    synth.speak(utterance);
  } catch (e) {
    console.error("[TTS] Exception during speak:", e);
    showStatusPopup("Audio Engine Error. Please refresh.", 3000);
  }
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
      
      textNodes.push(node);
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
  if (!currentHighlightedElement) return;

  const active = currentHighlightedElement.querySelector(".speaking-word");
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
  if (currentHighlightedElement && originalHtmlContent) {
    currentHighlightedElement.innerHTML = originalHtmlContent;
  }
  if (currentSpeechBtn) {
    currentSpeechBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  }
  currentHighlightedElement = null;
  originalHtmlContent = null;
  currentUtterance = null;
  currentSpeechBtn = null;
}

const micBtn = document.getElementById("mic-btn");
let recognition = null;
let isListening = false; 

function initializeSTT() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    if (micBtn) micBtn.style.display = "none";
    console.warn("Web Speech API not supported.");
    return null;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
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
  console.log(`[STT] Initialized for language: ${recognizer.lang}`);

  recognizer.onstart = () => {
    isListening = true;
    micBtn.classList.add("listening");
    
    userInput.placeholder = "Listening... Speak now";
  };

  recognizer.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    
    userInput.placeholder = "Ask anything... (Type or Speak)";
  };

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log(`[STT] Heard: "${transcript}"`);
    userInput.value = transcript;

    setTimeout(() => sendMessage(), 500);
  };

  recognizer.onerror = (event) => {
    console.error("Speech recognition error", event.error);
    isListening = false;
    micBtn.classList.remove("listening");

    if (event.error === "not-allowed") {
      showStatusPopup(
        "Microphone access denied. Please enable permissions.",
        4000,
      );
    } else if (event.error === "no-speech") {
      showStatusPopup("No speech detected. Please try again.", 2000);
    }
  };

  return recognizer;
}

function toggleVoiceInput() {
  
  if (isListening && recognition) {
    recognition.stop();
    return;
  }

  recognition = initializeSTT();

  if (recognition) {
    try {
      recognition.start();
    } catch (e) {
      console.error("Failed to start recognition:", e);
      
    }
  }
}

function stopVoiceInput() {
  if (recognition && isListening) {
    recognition.stop();
  }
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

