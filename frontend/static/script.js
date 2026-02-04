const API_URL = window.location.origin;
console.log("Using API_URL:", API_URL);
console.log("SVU Bot Script v9 Loaded-02021532");

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
    const headerIcon = document.getElementById('header-theme-icon');
    const text = document.getElementById('theme-text');

    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (headerIcon) headerIcon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

// Splash Screen Logic
// Auth State
let ACCESS_TOKEN = localStorage.getItem('access_token');
let USER_ROLE = localStorage.getItem('user_role');
let notificationInterval = null;

document.addEventListener("DOMContentLoaded", () => {
    // Check for Google OAuth callback params
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const error = urlParams.get('error');

    if (error) {
        alert("Authentication Failed: " + error);
        window.history.replaceState({}, document.title, "/");
    } else if (token) {
        const role = urlParams.get('role');
        const username = urlParams.get('username');

        console.log("Google Login Success:", username);
        saveSession({
            access_token: token,
            role: role,
            username: username,
            full_name: urlParams.get('name') // Optional if backend sends it
        });

        // Clean URL
        window.history.replaceState({}, document.title, "/");
    }

    // Check Auth first
    if (checkAuth()) {
        startNotificationPolling();
        loadChatHistory();
        populateSidebarProfile();
    }


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

    if (userInput) userInput.focus();

    // Ensure the default section is shown
    setTimeout(() => {
        showSection('chat');
    }, 100);
});


// --- Auth Functions ---
function checkAuth() {
    const overlay = document.getElementById('auth-overlay');

    if (!ACCESS_TOKEN) {
        if (overlay) overlay.classList.add('active');
        return false;
    } else {
        if (overlay) overlay.classList.remove('active');
        return true;
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
            body: JSON.stringify({ email: email })
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
        const res = await fetch(`${API_URL}/verify-otp-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, otp, new_password: newPassword })
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
    const loadingOverlay = document.getElementById('loading-overlay');

    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    errorEl.style.display = 'none';

    try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });

        if (!res.ok) {
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                const errData = await res.json();
                throw new Error(errData.detail || 'Invalid credentials');
            } else {
                const text = await res.text();
                console.error("Non-JSON Login Error:", text);
                throw new Error("Server error during login. Please try again.");
            }
        }

        const data = await res.json();
        console.log("Login successful:", data.username);
        saveSession(data);
    } catch (err) {
        console.error("Login error:", err.message);
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
}

const validateEmail = (email) => {
    return String(email)
        .toLowerCase()
        .match(
            /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/
        );
};

const validatePassword = (password) => {
    // Min 8 chars, 1 upper, 1 lower, 1 number, 1 special char
    const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    return re.test(password);
};

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const fullName = document.getElementById('reg-fullname').value;
    const role = document.getElementById('reg-role').value;
    const password = document.getElementById('reg-password').value;
    const errorEl = document.getElementById('auth-error');

    // Frontend Validation
    if (!validateEmail(username)) {
        errorEl.textContent = "Invalid email format.";
        errorEl.style.display = 'block';
        return;
    }

    if (!validatePassword(password)) {
        errorEl.textContent = "Password must be 8+ chars, with Upper, Lower, Number & Special char.";
        errorEl.style.display = 'block';
        return;
    }

    try {
        console.log("Registering user:", username);
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: username, full_name: fullName, role, password })
        });

        if (!res.ok) {
            const contentType = res.headers.get("content-type");
            let errData;
            if (contentType && contentType.indexOf("application/json") !== -1) {
                errData = await res.json();
            } else {
                const text = await res.text();
                console.error("Non-JSON Register Error:", text);
                throw new Error("Server error during registration. please check logs.");
            }
            console.error("Register Error Response:", errData);
            if (errData.detail === "Username already registered") {
                errorEl.textContent = "This email is already registered. Please log in.";
                errorEl.style.display = 'block';
                setTimeout(() => switchAuthTab('login'), 2000);
                return;
            }
            let msg = 'Registration failed';
            if (typeof errData.detail === 'string') {
                msg = errData.detail;
            } else if (Array.isArray(errData.detail)) {
                // Handle Pydantic validation errors
                msg = errData.detail.map(e => e.msg).join(', ');
            } else if (typeof errData.detail === 'object') {
                msg = JSON.stringify(errData.detail);
            }
            throw new Error(msg);
        }

        // Success Popup & Redirect to Login
        console.info("Registration successful, alerting user.");
        alert("User registration successful! Please log in with your credentials.");
        switchAuthTab('login');

    } catch (err) {
        console.error("Registration error:", err.message);
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
    localStorage.setItem('full_name', data.full_name || data.username);

    // Redirection: Hide auth overlay and show chat
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.classList.remove('active');

    showSection('chat');
    populateSidebarProfile();

    // Refresh admin/dashboard views if needed
    if (USER_ROLE === 'admin') {
        const navAdmin = document.getElementById('nav-admin');
        const navDashboard = document.getElementById('nav-dashboard');
        if (navAdmin) navAdmin.style.display = 'block';
        if (navDashboard) navDashboard.style.display = 'block';
    }

    // Start notification polling
    startNotificationPolling();

    // Reset chat to "New Chat" on login
    clearChat();
}

function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('username');
    ACCESS_TOKEN = null;
    USER_ROLE = null;

    stopNotificationPolling();

    // Hide restricted links immediately
    const navAdmin = document.getElementById('nav-admin');
    const navDashboard = document.getElementById('nav-dashboard');
    if (navAdmin) navAdmin.style.display = 'none';
    if (navDashboard) navDashboard.style.display = 'none';

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






function populateSidebarProfile() {
    const fullName = localStorage.getItem('full_name');
    const role = localStorage.getItem('user_role');
    const profileEl = document.getElementById('sidebar-profile');

    if (ACCESS_TOKEN && fullName && profileEl) {
        profileEl.style.display = 'flex';
        const nameEl = document.getElementById('profile-name');
        const roleEl = document.getElementById('profile-role');
        const avatarEl = document.getElementById('profile-avatar');
        const navAdmin = document.getElementById('nav-admin');
        const navDashboard = document.getElementById('nav-dashboard');

        if (nameEl) nameEl.textContent = fullName;
        if (roleEl) roleEl.textContent = role;
        if (avatarEl) avatarEl.textContent = fullName.charAt(0).toUpperCase();

        // Show/Hide admin features
        if (role === 'admin') {
            if (navAdmin) navAdmin.style.display = 'block';
            if (navDashboard) navDashboard.style.display = 'block';
        } else {
            if (navAdmin) navAdmin.style.display = 'none';
            if (navDashboard) navDashboard.style.display = 'none';
        }
    } else if (profileEl) {
        profileEl.style.display = 'none';
    }
}



function showStatusPopup(message, duration = 2000) {
    let popup = document.getElementById('status-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'status-popup';
        popup.className = 'status-popup';
        document.body.appendChild(popup);
    }

    popup.innerHTML = message;
    popup.classList.add('active');

    setTimeout(() => {
        popup.classList.remove('active');
    }, duration);
}

async function checkNotifications() {
    if (!ACCESS_TOKEN) return;

    try {
        const res = await fetch(`${API_URL}/notifications`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.status === 401 || res.status === 403) {
            console.warn("Notification Auth Failure. Stopping Polling.");
            // Clear local credentials to prevent restart
            ACCESS_TOKEN = null;
            localStorage.removeItem('access_token');
            stopNotificationPolling();
            checkAuth(); // Update UI
            return;
        }

        if (!res.ok) return;

        const notifications = await res.json();

        // If no lastSeenId exists, set it to the latest notification ID without showing toasts
        if (!localStorage.getItem('last_notification_id')) {
            const maxId = notifications.reduce((max, n) => Math.max(max, n.id), 0);
            localStorage.setItem('last_notification_id', maxId.toString());
            return;
        }

        const lastSeenId = parseInt(localStorage.getItem('last_notification_id') || '0');
        let newLastSeenId = lastSeenId;

        // Sort by timestamp or ID ascending to show in order
        notifications.sort((a, b) => a.id - b.id).forEach(notif => {
            if (notif.id > lastSeenId) {
                showToast(notif.title, notif.message);
                if (notif.id > newLastSeenId) newLastSeenId = notif.id;
            }
        });
        localStorage.setItem('last_notification_id', newLastSeenId.toString());
    } catch (e) {
        // console.error("Notification Poll Error", e);
    }
}

function startNotificationPolling() {
    if (notificationInterval) clearInterval(notificationInterval);
    // Poll every 60 seconds
    notificationInterval = setInterval(checkNotifications, 60000);
    // Also check immediately
    checkNotifications();
}

function stopNotificationPolling() {
    if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
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

function showSection(section) {
    // Prevent non-admins from accessing restricted sections
    if ((section === 'admin' || section === 'dashboard') && USER_ROLE !== 'admin') {
        showSection('chat');
        return;
    }

    const sections = ['chat', 'admin', 'dashboard', 'calendar', 'study', 'career'];

    sections.forEach(s => {
        const el = document.getElementById(`${s}-section`);
        if (el) el.style.display = 'none';

        const nav = document.getElementById(`nav-${s}`);
        if (nav) nav.classList.remove('active');
    });

    const activeSection = document.getElementById(`${section}-section`);
    if (activeSection) {
        // We use flex for chat-section to maintain layout, block for others
        activeSection.style.display = (section === 'chat') ? 'flex' : 'block';
    }

    const activeNav = document.getElementById(`nav-${section}`);
    if (activeNav) activeNav.classList.add('active');

    // Trigger specific loaders
    if (section === 'dashboard') {
        loadDashboard();
    }
    if (section === 'admin') {
        loadDocuments();
        loadAllTickets();
        loadCalendar(); // admin view uses same calendar loader but might have specific admin features
        loadAllUsers();
        loadSystemHealth();
        loadSuggestedFAQs();
    }

    if (section === 'calendar') {
        loadCalendar();
    }
    if (section === 'study') {
        loadStudyBuddy();
    }
    if (section === 'career') {
        loadCareerCenter();
    }
    if (section === 'chat') {
        // Countdown widget removed
    }
}

async function appendQuick(text) {
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
    // Add user message
    appendMessage(text, 'user', true);
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
                language: document.getElementById('lang-select')?.value || 'en'
            })
        });

        if (!response.ok) throw new Error('Backend unavailable');
        const data = await response.json();

        // Hide typing indicator before showing response
        hideTypingIndicator();

        // Add Chat Message
        const msgDiv = appendMessage(data.response || "I'm having trouble connecting right now.", 'bot', true);

        // If bot is unsure, add Ticket Button
        if (data.response && (data.response.toLowerCase().includes("raise a ticket") || data.response.toLowerCase().includes("don't know"))) {
            const ticketBtn = document.createElement("button");
            ticketBtn.className = "ticket-action-btn";
            ticketBtn.innerText = "🎫 Raise a Ticket";
            ticketBtn.onclick = () => openTicketModal(text, data.response); // Pass context
            msgDiv.appendChild(ticketBtn);
        }

    } catch (err) {
        hideTypingIndicator();
        appendMessage("I apologize, but I'm unable to reach the server at the moment. Please try again later.", 'bot');
    }

    scrollToBottom();
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Stop previous
        const utterance = new SpeechSynthesisUtterance(text);
        // Try to select a natural voice
        const voices = window.speechSynthesis.getVoices();
        // Indian English or fallback to first available
        const preferredVoice = voices.find(v => v.lang.includes('IN')) || voices[0];
        if (preferredVoice) utterance.voice = preferredVoice;

        window.speechSynthesis.speak(utterance);
    }
}

// Removing duplicate saveSession placeholder


// Analytics Chart
let roleChartInstance = null;
let sentimentChartInstance = null;

async function loadDashboard() {
    if (!ACCESS_TOKEN) return;
    try {
        const res = await fetch(`${API_URL}/dashboard-stats`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (!res.ok) return;

        const data = await res.json();

        document.getElementById('total-queries').textContent = data.total_queries;
        document.getElementById('active-users').textContent = data.active_users;

        // Update document count placeholder in dashboard
        const docCountEl = document.querySelector('.stat-card .doc-icon + .stat-info p');
        if (docCountEl) docCountEl.textContent = data.active_users; // Fallback or handle separately

        // Fetch specific doc count if needed, or use a general admin endpoint
        const docsRes = await fetch(`${API_URL}/admin/documents`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (docsRes.ok) {
            const docs = await docsRes.json();
            if (docCountEl) docCountEl.textContent = docs.length;
            // Also update the description text
            const docDesc = document.querySelector('.settings-card p');
            if (docDesc && docDesc.textContent.includes('documents in your knowledge base')) {
                docDesc.textContent = `You have ${docs.length} documents in your knowledge base. Use the Admin Settings to add, remove, or update documents.`;
            }
        }

        renderCharts(data.role_distribution, data.sentiment_stats);

        // Load real-time system health
        loadSystemHealth();

        loadFAQs();
        loadDocuments();
        loadUsers();

    } catch (e) {
        console.error("Dashboard Error", e);
    }
}

async function loadUsers() {
    try {
        const res = await fetch(`${API_URL}/admin/users`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;
        const users = await res.json();
        const tbody = document.getElementById('user-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        users.forEach(u => {
            const roleBadge = u.role === 'admin' ? 'success' : 'warning';
            tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 12px; display: flex; align-items: center; gap: 10px;">
                    <div style="width: 32px; height: 32px; background: #6366f1; color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                        ${u.username[0].toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight: 600;">${escapeHtml(u.username.split('@')[0])}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(u.username)}</div>
                    </div>
                </td>
                <td style="padding: 12px;"><span class="badge ${roleBadge}">${u.role.charAt(0).toUpperCase() + u.role.slice(1)}</span></td>
                <td style="padding: 12px;"><span class="badge success">Active</span></td>
                <td style="padding: 12px; text-align: right;">
                    <button class="icon-btn" style="width: 32px; height: 32px; font-size: 14px;"><i class="fa-solid fa-pen"></i></button>
                </td>
            </tr>`;
        });
    } catch (e) { console.error("Load Users Error", e); }
}

