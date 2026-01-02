const API_URL = "";

// DOM Elements
const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const typingIndicator = document.getElementById('typing-indicator');

// Theme Logic
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('dark-mode');

    // Update Icon and Text
    updateThemeUI(body.classList.contains('dark-mode'));

    // Save preference
    localStorage.setItem('svu_theme', body.classList.contains('dark-mode') ? 'dark' : 'light');
}

function updateThemeUI(isDark) {
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

// Splash Screen Logic
document.addEventListener("DOMContentLoaded", () => {
    // Load Theme
    const savedTheme = localStorage.getItem('svu_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        updateThemeUI(true);
    }

    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        setTimeout(() => {
            splashScreen.classList.add('fade-out');
            setTimeout(() => {
                splashScreen.style.display = 'none';
            }, 800);
        }, 1500);
    }

    // Focus input on load
    if (userInput) userInput.focus();

    // Load Chat History
    loadChatHistory();
});

// Chat History State
let chatHistory = JSON.parse(localStorage.getItem('svu_chat_history') || '[]');

function loadChatHistory() {
    if (chatHistory.length > 0 && welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }
    chatHistory.forEach(msg => appendMessage(msg.text, msg.sender, false));
    if (chatHistory.length > 0) scrollToBottom();
}

function showSection(sectionId) {
    document.getElementById('chat-section').style.display = sectionId === 'chat' ? 'flex' : 'none';
    document.getElementById('admin-section').style.display = sectionId === 'admin' ? 'block' : 'none';
    document.getElementById('nav-chat').classList.toggle('active', sectionId === 'chat');
    document.getElementById('nav-admin').classList.toggle('active', sectionId === 'admin');
    if (sectionId === 'admin') loadFAQs();
}

// Chat Logic
if (userInput) {
    userInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });
}

function appendQuick(text) {
    userInput.value = text;
    sendMessage();
}

async function sendMessage() {
    const text = userInput.value?.trim();
    if (!text) return;

    // Hide welcome screen if visible
    if (welcomeScreen && welcomeScreen.style.display !== 'none') {
        welcomeScreen.style.display = 'none';
    }

    // Add user message
    appendMessage(text, 'user');
    userInput.value = '';

    // Show typing indicator
    showTypingIndicator();

    // Scroll to bottom
    scrollToBottom();

    // Get Session ID (if using session history)
    let sessionId = localStorage.getItem('chat_session_id');
    if (!sessionId) {
        sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('chat_session_id', sessionId);
    }

    try {
        const response = await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, session_id: sessionId })
        });

        if (!response.ok) throw new Error('Backend unavailable');
        const data = await response.json();

        // Hide typing indicator before showing response
        hideTypingIndicator();

        appendMessage(data.response || "I'm having trouble connecting right now.", 'bot');

    } catch (err) {
        hideTypingIndicator();
        appendMessage("I apologize, but I'm unable to reach the server at the moment. Please try again later.", 'bot');
    }

    scrollToBottom();
}

function appendMessage(text, sender, save = true) {
    if (save) {
        chatHistory.push({ text, sender });
        localStorage.setItem('svu_chat_history', JSON.stringify(chatHistory));
    }

    const div = document.createElement('div');
    div.classList.add('message', sender);

    if (sender === 'bot') {
        const botIconDiv = document.createElement('div');
        botIconDiv.className = 'bot-icon';
        // Placeholder or actual bot avatar
        botIconDiv.innerHTML = '<img src="/static/images/bot_avatar.svg" alt="Bot" style="width: 100%; height: 100%;">';

        const textDiv = document.createElement('div');
        textDiv.className = 'text';
        textDiv.innerHTML = formatText(text);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'msg-actions';

        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'speech-btn';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
        copyBtn.title = 'Copy Text';
        copyBtn.onclick = () => copyText(textDiv, copyBtn); // Pass element reference

        // Speak Button
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speech-btn';
        speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        speakBtn.title = 'Read Aloud';
        speakBtn.onclick = () => speakText(text); // Use global speakText

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(speakBtn);

        textDiv.appendChild(actionsDiv);

        div.appendChild(botIconDiv);
        div.appendChild(textDiv);
    } else {
        const textDiv = document.createElement('div');
        textDiv.className = 'text';
        textDiv.textContent = text;

        // Copy Button for User
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'msg-actions user-actions';
        actionsDiv.style.justifyContent = 'flex-end'; // Align to right for user

        const copyBtn = document.createElement('button');
        copyBtn.className = 'speech-btn';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
        copyBtn.title = 'Copy Text';
        copyBtn.style.color = '#64748b'; // Darker gray for visibility on user bubble
        copyBtn.onclick = () => copyText(textDiv, copyBtn);

        actionsDiv.appendChild(copyBtn);
        textDiv.appendChild(actionsDiv);

        div.appendChild(textDiv);
    }

    // Insert before typing indicator
    if (typingIndicator) {
        chatBox.insertBefore(div, typingIndicator);
    } else {
        chatBox.appendChild(div);
    }
}

