const API_URL = window.location.origin;
console.log("Using API_URL:", API_URL);

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

    // Ensure the default section is shown
    setTimeout(() => {
        showSection('chat');
    }, 100);

    loadChatHistory();
    populateSidebarProfile();
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
}

function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('username');
    ACCESS_TOKEN = null;
    USER_ROLE = null;

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

const incognitoToggle = document.getElementById('incognito-toggle');
let isIncognito = false;

if (incognitoToggle) {
    incognitoToggle.addEventListener('change', (e) => {
        isIncognito = e.target.checked;
        if (isIncognito) {
            document.body.classList.add('incognito-active');
        } else {
            document.body.classList.remove('incognito-active');
        }
    });
}

// Polling for Notifications
setInterval(checkNotifications, 10000);


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

function showSection(section) {
    // Prevent non-admins from accessing restricted sections
    if ((section === 'admin' || section === 'dashboard') && USER_ROLE !== 'admin') {
        showSection('chat');
        return;
    }

    const sections = ['chat', 'admin', 'dashboard'];

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
        // loadUsers(); // Restored static UI for now
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
    appendMessage(text, 'user', !isIncognito);
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

        appendMessage(data.response || "I'm having trouble connecting right now.", 'bot', !isIncognito);

    } catch (err) {
        hideTypingIndicator();
        appendMessage("I apologize, but I'm unable to reach the server at the moment. Please try again later.", 'bot');
    }

    scrollToBottom();
}

// Removing duplicate saveSession placeholder


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

        renderChart(data.role_distribution);

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
    try {
        const res = await fetch(`${API_URL}/admin/documents`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;
        const docs = await res.json();
        allDocuments = docs; // Update global store
        renderDocuments(docs);
    } catch (e) { console.error("Load Docs Error", e); }
}

function renderDocuments(docs) {
    const tbody = document.getElementById('documents-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (docs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No documents found.</td></tr>';
        return;
    }

    docs.forEach(doc => {
        const dateStr = new Date(doc.upload_date).toLocaleDateString();
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

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(speakBtn);

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

async function loadSystemHealth() {
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

    console.log(`[TTS] Available voices: ${availableVoices.length}`);

    const preferredVoice = availableVoices.find(v =>
        (v.name.includes("Zira") ||
            v.name.includes("Google US English") ||
            v.name.includes("Female")) &&
        v.lang.startsWith("en")
    );

    if (preferredVoice) {
        console.log(`[TTS] Using voice: ${preferredVoice.name}`);
        utterance.voice = preferredVoice;
    } else {
        console.log("[TTS] No preferred voice found, using default/first English.");
        const anyEnglish = availableVoices.find(v => v.lang.startsWith("en"));
        if (anyEnglish) utterance.voice = anyEnglish;
    }

    utterance.lang = 'en-US';
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

    const targetSpan = spans.find(span => {
        const start = parseInt(span.dataset.start);
        const end = parseInt(span.dataset.end);
        return charIndex >= start && charIndex < end;
    });

    if (targetSpan) {
        targetSpan.classList.add('speaking-word');
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

        list.innerHTML += `
            <div class="faq-card">
                ${deleteBtn}
                <h4>${escapeHtml(item.question)}</h4>
                <div class="faq-meta" style="font-size: 0.8em; color: #0f766e; margin-bottom: 5px;">${escapeHtml(item.category || 'General')}</div>
                <p>${escapeHtml(item.answer)}</p>
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
function openModal() { if (modal) modal.style.display = 'block'; }
function closeModal() { if (modal) modal.style.display = 'none'; }

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

function openUploadModal() {
    document.getElementById('upload-modal').style.display = 'flex';
    document.getElementById('upload-file').value = ""; // Reset
    document.getElementById('upload-progress').style.display = 'none';
}

function closeUploadModal() {
    document.getElementById('upload-modal').style.display = 'none';
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
    statusText.textContent = "Uploading and processing...";
    progressBar.style.width = "50%";

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_URL}/admin/upload`, {
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
        statusText.textContent = "Complete! " + data.message;

        setTimeout(() => {
            closeUploadModal();
            alert("Document uploaded and ingested successfully!");
            // Optionally refresh a document list here
            loadDocuments();
        }, 1500);

    } catch (e) {
        progressBar.style.backgroundColor = "#ef4444";
        statusText.textContent = "Error: " + e.message;
    }
}

// URL Ingestion
const urlModal = document.getElementById('url-modal');
function openUrlModal() { if (urlModal) urlModal.style.display = 'flex'; }
function closeUrlModal() { if (urlModal) urlModal.style.display = 'none'; }

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
    statusText.textContent = "Scraping and processing content...";
    statusText.style.color = "var(--accent-color)";

    try {
        const res = await fetch(`${API_URL}/admin/ingest-url`, {
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
        showStatusPopup(`Success: ${data.message}`);
        urlInput.value = "";

        loadDocuments();
        closeUrlModal();
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
    if (locationsModal) locationsModal.style.display = 'flex';
}

function closeLocations() { if (locationsModal) locationsModal.style.display = 'none'; }

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
    if (!confirm("Are you sure you want to clear the system cache?")) return;
    showStatusPopup("Clearing cache...");
    setTimeout(() => showStatusPopup("Cache cleared successfully!"), 1000);
}

async function reindexData() {
    if (!confirm("Trigger full knowledge re-indexing? This may take a few minutes.")) return;
    showStatusPopup("Indexing started...");
    setTimeout(() => showStatusPopup("Knowledge base re-indexed!"), 2000);
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