async function loadDocuments() {
    if (!ACCESS_TOKEN) return;
    try {
        const res = await fetch(`${API_URL}/admin/documents`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (!res.ok) return;
        const docs = await res.json();
        allDocuments = docs; // Update global store
        renderDocuments(docs, 3);
    } catch (e) { console.error("Load Docs Error", e); }
}

function renderDocuments(docs, limit = null) {
    const tbody = document.getElementById('documents-table-body');
    if (!tbody) return;
    const container = tbody.parentElement.parentElement; // table -> .documents-list-container -> .settings-card
    // Add View More button if not exists

    // Add View More button if not exists
    let btn = container.querySelector('.btn-view-more');
    if (!btn) {
        btn = document.createElement('button');
        btn.className = 'btn-secondary btn-view-more';
        btn.style.width = '100%';
        btn.style.marginTop = '15px';
        btn.style.textAlign = 'center';
        container.appendChild(btn);
    }

    tbody.innerHTML = '';
    if (docs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No documents found.</td></tr>';
        btn.style.display = 'none';
        return;
    }

    const showCount = limit ? limit : docs.length;
    const visibleDocs = docs.slice(0, showCount);

    visibleDocs.forEach(doc => {
        const dateStr = new Date(doc.uploaded_at || doc.upload_date).toLocaleDateString();
        const iconClass = (doc.type === 'url') ? 'fa-link' : 'fa-file-pdf';
        const typeLabel = (doc.type === 'url') ? 'URL' : 'PDF';

        tbody.innerHTML += `
            <tr>
                <td style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid ${iconClass}" style="color: var(--accent-color);"></i>
                    ${escapeHtml(doc.filename)}
                </td>
                <td><span class="badge ${doc.type === 'url' ? 'warning' : 'success'}">${typeLabel}</span></td>
                <td style="text-align: center;">${doc.id || doc.chunks}</td>
                <td style="text-align: center;">${doc.uploaded_by || 'Admin'}</td>
                <td style="text-align: right;">
                    <button class="icon-btn" onclick="deleteDocument('${doc._id}')" style="color: #ef4444;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    // Toggle Button Logic
    if (docs.length <= 3) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        if (limit) {
            btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> View More (${docs.length - 3} more)`;
            btn.onclick = () => renderDocuments(docs, null);
        } else {
            btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> View Less`;
            btn.onclick = () => renderDocuments(docs, 3);
        }
    }
}

async function deleteDocument(docId) {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/documents/${docId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            alert("Document deleted.");
            loadDocuments();
        } else {
            alert("Failed to delete document.");
        }
    } catch (e) { console.error(e); }
}


function renderCharts(roleData, sentimentData) {
    // 1. Role Chart
    const ctxRole = document.getElementById('roleChart').getContext('2d');

    if (roleChartInstance) roleChartInstance.destroy();

    roleChartInstance = new Chart(ctxRole, {
        type: 'doughnut',
        data: {
            labels: Object.keys(roleData),
            datasets: [{
                data: Object.values(roleData),
                backgroundColor: ['#0f766e', '#f59e0b', '#ef4444', '#6366f1'],
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

    // 2. Sentiment Chart
    const ctxSent = document.getElementById('sentimentChart').getContext('2d');
    if (sentimentChartInstance) sentimentChartInstance.destroy();
    sentimentChartInstance = new Chart(ctxSent, {
        type: 'bar',
        data: {
            labels: Object.keys(sentimentData),
            datasets: [{
                label: 'User Emotions',
                data: Object.values(sentimentData),
                backgroundColor: ['#10b981', '#94a3b8', '#ef4444'],
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'User Sentiment Analysis' }
            },
            scales: {
                y: { beginAtZero: true }
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

// Section for consolidated functions - removing duplicate sendMessage placeholder


function appendMessage(text, sender, save = true) {
    if (save) {
        chatHistory.push({ text, sender });
        localStorage.setItem('svu_chat_history', JSON.stringify(chatHistory));
    }

    const div = document.createElement('div');
    div.classList.add('message', sender);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-body'; // Container for bubble + actions

    const bubble = document.createElement('div');
    bubble.className = 'text'; // This is the actual bubble

    if (sender === 'bot') {
        const botIconDiv = document.createElement('div');
        botIconDiv.className = 'bot-icon';
        botIconDiv.innerHTML = '<img src="/static/images/bot_avatar.svg" alt="Bot" style="width: 100%; height: 100%;">';

        // Message text container
        const textSpan = document.createElement('div');
        textSpan.className = 'message-content';
        textSpan.innerHTML = formatText(text);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'msg-actions';

        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'speech-btn';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
        copyBtn.onclick = () => copyText(textSpan, copyBtn);

        // Speak Button
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speech-btn';
        speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        speakBtn.onclick = () => speakText(text, textSpan, speakBtn);

        // Raise Ticket Button
        const ticketBtn = document.createElement('button');
        ticketBtn.className = 'speech-btn';
        ticketBtn.title = "Raise Support Ticket";
        ticketBtn.innerHTML = '<i class="fa-solid fa-ticket"></i>';


        // Thumbs Up
        const upBtn = document.createElement('button');
        upBtn.className = 'speech-btn feedback-up';
        upBtn.title = "Good Response";
        upBtn.innerHTML = '<i class="fa-regular fa-thumbs-up"></i>';

        // Thumbs Down
        const downBtn = document.createElement('button');
        downBtn.className = 'speech-btn feedback-down';
        downBtn.title = "Poor Response";
        downBtn.innerHTML = '<i class="fa-regular fa-thumbs-down"></i>';

        // Find the user query that triggered this bot response
        let triggeredQuery = "Unknown context";
        for (let i = chatHistory.length - 2; i >= 0; i--) {
            if (chatHistory[i].sender === 'user') {
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
        const textSpan = document.createElement('div');
        textSpan.className = 'message-content';
        textSpan.textContent = text;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'msg-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'speech-btn';
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
    // Visual feedback
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/chat/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                message: userQuery,
                response: botResponse,
                rating: rating
            })
        });

        if (res.ok) {
            // Use solid icons for the selected rating
            if (rating === 1) {
                btn.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
                btn.style.color = '#10b981';
            } else {
                btn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
                btn.style.color = '#ef4444';
            }

            // Disable and dim the group
            const parent = btn.parentElement;
            parent.querySelectorAll('.feedback-up, .feedback-down').forEach(b => {
                b.disabled = true;
                b.style.pointerEvents = 'none';
                if (b !== btn) {
                    b.style.opacity = '0.3';
                    b.style.filter = 'grayscale(1)';
                }
            });

            showToast(rating === 1 ? "Thanks for reflecting! 👍" : "Feedback noted. We'll improve! 📝", "info");
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
        typingIndicator.style.display = 'flex';
        scrollToBottom();
    }
}

function hideTypingIndicator() {
    if (typingIndicator) typingIndicator.style.display = 'none';
}

// Guard against API_URL and ACCESS_TOKEN not being defined before attempting to fetch
async function loadSystemHealth() {
    if (!API_URL || !ACCESS_TOKEN) {
        console.warn("API_URL or ACCESS_TOKEN not defined. Skipping system health check.");
        return;
    }
    try {
        const res = await fetch(`${API_URL}/admin/system-health`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        const updateStatus = (id, status) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = status.charAt(0).toUpperCase() + status.slice(1);
                el.className = `badge ${status === 'healthy' || status === 'connected' || status === 'active' || status === 'online' ? 'success' : 'danger'}`;
            }
        };

        updateStatus('health-api', data.api_status);
        updateStatus('health-vector', data.vector_db_status);
        updateStatus('health-llm', data.llm_service);
        updateStatus('health-mongo', data.mongodb_status);

    } catch (e) { console.error("Health Check Error", e); }
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

    // Map Link Parsing
    if (safeText.includes("[Map Link]")) {
        // Extract the location context from the text (heuristic)
        // We'll search for "Where is X?" in previous context or just map the keyword "Location"
        // For simplicity, let's link to SVU Map generally, or use the query
        safeText = safeText.replace("[Map Link]",
            `<a href="https://www.google.com/maps/search/?api=1&query=Sri+Venkateswara+University+Tirupati" target="_blank" class="map-link-btn"><i class="fa-solid fa-map-location-dot"></i> View on Map</a>`
        );
    }

    return safeText
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') // Bold
        .replace(/\*(.*?)\*/g, '<i>$1</i>') // Italic
    return safeText
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
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
let currentSpeechBtn = null;
let currentUtterance = null; // GLOBAL reference to prevent GC
let currentHighlightedElement = null;
let originalHtmlContent = null;

// Helper logic for voices
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

    // 1. Cancel existing speech & Reset
    // 1. Cancel existing speech & Reset
    if (synth.speaking || currentHighlightedElement) {
        // Capture logic state BEFORE reset
        const isSameElement = (currentHighlightedElement === element);

        resetHighlighting();
        synth.cancel();

        // If clicking the same button, just stop (toggle off)
        if (isSameElement) {
            return;
        }
    }

    if (button) {
        currentSpeechBtn = button;
        button.innerHTML = '<i class="fa-solid fa-stop"></i>';
        button.style.color = '#ef4444';
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
        textToSpeak = result.fullText;
    } else {
        textToSpeak = text.replace(/[*#`]/g, '');
    }

    if (!textToSpeak.trim()) {
        console.warn("[TTS] Empty text, skipping");
        return;
    }

    // 3. Prepare Utterance
    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    // 4. Voice Selection (Synchronous Best Effort)
    if (availableVoices.length === 0) {
        availableVoices = synth.getVoices();
    }

    const selectedLang = document.getElementById('lang-select')?.value || 'en';
    let targetLangCode = 'en-US';
    // Priority keywords for "Sweet/Natural Female/Clear" voices
    let voiceKeywords = ["google us english", "microsoft zira", "samantha", "victoria", "ava", "female"];

    if (selectedLang === 'te') {
        targetLangCode = 'te-IN';
        // "Shruti" (Microsoft) and "Google Telugu" are the gold standards
        voiceKeywords = ["shruti", "google telugu", "rani", "vani", "hema", "female"];
    } else if (selectedLang === 'hi') {
        targetLangCode = 'hi-IN';
        // "Swara" (Microsoft) and "Google Hindi" are best
        voiceKeywords = ["swara", "google hindi", "kalpana", "heera", "female"];
    }

    console.log(`[TTS] Target Lang: ${targetLangCode}`);

    // Helper to score voices (higher score = better match for 'sweet female')
    const getVoiceScore = (voice) => {
        let score = 0;
        const nameLower = voice.name.toLowerCase();

        if (voice.lang === targetLangCode) score += 20;
        else if (voice.lang.split('-')[0] === selectedLang) score += 10;
        else return -1; // Wrong language

        for (const kw of voiceKeywords) {
            if (nameLower.includes(kw.toLowerCase())) {
                score += 5; // Keyword match
                if (kw === "natural") score += 10; // High priority for natural
                if (kw === "premium") score += 10; // High priority for premium
            }
        }

        // Bonus for "Microsoft" online voices which are usually better
        if (nameLower.includes("microsoft") && nameLower.includes("online")) score += 15;

        return score;
    };

    // Sort voices by score
    const bestVoice = availableVoices
        .map(v => ({ voice: v, score: getVoiceScore(v) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)[0];

    let preferredVoice = bestVoice ? bestVoice.voice : null;

    // Fallback to English preferred if non-English voice not found (better than silence)
    if (!preferredVoice && selectedLang !== 'en') {
        console.warn(`[TTS] No voice found for ${selectedLang}, falling back to English.`);
        preferredVoice = availableVoices.find(v => v.lang.startsWith("en") && (v.name.includes("Female") || v.name.includes("Google")));
    }

    // Default English Logic if still null or English selected
    if (!preferredVoice && selectedLang === 'en') {
        preferredVoice = availableVoices.find(v =>
            (v.name.includes("Google US English") || v.name.includes("Zira") || v.name.includes("Female")) &&
            v.lang.startsWith("en")
        );
    }

    if (preferredVoice) {
        console.log(`[TTS] Using voice: ${preferredVoice.name} (${preferredVoice.lang})`);
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
    } else {
        // Ultimate fallback
        utterance.lang = targetLangCode;
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Store in global to prevent GC
    currentUtterance = utterance;

    if (element) {
        utterance.onboundary = (event) => {
            if (event.name === 'word') {
                highlightWordAt(event.charIndex, spans);
            }
        };

        utterance.onend = () => {
            console.log("[TTS] Finished");
            resetHighlighting();
        };
        utterance.onerror = (e) => {
            console.error("[TTS] Utterance Error:", e);
            if (e.error !== 'interrupted') {
                showStatusPopup(`TTS Error: ${e.error}`, 3000);
            }
            resetHighlighting();
        };
    }

    // 5. Execution - Immediate
    console.log("[TTS] Executing commands...");
    try {
        synth.cancel(); // Force clearing
        synth.resume(); // Wake up engine
        synth.speak(utterance);

        // Final fail-safe check
        if (availableVoices.length === 0) {
            showStatusPopup("Voice engine is busy or no voices found. Playing default...", 2000);
        }

    } catch (e) {
        console.error("[TTS] Exception during speak:", e);
        showStatusPopup("Audio Engine Failed. Please refresh.", 3000);
    }
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
    if (!currentHighlightedElement) return;

    // Remove previous highlights
    const active = currentHighlightedElement.querySelector('.speaking-word');
    if (active) active.classList.remove('speaking-word');

    // Find the span that COVERS the current charIndex
    // We treat the charIndex as 'start of the current word being spoken'
    let targetSpan = spans.find(span => {
        const start = parseInt(span.dataset.start);
        const end = parseInt(span.dataset.end);
        // Standard check: is index inside the word?
        return charIndex >= start && charIndex < end;
    });

    // Fallback: Sometimes browsers report index slightly before the word start (whitespace issue)
    if (!targetSpan) {
        targetSpan = spans.find(span => {
            const start = parseInt(span.dataset.start);
            // Allow a small tolerance (e.g., 2 chars) for leading punctuation/whitespace drift
            return Math.abs(start - charIndex) <= 2;
        });
    }

    if (targetSpan) {
        targetSpan.classList.add('speaking-word');
        // Auto-scroll disabled per user request to allow manual navigation
        // targetSpan.scrollIntoView({ behavior: "smooth", block: "center" });
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
        const deleteBtn = USER_ROLE === 'admin'
            ? `<button onclick="deleteFAQ('${item.id}')" style="float:right; color:#ef4444; background:none; border:none; cursor:pointer;" title="Delete"><i class="fa-solid fa-trash"></i></button>`
            : '';

        // Safe parsed HTML using marked.js (assuming it's loaded)
        // If marked isn't available, fallback to simple escape
        let answerHtml = '';
        if (typeof marked !== 'undefined') {
            try {
                answerHtml = marked.parse(item.answer);
            } catch (e) {
                console.error("Markdown parse error", e);
                answerHtml = escapeHtml(item.answer);
            }
        } else {
            answerHtml = escapeHtml(item.answer);
        }

        list.innerHTML += `
            <div class="faq-card">
                ${deleteBtn}
                <h4>${escapeHtml(item.question)}</h4>
                <div class="faq-meta" style="font-size: 0.8em; color: #0f766e; margin-bottom: 5px;">${escapeHtml(item.category || 'General')}</div>
                <div class="markdown-body">${answerHtml}</div>
            </div>`;
    });
}

// Admin Search Listener
// Global Store for Docs
let allDocuments = [];

// Admin Search Listener
const adminSearchInput = document.getElementById('admin-search-input');
if (adminSearchInput) {
    adminSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allDocuments.filter(doc =>
            (doc.filename && doc.filename.toLowerCase().includes(query)) ||
            (doc.uploaded_by && doc.uploaded_by.toLowerCase().includes(query))
        );
        renderDocuments(filtered);
    });
}