function showTypingIndicator() {
    if (typingIndicator) {
        typingIndicator.style.display = 'flex';
        scrollToBottom();
    }
}

function hideTypingIndicator() {
    if (typingIndicator) typingIndicator.style.display = 'none';
}

function scrollToBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
}

function copyText(textContainer, btn) {
    let textToCopy = "";
    // If called from the new speech UI, textContainer is the DIV element
    if (textContainer instanceof HTMLElement) {
        // Clone to strip out any buttons (like speak/copy) before copying text
        const clone = textContainer.cloneNode(true);
        const buttons = clone.querySelectorAll('button');
        buttons.forEach(b => b.remove());
        textToCopy = clone.innerText;
    }
    // Fallback for any legacy calls (just in case)
    else if (typeof textContainer === 'string') {
        textToCopy = textContainer;
    }
    // Legacy button-only call (from old structure if it existed)
    else if (textContainer.tagName === 'BUTTON') {
        btn = textContainer; // The first arg was actually the button
        const parent = btn.parentElement;
        const clone = parent.cloneNode(true);
        const copyBtnClone = clone.querySelector('.copy-btn');
        if (copyBtnClone) copyBtnClone.remove();
        textToCopy = clone.innerText;
    }

    navigator.clipboard.writeText(textToCopy.trim()).then(() => {
        const icon = btn.querySelector('i');
        if (icon) {
            const originalClass = icon.className;
            icon.className = 'fa-solid fa-check';
            setTimeout(() => icon.className = originalClass, 1500);
        }
    }).catch(err => console.error('Failed to copy', err));
}



function formatText(text) {
    // Basic formatting: URLs to links, newlines to <br>
    let safeText = escapeHtml(text);
    safeText = safeText.replace(/\n/g, '<br>');
    safeText = safeText.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#0f766e;text-decoration:underline;">$1</a>');
    // Bold logic (simple **text**)
    safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return safeText;
}

function escapeHtml(text) {
    return (text || '').replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function clearChat() {
    // Clear History
    chatHistory = [];
    localStorage.removeItem('svu_chat_history');

    // Reset to welcome state
    // Remove all messages except welcome screen and typing indicator
    const messages = chatBox.querySelectorAll('.message');
    messages.forEach(msg => msg.remove());

    if (welcomeScreen) welcomeScreen.style.display = 'flex';
    userInput.value = '';
    userInput.focus();
}

// --- Voice Assistant Implementation ---

// 1. Text-to-Speech (TTS)
const synth = window.speechSynthesis;
let isSpeaking = false;

function speakText(text) {
    if (synth.speaking) {
        synth.cancel(); // Stop currently playing
        isSpeaking = false;
        return;
    }

    // Strip markdown symbols for cleaner speech
    const cleanText = text.replace(/\*/g, '').replace(/#/g, '').replace(/`/g, '');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-IN'; // Indian English context
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => { isSpeaking = true; };
    utterance.onend = () => { isSpeaking = false; };

    synth.speak(utterance);
}

// 2. Speech-to-Text (STT)
const micBtn = document.getElementById('mic-btn');
let recognition;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        micBtn.classList.add('listening');
        userInput.placeholder = "Listening...";
    };

    recognition.onend = () => {
        micBtn.classList.remove('listening');
        userInput.placeholder = "Ask anything... (Type or Speak)";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        sendMessage(); // Auto-send on voice input
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        stopVoiceInput();
    };
} else {
    if (micBtn) micBtn.style.display = 'none'; // Hide if not supported
    console.log("Web Speech API not supported in this browser.");
}

function toggleVoiceInput() {
    if (!recognition) return;
    if (micBtn.classList.contains('listening')) {
        recognition.stop();
    } else {
        recognition.start();
    }
}

