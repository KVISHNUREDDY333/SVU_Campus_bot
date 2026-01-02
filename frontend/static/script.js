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
// Auth State
let ACCESS_TOKEN = localStorage.getItem('access_token');
let USER_ROLE = localStorage.getItem('user_role');

document.addEventListener("DOMContentLoaded", () => {
    // Check Auth first
    checkAuth();

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js')
            .then(reg => console.log('SW Registered', reg))
            .catch(err => console.log('SW Fail', err));
    }

    // Request Notification Permission
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

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

    if (userInput) userInput.focus();
    loadChatHistory();
});

// --- Auth Functions ---
function checkAuth() {
    const overlay = document.getElementById('auth-overlay');

    if (!ACCESS_TOKEN) {
        if (overlay) overlay.classList.add('active');
    } else {
        if (overlay) overlay.classList.remove('active');
        // Optional: verify token validity with backend /users/me here
    }
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const forgotForm = document.getElementById('forgot-form'); // New
    const tabs = document.querySelectorAll('.auth-tab');

    document.getElementById('auth-error').style.display = 'none';

    if (tab === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        forgotForm.style.display = 'none';
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        forgotForm.style.display = 'none';
        tabs[0].classList.remove('active');
        tabs[1].classList.add('active');
    }
}

function showForgotPassword() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'block';
    document.getElementById('auth-error').style.display = 'none';
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const errorEl = document.getElementById('auth-error');

    try {
        const res = await fetch(`${API_URL}/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: email })
        });

        const data = await res.json();
        if (data.status === 'success') {
            document.getElementById('step-email').style.display = 'none';
            document.getElementById('step-otp').style.display = 'block';
            errorEl.style.display = 'none';
        } else {
            throw new Error(data.message || 'Failed to send OTP');
        }
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const otp = document.getElementById('forgot-otp').value;
    const newPassword = document.getElementById('forgot-new-password').value;
    const errorEl = document.getElementById('auth-error');

    try {
        const res = await fetch(`${API_URL}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: email, otp, new_password: newPassword })
        });

        const data = await res.json();
        if (data.status === 'success') {
            alert('Password reset successful! Please log in.');
            location.reload();
        } else {
            throw new Error(data.detail || 'Failed to reset password');
        }
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('auth-error');

    try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });

        if (!res.ok) throw new Error('Invalid credentials');

        const data = await res.json();
        saveSession(data);
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const fullName = document.getElementById('reg-fullname').value;
    const role = document.getElementById('reg-role').value;
    const password = document.getElementById('reg-password').value;
    const errorEl = document.getElementById('auth-error');

    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, full_name: fullName, role, password })
        });

        if (!res.ok) {
            const errData = await res.json();
            if (errData.detail === "Username already registered") {
                errorEl.textContent = "This email is already registered. Please log in.";
                errorEl.style.display = 'block';
                setTimeout(() => switchAuthTab('login'), 2000);
                return;
            }
            throw new Error(errData.detail || 'Registration failed');
        }

        const data = await res.json();
        saveSession(data);
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    }
}

function saveSession(data) {
    ACCESS_TOKEN = data.access_token;
    USER_ROLE = data.role;
    localStorage.setItem('access_token', ACCESS_TOKEN);
    localStorage.setItem('user_role', USER_ROLE);
    localStorage.setItem('username', data.username);

    document.getElementById('auth-overlay').classList.remove('active');

    // Refresh admin view if admin
    if (USER_ROLE === 'admin') {
        // Show extra admin controls if any
    }
}

function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('username');
    ACCESS_TOKEN = null;
    location.reload();
}

// Chat History State
let chatHistory = JSON.parse(localStorage.getItem('svu_chat_history') || '[]');

function loadChatHistory() {
    if (chatHistory.length > 0 && welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }
    chatHistory.forEach(msg => appendMessage(msg.text, msg.sender, false));
    if (chatHistory.length > 0) scrollToBottom();
}

// ... existing code ...

const incognitoToggle = document.getElementById('incognito-toggle');
let isIncognito = false;

if (incognitoToggle) {
    incognitoToggle.addEventListener('change', (e) => {
        isIncognito = e.target.checked;
        if (isIncognito) {
            document.body.classList.add('incognito-active');
            appendMessage("Entered Incognito Mode. Your chats will not be saved.", "bot");
        } else {
            document.body.classList.remove('incognito-active');
            appendMessage("Exited Incognito Mode.", "bot");
        }
    });
}

// Polling for Notifications
setInterval(checkNotifications, 10000); // Check every 10 seconds for demo

async function checkNotifications() {
    if (!ACCESS_TOKEN) return;

    try {
        const res = await fetch(`${API_URL}/notifications`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;

        const notifications = await res.json();
        // Simple logic: if new notification ID is greater than last seen, show toast
        const lastSeenId = parseInt(localStorage.getItem('last_notification_id') || '0');

        notifications.forEach(notif => {
            if (notif.id > lastSeenId) {
                showToast(notif.title, notif.message);
                localStorage.setItem('last_notification_id', notif.id);
            }
        });
    } catch (e) {
        // console.error("Notification Poll Error", e);
    }
}

function showToast(title, message) {
    // Create toast container if needed
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10001;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `
        <div class="toast-header">
            <strong class="me-auto">${title}</strong>
            <button type="button" class="btn-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
        <div class="toast-body">${message}</div>
    `;

    // Inline styles for toast (can move to css)
    toast.style.cssText = `
        background: white;
        border-left: 4px solid #0f766e;
        padding: 15px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        min-width: 250px;
        animation: slideIn 0.3s ease-out;
        color: #333;
    `;

    // Basic styling for internal elements
    const header = toast.querySelector('.toast-header');
    header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; color: #0f766e;";

    const btn = toast.querySelector('.btn-close');
    btn.style.cssText = "background: none; border: none; font-size: 20px; cursor: pointer; color: #666; width:auto; border-radius:0;";

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 5000);

    // Browser Notification
    if (Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '/static/images/svu_logo_final_v2.jpg' });
    }
}