const modal = document.getElementById("faq-modal");
function openModal() {
    const modal = document.getElementById('faq-modal');
    if (modal) {
        // Reset to default (Admin mode)
        const header = modal.querySelector('.modal-header h3');
        const subTitle = modal.querySelector('.modal-header p');
        const submitBtnText = modal.querySelector('#faq-submit-btn span');
        const submitBtnIcon = modal.querySelector('#faq-submit-btn i');

        if (header) header.textContent = "Admin: Publish FAQ";
        if (subTitle) subTitle.textContent = "Directly publish new information to the database.";
        if (submitBtnText) submitBtnText.textContent = "Publish FAQ";
        if (submitBtnIcon) submitBtnIcon.className = "fa-solid fa-cloud-arrow-up";

        const submitBtn = document.getElementById('faq-submit-btn');
        if (submitBtn) submitBtn.onclick = saveFAQ;

        modal.classList.add('active');
    }
}
function closeModal() {
    const modal = document.getElementById('faq-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function openSuggestModal() {
    if (!ACCESS_TOKEN) {
        checkAuth(); // Show login overlay if not logged in
        return;
    }
    const modal = document.getElementById('faq-modal');
    if (!modal) return;

    // Set UI for suggestion mode
    const header = modal.querySelector('.modal-header h3');
    const subTitle = modal.querySelector('.modal-header p');
    const submitBtnText = modal.querySelector('#faq-submit-btn span');
    const submitBtnIcon = modal.querySelector('#faq-submit-btn i');

    if (header) header.textContent = "Suggest an FAQ";
    if (subTitle) subTitle.textContent = "Help improve the campus assistant's knowledge.";
    if (submitBtnText) submitBtnText.textContent = "Submit Suggestion";
    if (submitBtnIcon) submitBtnIcon.className = "fa-solid fa-paper-plane";

    const submitBtn = document.getElementById('faq-submit-btn');
    if (submitBtn) submitBtn.onclick = submitFAQSuggestion;

    modal.classList.add('active');
}

async function submitFAQSuggestion() {
    const question = document.getElementById('faq-question').value;
    const answer = document.getElementById('faq-answer').value;
    const category = document.getElementById('faq-category').value;
    const suggested_by = localStorage.getItem('username') || "Anonymous";

    if (!question || !answer) {
        alert("Please fill all fields.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/faqs/suggest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ question, answer, category, suggested_by })
        });

        if (res.ok) {
            closeModal();
            showStatusPopup("Thank you! Your FAQ suggestion has been submitted for review.");
            // Clear form
            document.getElementById('faq-question').value = '';
            document.getElementById('faq-answer').value = '';
        } else {
            alert("Failed to submit suggestion.");
        }
    } catch (e) { console.error(e); }
}