function stopVoiceInput() {
    if (recognition) recognition.stop();
}
// --- End Voice Assistant ---

// Admin Logic
// Global variable to store FAQs
let allFAQs = [];

async function loadFAQs() {
    try {
        const res = await fetch(`${API_URL}/faqs`);
        if (!res.ok) return;
        allFAQs = await res.json();
        renderFAQs(allFAQs);
    } catch (e) { console.error(e); }
}

function renderFAQs(faqsToRender) {
    const list = document.getElementById('faq-list');
    if (!list) return;

    list.innerHTML = '';
    if (faqsToRender.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#64748b; margin-top: 20px;">No FAQs found matching your search.</p>';
        return;
    }

    faqsToRender.forEach(item => {
        list.innerHTML += `
            <div class="faq-card">
                <h4>${escapeHtml(item.question)}</h4>
                <p>${escapeHtml(item.answer)}</p>
            </div>`;
    });
}

// Admin Search Listener
const adminSearchInput = document.getElementById('admin-search-input');
if (adminSearchInput) {
    adminSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allFAQs.filter(item =>
            (item.question && item.question.toLowerCase().includes(query)) ||
            (item.answer && item.answer.toLowerCase().includes(query))
        );
        renderFAQs(filtered);
    });
}

const modal = document.getElementById("faq-modal");
function openModal() { if (modal) modal.style.display = 'block'; }
function closeModal() { if (modal) modal.style.display = 'none'; }

async function saveFAQ() {
    // Stub for saving FAQ - would implement POST request here
    closeModal();
    loadFAQs();
}

// Locations Logic
const locations = [
    "Sri Venkateswara University, Tirupati",
    "Computer Centre",
    "Department of Adult & Continuing Education",
    "Department of Ancient Indian History, Culture & Archaeology",
    "Department of Biochemistry",
    "Department of Biotechnology",
    "Department of Botany",
    "Department of Chemical Engineering",
    "Department of Chemistry",
    "Department of Civil Engineering",
    "Department of Commerce",
    "Department of Computer Science",
    "Department of Data Science",
    "Department of Econometrics",
    "Department of Economics",
    "Department of Education",
    "Department of Electrical & Electronics Engineering (EEE)",
    "Department of Electronics",
    "Department of Electronics & Communication Engineering (ECE)",
    "Department of English",
    "Department of Foreign Languages & Linguistics",
    "Department of Geography",
    "Department of Geology",
    "Department of Hindi",
    "Department of History",
    "Department of Home Science",
    "Department of Industrial Fisheries",
    "Department of Journalism and Mass Communication",
    "Department of Law",
    "Department of Management Studies (MBA)",
    "Department of Mathematics",
    "Department of Mechanical Engineering",
    "Department of Microbiology",
    "Department of Performing Arts",
    "Department of Philosophy",
    "Department of Physical Education",
    "Department of Physics",
    "Department of Political Science & Public Administration",
    "Department of Population Studies & Social Work",
    "Department of Psychology",
    "Department of Sanskrit",
    "Department of Sociology",
    "Department of Statistics",
    "Department of Tamil",
    "Department of Telugu Studies",
    "Department of Urdu",
    "Department of Virology",
    "Department of Zoology",
    "Directorate of Distance Education (DDE)",
    "Health Center",
    "Hostels",
    "Internal Quality Assurance Cell (IQAC)",
    "Srinivasa Auditorium",
    "SVU Central Library",
    "SVU College of Arts",
    "SVU College of Commerce, Management & Computer Science",
    "SVU College of Engineering",
    "SVU College of Pharmaceutical Sciences",
    "SVU College of Sciences",
    "SVU Oriental Research Institute",
    "Tarakarama Stadium",
    "University Scientific Instrumentation Centre (USIC)"
];

const locationsModal = document.getElementById('locations-modal');
const locationsListEl = document.getElementById('locations-list');

function openLocations() {
    if (locationsListEl) {
        locationsListEl.innerHTML = '';
        locations.forEach(name => {
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = name;
            a.onclick = (e) => { e.preventDefault(); openLocationMap(name); };
            locationsListEl.appendChild(a);
        });
    }
    if (locationsModal) locationsModal.style.display = 'flex';
}

function closeLocations() { if (locationsModal) locationsModal.style.display = 'none'; }

function openLocationMap(name) {
    const query = `${name}, Sri Venkateswara University, Tirupati, Andhra Pradesh`;
    const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
    window.open(url, '_blank');
}