function showSection(sectionId) {
    document.getElementById('chat-section').style.display = 'none';
    document.getElementById('admin-section').style.display = 'none'; // Legacy ID might be replaced
    document.getElementById('dashboard-section').style.display = 'none';

    document.getElementById('nav-chat').classList.remove('active');
    document.getElementById('nav-admin').classList.remove('active'); // Legacy
    document.getElementById('nav-dashboard').classList.remove('active');

    if (sectionId === 'chat') {
        document.getElementById('chat-section').style.display = 'flex';
        document.getElementById('nav-chat').classList.add('active');
    } else if (sectionId === 'dashboard') {
        document.getElementById('dashboard-section').style.display = 'block';
        document.getElementById('nav-dashboard').classList.add('active');
        loadDashboard(); // Load stats
        loadFAQs(); // Load FAQs (shared view)
    }
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                message: text,
                session_id: sessionId,
                incognito: isIncognito
            })
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

function saveSession(data) {
    // ... existing ...

    if (USER_ROLE === 'admin') {
        document.getElementById('nav-dashboard').style.display = 'block'; // Show dashboard link
    }
}

// Analytics Chart
let roleChartInstance = null;

async function loadDashboard() {
    try {
        const res = await fetch(`${API_URL}/dashboard-stats`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;

        const data = await res.json();

        document.getElementById('total-queries').textContent = data.total_queries;
        document.getElementById('active-users').textContent = data.active_users;

        renderChart(data.role_distribution);
    } catch (e) {
        console.error("Dashboard Error", e);
    }
}

function renderChart(roleData) {
    const ctx = document.getElementById('roleChart').getContext('2d');

    if (roleChartInstance) roleChartInstance.destroy();

    roleChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(roleData),
            datasets: [{
                data: Object.values(roleData),
                backgroundColor: ['#0f766e', '#f59e0b', '#ef4444'],
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                title: { display: true, text: 'Queries by User Role' }
            }
        }
    });
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
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
        speakBtn.onclick = () => speakText(text, textDiv); // Pass element for highlighting

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
// 1. Text-to-Speech (TTS)
const synth = window.speechSynthesis;
let currentUtterance = null;
let currentHighlightedElement = null;
let originalHtmlContent = null;

function speakText(text, element = null) {
    // 1. Cancel existing speech
    if (synth.speaking || currentHighlightedElement) {
        resetHighlighting();
        synth.cancel();

        // If clicking the same button, just stop
        if (currentHighlightedElement === element) {
            currentHighlightedElement = null;
            return;
        }
    }

    // 2. Setup Highlighting & Text Construction
    let textToSpeak = text;
    let spans = [];

    if (element) {
        currentHighlightedElement = element;
        originalHtmlContent = element.innerHTML;

        // Wrap words and get the EXACT text that matches the DOM structure
        const result = wrapWordsAndGetText(element);
        spans = result.spans;
        textToSpeak = result.fullText; // This is the key for perfect alignment
    } else {
        // Fallback for non-element text (clean markdown)
        textToSpeak = text.replace(/\*/g, '').replace(/#/g, '').replace(/`/g, '');
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'en-IN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    currentUtterance = utterance;

    if (element) {
        utterance.onboundary = (event) => {
            if (event.name === 'word') {
                highlightWordAt(event.charIndex, spans);
            }
        };

        utterance.onend = () => resetHighlighting();
        utterance.onerror = (e) => {
            console.error("TTS Error:", e);
            resetHighlighting();
        };
    }

    synth.speak(utterance);
}

function wrapWordsAndGetText(element) {
    // We use a TreeWalker to find all text nodes
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeValue.length > 0) { // Keep all text nodes including pure whitespace for structure
            textNodes.push(node);
        }
    }

    const allSpans = [];
    let fullText = "";
    let runningCharCount = 0;

    textNodes.forEach(textNode => {
        const originalText = textNode.nodeValue;
        // Split by whitespace but keep delimiters
        const parts = originalText.split(/(\s+)/);

        const fragment = document.createDocumentFragment();

        parts.forEach(part => {
            if (part.length === 0) return;

            // Check if it's purely whitespace
            if (/^\s+$/.test(part)) {
                fragment.appendChild(document.createTextNode(part));
                fullText += part;
                runningCharCount += part.length;
            } else {
                // It's a word
                const span = document.createElement('span');
                span.textContent = part;
                span.dataset.start = runningCharCount;
                span.dataset.end = runningCharCount + part.length;
                span.className = 'speech-word';
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
    // Remove previous highlights
    const active = document.querySelector('.highlight-word');
    if (active) active.classList.remove('highlight-word');

    // Find the span that covers this charIndex
    const targetSpan = spans.find(span => {
        const start = parseInt(span.dataset.start);
        const end = parseInt(span.dataset.end);
        // Strict match works better since we aligned text manually
        return charIndex >= start && charIndex < end;
    });

    if (targetSpan) {
        targetSpan.classList.add('highlight-word');
    }
}

function resetHighlighting() {
    if (currentHighlightedElement && originalHtmlContent) {
        currentHighlightedElement.innerHTML = originalHtmlContent;
    }
    currentHighlightedElement = null;
    originalHtmlContent = null;
    currentUtterance = null;
}

// 2. Speech-to-Text (STT)
const micBtn = document.getElementById('mic-btn');
let recognition;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false; // changed to true if you want real-time feedback
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
        micBtn.classList.remove('listening');
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