async function loadSuggestedFAQs() {
    if (!ACCESS_TOKEN) return;
    if (USER_ROLE !== 'admin') return;

    try {

        const res = await fetch(`${API_URL}/admin/suggested-faqs`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;

        const suggestions = await res.json();
        window.allSuggestions = suggestions; // Store for lookup

        const tbody = document.getElementById('suggested-faqs-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        if (suggestions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No suggestions pending.</td></tr>';
            return;
        }

        suggestions.forEach(s => {
            const dateStr = new Date(s.timestamp).toLocaleDateString();
            const initial = s.suggested_by.charAt(0).toUpperCase();

            tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--border-color); vertical-align: middle; cursor: pointer;" 
                onclick="openReviewModal('${s.id}')"
                class="review-row">
                <td style="padding: 16px;">
                    <div class="suggested-faq-content">
                        <div class="suggested-faq-question">${escapeHtml(s.question)}</div>
                        <div class="suggested-faq-answer">${escapeHtml(s.answer)}</div>
                        <div class="suggested-faq-meta">
                            <span class="badge success" style="font-size: 9px; padding: 2px 6px;">${escapeHtml(s.category || 'General')}</span>
                        </div>
                    </div>
                </td>
                <td style="padding: 16px;">
                    <div class="contributor-item">
                        <div class="contributor-avatar">${initial}</div>
                        <div class="contributor-info">
                            <div class="contributor-name">${escapeHtml(s.suggested_by)}</div>
                            <div class="contributor-date">${dateStr}</div>
                        </div>
                    </div>
                </td>
                <td style="padding: 16px; text-align: right;">
                    <div class="action-buttons">
                        <button class="btn-approve" onclick="event.stopPropagation(); approveSuggestion('${s.id}')">
                            <i class="fa-solid fa-check"></i> Approve
                        </button>
                        <button class="btn-reject" onclick="event.stopPropagation(); rejectSuggestion('${s.id}')">
                            Reject
                        </button>
                    </div>
                </td>
            </tr>`;
        });
    } catch (e) { console.error("Load Suggestions Error", e); }
}

function openReviewModal(id) {
    if (!window.allSuggestions) return;
    const s = window.allSuggestions.find(item => item.id === id);
    if (!s) return;

    const modal = document.getElementById('review-suggestion-modal');
    if (!modal) return;

    // Fill content
    document.getElementById('review-contributor').textContent = s.suggested_by;
    document.getElementById('review-avatar').textContent = s.suggested_by.charAt(0).toUpperCase();
    document.getElementById('review-date').textContent = new Date(s.timestamp).toLocaleDateString();
    document.getElementById('review-question').textContent = s.question;
    document.getElementById('review-answer').textContent = s.answer;

    // Set actions
    document.getElementById('review-approve-btn').onclick = () => approveSuggestion(id, true);
    document.getElementById('review-reject-btn').onclick = () => rejectSuggestion(id, true);

    modal.classList.add('active');
}

function closeReviewModal() {
    const modal = document.getElementById('review-suggestion-modal');
    if (modal) modal.classList.remove('active');
}

async function approveSuggestion(id, fromModal = false) {
    if (!confirm("Approve this FAQ and publish it?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/suggested-faqs/${id}/approve`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("FAQ approved and published!");
            if (fromModal) closeReviewModal();
            loadSuggestedFAQs();
            loadFAQs(); // Refresh main FAQ list if visible
        } else {
            alert("Failed to approve suggestion.");
        }
    } catch (e) { console.error(e); }
}

async function rejectSuggestion(id, fromModal = false) {
    if (!confirm("Are you sure you want to reject and delete this suggestion?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/suggested-faqs/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("Suggestion rejected.");
            if (fromModal) closeReviewModal();
            loadSuggestedFAQs();
        } else {
            alert("Failed to reject suggestion.");
        }
    } catch (e) { console.error(e); }
}

async function saveFAQ() {
    const question = document.getElementById('faq-question').value;
    const answer = document.getElementById('faq-answer').value;
    const category = document.getElementById('faq-category').value;

    if (!question || !answer) {
        alert("Please fill all fields.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/admin/faqs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ question, answer, category })
        });

        if (res.ok) {
            closeModal();
            loadFAQs();
            // Clear form
            document.getElementById('faq-question').value = '';
            document.getElementById('faq-answer').value = '';
        } else {
            alert("Failed to save FAQ");
        }
    } catch (e) { console.error(e); }
}

async function deleteFAQ(id) {
    if (!confirm("Are you sure you want to delete this FAQ?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/faqs/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            loadFAQs();
        } else {
            alert("Failed to delete FAQ");
        }
    } catch (e) { console.error(e); }
}

// --- Ticketing System ---
let currentTicketContext = { userQuery: "", botResponse: "" };

function openTicketModal(userQuery, botResponse) {
    currentTicketContext = { userQuery, botResponse };
    let modal = document.getElementById('ticket-modal');

    // Dynamically Create Modal if not exists
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ticket-modal';
        modal.className = 'modal';
        modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; padding: 0; border-radius: 20px; overflow: hidden;">
        <div class="modal-header" style="background: var(--gradient-primary); padding: 20px 24px; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 12px; color: white;">
                <div style="width: 36px; height: 36px; background: rgba(255,255,255,0.2); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-ticket"></i>
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600;">Raise Support Ticket</h3>
                    <p style="margin: 0; font-size: 13px; opacity: 0.9;">We'll help you resolve your issue</p>
                </div>
            </div>
            <button onclick="closeTicketModal()" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; opacity: 0.8; transition: opacity 0.2s;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        
        <div style="padding: 24px;">
            <div class="form-group" style="margin-bottom: 20px;">
                <label style="display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">Subject</label>
                <div style="position: relative;">
                    <i class="fa-solid fa-heading" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); opacity: 0.7;"></i>
                    <input type="text" id="ticket-subject" placeholder="Brief summary of the issue" 
                        style="width: 100%; padding: 12px 12px 12px 40px; border-radius: 12px; border: 1px solid var(--border-color); background: var(--glass-bg); color: var(--text-primary); outline: none; transition: border-color 0.2s;">
                </div>
            </div>
            
            <div class="form-group" style="margin-bottom: 20px;">
                <label style="display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">Description</label>
                <div style="position: relative;">
                     <i class="fa-solid fa-align-left" style="position: absolute; left: 14px; top: 14px; color: var(--text-secondary); opacity: 0.7;"></i>
                    <textarea id="ticket-desc" rows="5" placeholder="Describe your issue in detail..." 
                        style="width: 100%; padding: 12px 12px 12px 40px; border-radius: 12px; border: 1px solid var(--border-color); background: var(--glass-bg); color: var(--text-primary); outline: none; transition: border-color 0.2s; resize: vertical; font-family: inherit; line-height: 1.5;"></textarea>
                </div>
            </div>
            
            <div class="form-group" style="margin-bottom: 24px;">
                <label style="display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">Category</label>
                <div style="position: relative;">
                    <i class="fa-solid fa-layer-group" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); opacity: 0.7; pointer-events: none;"></i>
                    <select id="ticket-cat" style="width: 100%; padding: 12px 12px 12px 40px; border-radius: 12px; border: 1px solid var(--border-color); background: var(--glass-bg); color: var(--text-primary); outline: none; appearance: none; cursor: pointer;">
                        <option value="General">General Inquiry</option>
                        <option value="Technical">Technical Issue</option>
                        <option value="Academic">Academic/Grades</option>
                        <option value="Facilities">Campus Facilities</option>
                    </select>
                    <i class="fa-solid fa-chevron-down" style="position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); opacity: 0.7; pointer-events: none; font-size: 12px;"></i>
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; padding-top: 10px;">
                 <button class="btn-secondary" onclick="closeTicketModal()" style="flex: 1;">Cancel</button>
                 <button class="btn-primary" onclick="submitTicket()" style="flex: 2; height: auto; padding: 14px;">
                    <i class="fa-solid fa-paper-plane" style="margin-right: 8px;"></i> Submit Ticket
                 </button>
            </div>
        </div>
    </div>`;
        document.body.appendChild(modal);
    }

    // Pre-fill with animation/focus
    const context = `Context (Auto-generated):\nUser asked: "${userQuery || ''}"\nBot replied: "${botResponse ? botResponse.substring(0, 100) + '...' : ''}"\n\nMy Issue:\n`;

    setTimeout(() => {
        const subjectEl = document.getElementById('ticket-subject');
        const descEl = document.getElementById('ticket-desc');

        if (subjectEl) subjectEl.value = userQuery ? userQuery.substring(0, 60) + (userQuery.length > 60 ? "..." : "") : "";
        if (descEl) {
            descEl.value = context;
            descEl.focus();
        }
    }, 50);

    modal.classList.add('active');
}

function closeTicketModal() {
    const modal = document.getElementById('ticket-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function submitTicket() {
    const subject = document.getElementById('ticket-subject').value;
    const desc = document.getElementById('ticket-desc').value;
    const cat = document.getElementById('ticket-cat').value;

    if (!subject || !desc) {
        alert("Please fill all fields.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/tickets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                subject: subject,
                description: desc,
                category: cat
            })
        });

        if (res.ok) {
            alert("Ticket raised successfully! Support team will contact you.");
            closeTicketModal();
        } else {
            alert("Failed to raise ticket.");
        }
    } catch (e) {
        console.error(e);
        alert("Error raising ticket.");
    }
}


// --- Calendar Logic ---
async function loadCalendar() {
    const list = document.getElementById('calendar-list');
    list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
        <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
        <p style="margin-top: 10px;">Searching for upcoming events...</p>
    </div>`;

    try {
        const res = await fetch(`${API_URL}/calendar`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) throw new Error("Sync failed");
        const events = await res.json();
        renderCalendar(events);
    } catch (e) {
        console.error(e);
        list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
            <i class="fa-solid fa-calendar-xmark fa-2x" style="color: #ef4444;"></i>
            <p style="margin-top: 10px;">Failed to load calendar. Please try again later.</p>
        </div>`;
    }
}

function renderCalendar(events) {
    const list = document.getElementById('calendar-list');
    if (events.length === 0) {
        list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
            <i class="fa-solid fa-calendar-day fa-2x"></i>
            <p style="margin-top: 10px;">No upcoming events scheduled at this moment.</p>
        </div>`;
        return;
    }

    list.innerHTML = events.map(e => {
        const dateObj = new Date(e.date);
        const day = dateObj.getDate();
        const month = dateObj.toLocaleString('default', { month: 'short' }).toUpperCase();

        let colorClass = 'event-holiday';
        if (e.type === 'Exam') colorClass = 'event-exam';
        if (e.type === 'Event') colorClass = 'event-general';

        return `
            <div class="calendar-card ${colorClass}" onclick="addToGoogleCalendar('${escapeHtml(e.title)}', '${e.date}', '${escapeHtml(e.description || '')}')" style="cursor: pointer;" title="Add to Google Calendar">
                <div class="calendar-date">
                    <span class="day">${day}</span>
                    <span class="month">${month}</span>
                </div>
                <div class="calendar-info">
                    <span class="event-tag">${e.type}</span>
                    <h4 class="event-title">${e.title}</h4>
                    <p class="event-desc">${e.description || ''}</p>
                    <div style="margin-top: 8px; font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 5px;">
                         <i class="fa-brands fa-google"></i> <span style="text-decoration: underline;">Add to Calendar</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function addToGoogleCalendar(title, dateStr, desc) {
    // Parse date (assuming YYYY-MM-DD format from backend)
    const date = new Date(dateStr);

    // Format YYYYMMDD
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    // Create start and end date (all day event)
    const start = `${yyyy}${mm}${dd}`;
    // For all day event, end date is next day
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);
    const endYYYY = nextDay.getFullYear();
    const endMM = String(nextDay.getMonth() + 1).padStart(2, '0');
    const endDD = String(nextDay.getDate()).padStart(2, '0');

    const end = `${endYYYY}${endMM}${endDD}`;

    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(desc)}`;

    if (confirm(`Add "${title}" to your Google Calendar?`)) {
        window.open(url, '_blank');
    }
}

// --- Calendar Admin Logic ---
async function loadCalendarAdmin() {
    if (!ACCESS_TOKEN) return;
    const tbody = document.getElementById('calendar-admin-table-body');

    if (!tbody) return;

    try {
        const res = await fetch(`${API_URL}/calendar`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;
        const events = await res.json();
        // Store globally for toggling
        window.allCalendarEvents = events;
        renderCalendarAdminTable(events, 3); // show 3 initially
    } catch (e) {
        console.error("Load Calendar Admin Error", e);
    }
}

function renderCalendarAdminTable(events, limit = null) {
    const tbody = document.getElementById('calendar-admin-table-body');
    const container = tbody.parentElement.parentElement; // table -> div -> div.settings-card

    // Add View More button if not exists
    let btn = container.querySelector('.btn-view-more');
    if (!btn) {
        btn = document.createElement('button');
        btn.className = 'btn-secondary btn-view-more';
        btn.style.width = '100%';
        btn.style.marginTop = '15px';
        btn.style.textAlign = 'center';
        container.appendChild(btn);
    }

    if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No events posted.</td></tr>';
        btn.style.display = 'none';
        return;
    }

    const showCount = limit ? limit : events.length;
    const visibleEvents = events.slice(0, showCount);

    tbody.innerHTML = visibleEvents.map(e => `
        <tr>
            <td style="padding: 12px;">${e.date}</td>
            <td style="padding: 12px; font-weight: 500;">${e.title}</td>
            <td style="padding: 12px;"><span class="event-tag" style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(0,0,0,0.05);">${e.type}</span></td>
            <td style="padding: 12px; text-align: right;">
                <button onclick="deleteCalendarEvent('${e.id}')" style="color: #ef4444; background: none; border: none; cursor: pointer;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        </tr>
    `).join('');

    // Toggle Button Logic
    if (events.length <= 3) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        if (limit) {
            btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> View More (${events.length - 3} more)`;
            btn.onclick = () => renderCalendarAdminTable(events, null); // Show all
        } else {
            btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> View Less`;
            btn.onclick = () => renderCalendarAdminTable(events, 3); // Show Less
        }
    }
}

function openCalendarModal() {
    document.getElementById('calendar-event-modal').classList.add('active');
}

function closeCalendarModal() {
    document.getElementById('calendar-event-modal').classList.remove('active');
}

async function saveCalendarEvent() {
    const title = document.getElementById('event-title').value;
    const date = document.getElementById('event-date').value;
    const type = document.getElementById('event-type').value;
    const desc = document.getElementById('event-desc').value;

    if (!title || !date) {
        alert("Please provide title and date.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/admin/calendar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ title, date, type, description: desc })
        });

        if (res.ok) {
            closeCalendarModal();
            loadCalendarAdmin();
            loadCalendar(); // Update main calendar view if open
            showStatusPopup("Event posted successfully!");
        } else {
            alert("Failed to post event.");
        }
    } catch (e) {
        console.error(e);
        alert("Error posting event.");
    }
}

async function deleteCalendarEvent(id) {
    if (!confirm("Remove this event from the academic calendar?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/calendar/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            loadCalendarAdmin();
            loadCalendar();
        } else {
            alert("Failed to delete event.");
        }
    } catch (e) { console.error(e); }
}

async function loadAllTickets() {
    if (!ACCESS_TOKEN) return;
    try {
        const res = await fetch(`${API_URL}/admin/tickets`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (!res.ok) return;
        const tickets = await res.json();
        // Store globally
        window.allTickets = tickets;
        renderTicketsTable(tickets, 3);
    } catch (e) {
        console.error("Load Tickets Error", e);
    }
}

function renderTicketsTable(tickets, limit = null) {
    const tbody = document.getElementById('tickets-table-body');
    if (!tbody) return;
    const container = tbody.parentElement.parentElement;

    // Add View More button if not exists
    let btn = container.querySelector('.btn-view-more');
    if (!btn) {
        btn = document.createElement('button');
        btn.className = 'btn-secondary btn-view-more';
        btn.style.width = '100%';
        btn.style.marginTop = '15px';
        btn.style.textAlign = 'center';
        container.appendChild(btn);
    }

    tbody.innerHTML = '';
    if (tickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No support tickets found.</td></tr>';
        btn.style.display = 'none';
        return;
    }

    const showCount = limit ? limit : tickets.length;
    const visibleTickets = tickets.slice(0, showCount);

    visibleTickets.forEach(t => {
        const badgeClass = t.status === 'open' ? 'warning' : 'success';
        tbody.innerHTML += `
        <tr>
            <td>#${t.id.substring(t.id.length - 6)}</td>
            <td>${escapeHtml(t.subject)}</td>
            <td>${escapeHtml(t.category)}</td>
            <td>${escapeHtml(t.created_by)}</td>
            <td><span class="badge ${badgeClass}" style="cursor:pointer;" onclick="toggleTicketStatus('${t.id}', '${t.status}')">${t.status.toUpperCase()}</span></td>
            <td style="display: flex; gap: 5px; justify-content: flex-end;">
                 <button class="icon-btn" title="Reply / Resolve" onclick="openTicketResponseModal('${t.id}', '${escapeHtml(t.subject)}')" style="color: var(--primary-color);">
                    <i class="fa-solid fa-reply"></i>
                </button>
                <button class="icon-btn" title="View Details" onclick="viewTicketDetails('${t.id}')">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        </tr>`;
    });

    // Toggle Button Logic
    if (tickets.length <= 3) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        if (limit) {
            btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> View More (${tickets.length - 3} more)`;
            btn.onclick = () => renderTicketsTable(tickets, null);
        } else {
            btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> View Less`;
            btn.onclick = () => renderTicketsTable(tickets, 3);
        }
    }
}

async function toggleTicketStatus(id, currentStatus) {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open';
    if (!confirm(`Mark ticket as ${newStatus.toUpperCase()}?`)) return;

    try {
        const res = await fetch(`${API_URL}/admin/tickets/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ status: newStatus, resolution: "Status updated by Admin" })
        });
        if (res.ok) loadAllTickets();
    } catch (e) { console.error(e); }
}

function viewTicketDetails(id) {
    const modal = document.getElementById('ticket-view-modal');
    if (!modal) return;

    // Robust Lookup
    const ticket = window.allTickets ? window.allTickets.find(t => t.id === id) : null;
    if (!ticket) {
        console.error("Ticket not found in memory:", id);
        return;
    }

    document.getElementById('view-ticket-id').textContent = '#' + ticket.id.substring(ticket.id.length - 6);
    document.getElementById('view-ticket-subject').textContent = ticket.subject;
    document.getElementById('view-ticket-desc').textContent = ticket.description;

    const resEl = document.getElementById('view-ticket-resolution');
    resEl.textContent = ticket.resolution || "Pending Review";
    resEl.style.background = ticket.resolution ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-secondary)';

    const statusEl = document.getElementById('view-ticket-status');
    statusEl.textContent = ticket.status.toUpperCase();
    statusEl.className = `badge ${ticket.status === 'open' ? 'warning' : 'success'}`;

    modal.classList.add('active');
}

function closeTicketViewModal() {
    const modal = document.getElementById('ticket-view-modal');
    if (modal) modal.classList.remove('active');
}

function openTicketResponseModal(id, subject) {
    document.getElementById('ticket-response-modal').classList.add('active');
    document.getElementById('resp-ticket-id').value = id;
    document.getElementById('resp-ticket-subject').value = subject;
    document.getElementById('resp-ticket-answer').value = "";
}

function closeTicketResponseModal() {
    document.getElementById('ticket-response-modal').classList.remove('active');
}

async function submitTicketResponse() {
    const id = document.getElementById('resp-ticket-id').value;
    const resolution = document.getElementById('resp-ticket-answer').value.trim();
    const saveFaq = document.getElementById('resp-save-faq').checked;

    if (!resolution) {
        alert("Please provide a response.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/admin/tickets/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                status: "closed",
                resolution: resolution,
                save_as_faq: saveFaq
            })
        });

        if (res.ok) {
            closeTicketResponseModal();
            loadAllTickets();
            showStatusPopup("Response sent & Ticket closed!");
        } else {
            alert("Failed to submit response");
        }
    } catch (e) { console.error(e); }
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
    "Department of Chemistry",
    "Department of Computer Science",
    "Department of Econometrics",
    "Department of Economics",
    "Department of Education",
    "Department of Electrical & Electronics Engineering",
    "Department of English",
    "Department of Environmental Sciences",
    "Srinivasa Auditorium",
    "SVU Central Library",
    "SVU College of Arts",
    "SVU College of Commerce, Management & Computer Science",
    "SVU College of Engineering",
    "SVU College of Sciences"
];

const locationsModal = document.getElementById('locations-modal');
const locationsListEl = document.getElementById('locations-list');

// --- Document Upload Logic ---

let currentUploadTarget = 'admin'; // 'admin' or 'study'

function openUploadModal(target = 'admin') {
    currentUploadTarget = target;
    const modal = document.getElementById('upload-modal');
    if (!modal) return;

    // Update header based on target
    const header = modal.querySelector('.modal-header h3');
    if (header) {
        header.textContent = target === 'study' ? 'Upload Lecture Notes' : 'Upload Admin Document';
    }

    modal.classList.add('active');
    document.getElementById('upload-file').value = ""; // Reset
    const label = document.getElementById('file-label-text');
    if (label) label.textContent = "Click to upload PDF";
    document.getElementById('upload-progress').style.display = 'none';
}

function closeUploadModal() {
    document.getElementById('upload-modal').classList.remove('active');
}

async function submitDocument() {
    const fileInput = document.getElementById('upload-file');
    const file = fileInput.files[0];
    const statusText = document.getElementById('upload-status');
    const progressBar = document.getElementById('upload-bar');
    const progressDiv = document.getElementById('upload-progress');

    if (!file) {
        alert("Please select a PDF file first.");
        return;
    }

    progressDiv.style.display = 'block';
    statusText.textContent = currentUploadTarget === 'study' ? "Uploading notes..." : "Uploading and processing (Extracting FAQs)...";
    progressBar.style.width = "50%";

    const formData = new FormData();
    formData.append('file', file);

    try {
        const endpoint = currentUploadTarget === 'study' ? `${API_URL}/study-buddy/upload` : `${API_URL}/admin/upload-document`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Upload failed");
        }

        const data = await res.json();
        progressBar.style.width = "100%";
        statusText.textContent = "Upload Complete!";

        setTimeout(() => {
            closeUploadModal();
            showStatusPopup(currentUploadTarget === 'study' ? "Notes uploaded successfully!" : `Uploaded! ${data.faqs_extracted || 0} FAQs extracted.`);
            if (currentUploadTarget === 'study') {
                loadStudyBuddy();
            } else {
                loadDocuments();
                loadFAQs();
            }
        }, 1500);

    } catch (e) {
        progressBar.style.backgroundColor = "#ef4444";
        statusText.textContent = "Error: " + e.message;
    }
}

// URL Ingestion
const urlModal = document.getElementById('url-modal');
function openUrlModal() { if (urlModal) urlModal.classList.add('active'); }
function closeUrlModal() { if (urlModal) urlModal.classList.remove('active'); }

async function submitUrl() {
    const urlInput = document.getElementById('url-input');
    const url = urlInput.value.trim();
    const progressDiv = document.getElementById('url-progress');
    const statusText = document.getElementById('url-status');

    if (!url) {
        alert("Please enter a valid URL.");
        return;
    }

    progressDiv.style.display = 'block';
    statusText.textContent = "Scraping and processing (Extracting FAQs)...";
    statusText.style.color = "var(--accent-color)";

    try {
        const res = await fetch(`${API_URL}/admin/add-url`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ url: url })
        });

        if (!res.ok) throw new Error("Processing failed");

        const data = await res.json();
        progressDiv.style.display = 'none';

        statusText.textContent = `Success! ${data.faqs_extracted || 0} FAQs extracted.`;

        urlInput.value = "";

        setTimeout(() => {
            closeUrlModal();
            showStatusPopup(`URL added! ${data.faqs_extracted || 0} FAQs found.`);
            loadDocuments();
            loadFAQs();
        }, 1500);

    } catch (e) {
        statusText.textContent = "Error: " + e.message;
        statusText.style.color = "#ef4444";
    }
}

// --- Original Locations Logic Below ---
function openLocations() {
    if (locationsListEl) {
        // Keep the highlighter, clear and re-populate the rest
        const highlighter = document.getElementById('locations-highlighter');
        // Clear all except highlighter
        Array.from(locationsListEl.children).forEach(child => {
            if (child.id !== 'locations-highlighter') child.remove();
        });

        locations.forEach((name, index) => {
            const a = document.createElement('a');
            a.href = '#';
            a.className = 'location-item';
            if (index === 0) a.classList.add('active');
            a.textContent = name;

            a.onmouseenter = () => {
                if (highlighter) {
                    highlighter.style.top = `${a.offsetTop}px`;
                    highlighter.style.height = `${a.offsetHeight}px`;
                    highlighter.style.opacity = '1';
                }
            };

            a.onmouseleave = () => {
                if (highlighter) highlighter.style.opacity = '0';
            };

            a.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('.location-item').forEach(item => item.classList.remove('active'));
                a.classList.add('active');
                openLocationMap(name);
            };
            locationsListEl.appendChild(a);
        });
    }
    if (locationsModal) locationsModal.classList.add('active');
}

function closeLocations() { if (locationsModal) locationsModal.classList.remove('active'); }

function openLocationMap(name) {
    const query = `${name}, Sri Venkateswara University, Tirupati, Andhra Pradesh`;
    const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
    window.open(url, '_blank');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    sidebar.classList.toggle('active');

    // Create overlay if it doesn't exist
    if (!overlay && sidebar.classList.contains('active')) {
        const div = document.createElement('div');
        div.className = 'sidebar-overlay';
        div.onclick = toggleSidebar;
        document.body.appendChild(div);
        setTimeout(() => div.classList.add('active'), 10);
    } else if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

// --- Rich UI Interactions ---

// Ripple Effect
function createRipple(event) {
    const button = event.currentTarget;
    const circle = document.createElement("span");
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - button.getBoundingClientRect().left - radius}px`;
    circle.style.top = `${event.clientY - button.getBoundingClientRect().top - radius}px`;
    circle.classList.add("ripple");

    const ripple = button.getElementsByClassName("ripple")[0];
    if (ripple) {
        ripple.remove();
    }

    button.appendChild(circle);
}

const buttons = document.getElementsByTagName("button");
for (const button of buttons) {
    button.addEventListener("click", createRipple);
}

// Range Slider Value Update
const rangeInputs = document.querySelectorAll('.custom-range');
rangeInputs.forEach(input => {
    input.addEventListener('input', (e) => {
        e.target.nextElementSibling.textContent = (e.target.value / 100).toFixed(1);
    });
});

// Simulate System Health Logic (For demo)
setInterval(() => {
    const healthBar = document.querySelector('.progress-bar-fill');
    if (healthBar) {
        const usage = Math.floor(Math.random() * (80 - 40 + 1) + 40);
        healthBar.style.width = `${usage}%`;

        // Update color based on usage
        if (usage > 75) {
            healthBar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        } else {
            healthBar.style.background = 'linear-gradient(90deg, #3b82f6, #6366f1)';
        }
    }
}, 3000);

async function clearCache() {
    if (!confirm("Are you sure you want to clear the system cache? This will reset all active chat sessions.")) return;

    try {
        const res = await fetch(`${API_URL}/admin/cache/clear`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("System cache cleared successfully!");
        } else {
            alert("Failed to clear cache.");
        }
    } catch (e) {
        console.error(e);
        alert("Error clearing cache.");
    }
}

async function reindexData() {
    if (!confirm("Refresh knowledge base connection?\n(This re-initializes the RAG pipeline)")) return;

    showStatusPopup("Refreshing RAG pipeline...");

    try {
        const res = await fetch(`${API_URL}/admin/reindex`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("Knowledge base connection refreshed!");
            // Refresh health status to show new state
            loadSystemHealth();
        } else {
            alert("Failed to refresh connection.");
        }
    } catch (e) {
        console.error(e);
        alert("Error refreshing knowledge base.");
    }
}

// --- Auth UI Interactions ---
function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const forgotForm = document.getElementById('forgot-form');
    const loginBtn = document.getElementById('tab-login');
    const registerBtn = document.getElementById('tab-register');
    const errorEl = document.getElementById('auth-error');

    if (errorEl) errorEl.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'none';

    if (tab === 'login') {
        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
        if (loginBtn) loginBtn.classList.add('active');
        if (registerBtn) registerBtn.classList.remove('active');
    } else {
        if (loginForm) loginForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'block';
        if (loginBtn) loginBtn.classList.remove('active');
        if (registerBtn) registerBtn.classList.add('active');
    }
}

function showForgotPassword() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'block';
}

function startNewChat() {
    const chatBox = document.getElementById('chat-box');
    const welcomeScreen = document.getElementById('welcome-screen');
    if (chatBox) chatBox.innerHTML = '';
    if (welcomeScreen) welcomeScreen.style.display = 'flex';
    showStatusPopup("Thread cleared");
}


// --- Helper for File Upload UI ---
function handleFileSelect(input) {
    const label = input.nextElementSibling;
    const span = label.querySelector('span');
    const container = input.parentElement;

    if (input.files && input.files[0]) {
        span.innerHTML = `<span class="file-name-display"><i class="fa-solid fa-file-pdf"></i> ${input.files[0].name}</span>`;
        container.classList.add('file-selected');
    } else {
        span.textContent = "Click to upload PDF";
        container.classList.remove('file-selected');
    }
}

// --- New Toast Notification Implementation ---
function showStatusPopup(message, duration = 2000) {
    let toast = document.getElementById('toast-notification');
    // Remove old style popup if it exists (legacy cleanup)
    const oldPopup = document.getElementById('status-popup');
    if (oldPopup) oldPopup.remove();

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }

    // Icon based on message type
    let icon = '<i class="fa-solid fa-circle-info" style="color: #2dd4bf;"></i>';
    if (message.toLowerCase().includes('error')) icon = '<i class="fa-solid fa-circle-exclamation" style="color: #ef4444;"></i>';
    if (message.toLowerCase().includes('success')) icon = '<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;

    // Force Reflow
    void toast.offsetWidth;

    toast.classList.add('show');

    if (toast.timeoutId) clearTimeout(toast.timeoutId);

    toast.timeoutId = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// --- User Management Logic ---

async function loadUsers() {
    try {
        const res = await fetch(`${API_URL}/admin/users`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;
        const users = await res.json();
        renderUsersTable(users, 3);
    } catch (e) {
        console.error("Load Users Error", e);
    }
}

function renderUsersTable(users, limit = null) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    // Safety check for container traversal
    let container = tbody.parentElement;
    if (container) container = container.parentElement;

    if (container && !container.classList.contains('settings-card')) {
        if (container.parentElement && container.parentElement.classList.contains('settings-card')) {
            container = container.parentElement;
        }
    }

    // Add View More button if not exists
    let btn = null;
    if (container) {
        btn = container.querySelector('.btn-view-more-users');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btn-secondary btn-view-more-users';
            btn.style.width = '100%';
            btn.style.marginTop = '15px';
            btn.style.textAlign = 'center';
            container.appendChild(btn);
        }
    }

    tbody.innerHTML = '';
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No users found.</td></tr>';
        if (btn) btn.style.display = 'none';
        return;
    }

    const showCount = limit ? limit : users.length;
    const visibleUsers = users.slice(0, showCount);

    visibleUsers.forEach(u => {
        const initial = u.username.charAt(0).toUpperCase();
        let roleBadge = 'info';
        if (u.role === 'admin') roleBadge = 'success'; // Admin = Green
        if (u.role === 'student') roleBadge = 'warning'; // Student = Orange/Yellow

        const roleLabel = u.role.charAt(0).toUpperCase() + u.role.slice(1);
        const joinedDate = new Date(u.created_at).toLocaleDateString();

        tbody.innerHTML += `
        <tr>
            <td style="padding: 12px; display: flex; align-items: center; gap: 10px;">
                <div style="width: 32px; height: 32px; background: ${u.role === 'admin' ? '#6366f1' : '#10b981'}; color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                    ${initial}
                </div>
                <div>
                    <div style="font-weight: 600;">${escapeHtml(u.username)}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">ID: ...${u.id.substring(u.id.length - 6)}</div>
                </div>
            </td>
            <td style="padding: 12px;"><span class="badge ${roleBadge}">${roleLabel}</span></td>
            <td style="padding: 12px; font-size: 13px;">${joinedDate}</td>
            <td style="padding: 12px; text-align: right;">
                <button class="icon-btn" onclick="toggleUserRole('${u.id}', '${u.role}')" title="Switch Role">
                    <i class="fa-solid fa-user-shield"></i>
                </button>
                <button class="icon-btn" onclick="deleteUser('${u.id}')" style="color: #ef4444;" title="Delete User">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });

    if (btn) {
        if (users.length <= 3) {
            btn.style.display = 'none';
        } else {
            btn.style.display = 'block';
            if (limit) {
                btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> View More (${users.length - 3} more)`;
                btn.onclick = () => renderUsersTable(users, null);
            } else {
                btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> View Less`;
                btn.onclick = () => renderUsersTable(users, 3);
            }
        }
    }
}

async function deleteUser(id) {
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;

    try {
        const res = await fetch(`${API_URL}/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        const data = await res.json();
        if (res.ok) {
            showStatusPopup("User deleted successfully");
            loadUsers();
        } else {
            alert(data.detail || "Failed to delete user");
        }
    } catch (e) { console.error(e); }
}

async function toggleUserRole(id, currentRole) {
    const newRole = currentRole === 'admin' ? 'student' : 'admin';
    if (!confirm(`Switch this user's role to ${newRole.toUpperCase()}?`)) return;

    try {
        const res = await fetch(`${API_URL}/admin/users/${id}/role`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ role: newRole })
        });

        if (res.ok) {
            showStatusPopup(`User is now ${newRole}`);
            loadUsers();
        } else {
            alert("Failed to update role");
        }
    } catch (e) { console.error(e); }
}

// --- System Health and LLM Config Logic ---

async function loadSystemHealth() {
    if (!ACCESS_TOKEN) return;
    try {

        const start = Date.now();
        const res = await fetch(`${API_URL}/admin/system-health`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        const latency = Date.now() - start;
        const data = await res.json();

        // Map to "System Health & Governance" card IDs

        // 1. API Status (Latency) -> #health-api
        const apiBadge = document.getElementById('health-api');
        if (apiBadge) {
            apiBadge.textContent = `${latency}ms`;
            apiBadge.className = `badge ${latency < 200 ? 'success' : 'warning'}`;
        }

        // 2. Vector DB -> #health-vector
        const vectorStatus = data.vector_db_status || 'unknown';
        const vectorBadge = document.getElementById('health-vector');
        if (vectorBadge) {
            vectorBadge.textContent = vectorStatus === 'active' ? 'CONNECTED' : 'OFFLINE';
            vectorBadge.className = `badge ${vectorStatus === 'active' ? 'success' : 'error'}`;
        }

        // 3. MongoDB -> #health-mongo
        const mongoStatus = data.mongodb_status || 'unknown';
        const mongoBadge = document.getElementById('health-mongo');
        if (mongoBadge) {
            mongoBadge.textContent = mongoStatus.toUpperCase();
            mongoBadge.className = `badge ${mongoStatus === 'connected' ? 'success' : 'error'}`;
        }

        // 4. LLM Service -> #health-llm
        const llmBadge = document.getElementById('health-llm');
        if (llmBadge) {
            llmBadge.textContent = data.llm_service.toUpperCase();
            llmBadge.className = `badge ${data.llm_service === 'online' ? 'success' : 'error'}`;
        }

    } catch (e) {
        console.error("Error checking notifications:", e);
    }
}

// User Management Modal Actions
function openAddUserModal() {
    const modal = document.getElementById('add-user-modal');
    if (modal) modal.classList.add('active');
}

function closeAddUserModal() {
    const modal = document.getElementById('add-user-modal');
    if (modal) modal.classList.remove('active');
}

async function submitAddUser() {
    const email = document.getElementById('new-user-email').value.trim();
    const pass = document.getElementById('new-user-pass').value;
    const role = document.getElementById('new-user-role').value;

    if (!email || !pass) {
        showStatusPopup("Please fill all fields", "warning");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/admin/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ username: email, password: pass, role: role })
        });
        const data = await res.json();
        if (res.ok) {
            showStatusPopup("User created successfully!");
            closeAddUserModal();
            loadAllUsers(); // Refresh the list
        } else {

            showStatusPopup(data.detail || "Failed to create user", "error");
        }
    } catch (e) {
        console.error(e);
        showStatusPopup("Connection error", "error");
    }
}


// --- Study Buddy Feature ---
async function loadStudyBuddy() {
    if (!ACCESS_TOKEN) return;
    const listEl = document.getElementById('study-materials-list');

    const examsEl = document.getElementById('study-exams-list');
    if (!listEl) return;

    // Load Materials
    try {
        const res = await fetch(`${API_URL}/study-buddy/materials`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (res.ok) {
            const materials = await res.json();
            if (materials.length === 0) {
                listEl.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No notes uploaded yet. Start by uploading a PDF!</p>';
            } else {
                listEl.innerHTML = '';
                materials.forEach(m => {
                    const date = new Date(m.upload_date).toLocaleDateString();
                    listEl.innerHTML += `
                    <div class="study-material-item">
                        <div class="material-content" onclick="summarizeMaterial('${m.id}')" style="display: flex; align-items: center; gap: 15px; flex: 1; cursor: pointer;">
                            <div class="material-icon"><i class="fa-solid fa-file-pdf"></i></div>
                            <div class="material-details">
                                <span class="material-name">${escapeHtml(m.filename)}</span>
                                <span class="material-meta">Uploaded on ${date}</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div class="action-btn" title="Summarize" onclick="summarizeMaterial('${m.id}')"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                            <div class="action-btn delete" title="Delete" onclick="deleteStudyMaterial('${m.id}')" style="color: #ef4444;"><i class="fa-solid fa-trash-can"></i></div>
                        </div>
                    </div>`;
                });
            }
        }
    } catch (e) { console.error("Load Materials Error", e); }

    // Load Exams
    try {
        const res = await fetch(`${API_URL}/study-buddy/exams`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (res.ok) {
            const exams = await res.json();
            if (exams.length === 0) {
                examsEl.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 13px;">No upcoming exams found.</p>';
            } else {
                examsEl.innerHTML = '';
                exams.forEach(ex => {
                    const d = new Date(ex.date);
                    const formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    examsEl.innerHTML += `
                    <div style="display: flex; gap: 12px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 10px; border-left: 3px solid #ef4444;">
                        <div style="text-align: center; min-width: 45px;">
                            <div style="font-size: 11px; text-transform: uppercase; color: #ef4444; font-weight: 700;">${d.toLocaleDateString('en-US', { month: 'short' })}</div>
                            <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">${d.getDate()}</div>
                        </div>
                        <div>
                            <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${escapeHtml(ex.subject)}</div>
                            <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(ex.department)}</div>
                        </div>
                    </div>`;
                });
            }
        }
    } catch (e) { console.error("Load Exams Error", e); }
}

async function deleteStudyMaterial(id) {
    if (!confirm("Are you sure you want to delete this material?")) return;

    try {
        const res = await fetch(`${API_URL}/study-buddy/materials/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (res.ok) {
            showStatusPopup("Material deleted");
            loadStudyBuddy();
            document.getElementById('material-summary-content').innerHTML = "Select a document to generate a smart AI summary.";
        }
    } catch (e) { console.error(e); }
}


async function summarizeMaterial(id) {
    const summaryEl = document.getElementById('material-summary-content');
    summaryEl.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing content...</div>';

    try {
        const res = await fetch(`${API_URL}/study-buddy/summarize/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Summary extraction failed");
        }

        const data = await res.json();
        summaryEl.innerHTML = `<div class="markdown-body">${marked.parse(data.summary)}</div>`;
    } catch (e) {
        summaryEl.innerHTML = `<p style="color: #ef4444;">Failed to generate summary: ${e.message}</p>`;
        console.error(e);
    }
}

// --- Career Center Feature ---
async function loadCareerCenter() {
    // Placements feature removed - focusing on Resume Checker
}

async function checkResume() {
    const textInput = document.getElementById('resume-text-input');
    const text = textInput ? textInput.value.trim() : "";
    const feedbackEl = document.getElementById('resume-feedback');

    if (!text) {
        alert("Please paste your resume text first.");
        return;
    }

    feedbackEl.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing resume...</div>';

    try {
        const res = await fetch(`${API_URL}/career/check-resume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ resume_text: text })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Server error");
        }

        const data = await res.json();
        feedbackEl.innerHTML = `<div class="markdown-body">${marked.parse(data.analysis)}</div>`;
    } catch (e) {
        feedbackEl.innerHTML = `<p style="color: #ef4444;">Analysis failed: ${e.message}</p>`;
        console.error(e);
    }
}

// --- Exam Countdown ---



async function adminAddExam() {
    const subject = document.getElementById('admin-exam-subject').value;
    const date = document.getElementById('admin-exam-date').value;
    if (!subject || !date) return alert("Fill all fields");

    try {
        const res = await fetch(`${API_URL}/study-buddy/add-exam`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ subject, date, department: "Common" })
        });
        if (res.ok) {
            showStatusPopup("Exam date added!");
            document.getElementById('admin-exam-subject').value = '';
            document.getElementById('admin-exam-date').value = '';
            loadCareerCenter(); // Refresh career center instead if needed, or nothing
        }
    } catch (e) { console.error(e); }
}




