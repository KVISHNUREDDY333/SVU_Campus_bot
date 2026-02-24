const API_URL = window.location.origin;
console.log("Using API_URL:", API_URL);
console.log("SVU Bot Script v11-DEBUG Loaded");

// DOM Elements
const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const typingIndicator = document.getElementById('typing-indicator');

// Mobile Sidebar Toggle
function toggleSidebar(forceClose = null) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (forceClose === true) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        return;
    }

    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// Theme Logic
function toggleTheme() {
    // Check if user is logged in
    if (!ACCESS_TOKEN) {
        showStatusPopup("Please log in to switch themes");
        return;
    }

    const body = document.body;
    body.classList.toggle('dark-mode');

    // Update Icon and Text
    updateThemeUI(body.classList.contains('dark-mode'));

    // Save preference
    sessionStorage.setItem('svu_theme', body.classList.contains('dark-mode') ? 'dark' : 'light');
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
let ACCESS_TOKEN = sessionStorage.getItem('access_token');
let USER_ROLE = sessionStorage.getItem('user_role');


document.addEventListener("DOMContentLoaded", () => {
    // Load Theme Preference
    const savedTheme = sessionStorage.getItem('svu_theme');
    const hasSession = !!sessionStorage.getItem('access_token');

    // Default to light unless there's an active session AND dark was saved
    if (hasSession && savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        updateThemeUI(true);
    } else {
        document.body.classList.remove('dark-mode');
        updateThemeUI(false);
        // If no session, ensure storage is also light
        if (!hasSession) {
            sessionStorage.setItem('svu_theme', 'light');
        }
    }

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
        const fullName = urlParams.get('name');

        console.log("Google Login Success:", username);
        saveSession({
            access_token: token,
            role: role,
            username: username,
            full_name: fullName
        });

        // Clean URL
        window.history.replaceState({}, document.title, "/");
    }

    // Check Auth first
    if (checkAuth()) {

        loadChatHistory();
        populateSidebarProfile();
    }



    // Force Unregister Service Worker to clear cache
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister().then(() => console.log("Service Worker Unregistered"));
            }
        });
    }

    // Request Notification Permission
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    // Theme extracted to top of DOMContentLoaded

    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        setTimeout(() => {
            splashScreen.classList.add('fade-out');
            setTimeout(() => {
                splashScreen.style.display = 'none';
            }, 800);
        }, 1500);
    }

    // Load Trending Queries
    loadTrendingQueries();

    if (userInput) {
        userInput.value = ''; // Prevent browser autofill
        userInput.focus();
    }

    // Ensure the default section is shown
    setTimeout(() => {
        showSection('chat');
    }, 100);


    // Clear Auth Inputs on Load with delay to fight autofill
    setTimeout(clearAuthInputs, 500);

    // Also clear on page show (bfcache)
    window.addEventListener('pageshow', () => {
        setTimeout(clearAuthInputs, 500);
    });
});

function clearAuthInputs() {
    const ids = [
        'login-username', 'login-password',
        'reg-username', 'reg-fullname', 'reg-password',
        'forgot-email', 'forgot-otp', 'forgot-new-password'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}



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
    // Clear inputs when switching
    clearAuthInputs();

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
    const role = "student";
    const password = document.getElementById('reg-password').value;
    const errorEl = document.getElementById('auth-error');

    // Frontend Validation
    if (!validateEmail(username)) {
        errorEl.textContent = "Invalid email format.";
        errorEl.style.display = 'block';
        return;
    }

    // Full Name Validation
    const nameRegex = /^[A-Za-z\s]+$/;
    if (!nameRegex.test(fullName)) {
        errorEl.textContent = "Full Name must contain only alphabets and spaces (no numbers or special characters).";
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
    // Force Light Mode on New Session (as per requirements)
    // "change the theme to light only when user or admin is logged out or login"
    sessionStorage.setItem('svu_theme', 'light');
    document.body.classList.remove('dark-mode');
    updateThemeUI(false);

    ACCESS_TOKEN = data.access_token;
    USER_ROLE = data.role;
    sessionStorage.setItem('access_token', ACCESS_TOKEN);
    sessionStorage.setItem('user_role', USER_ROLE);
    sessionStorage.setItem('username', data.username);
    sessionStorage.setItem('full_name', data.full_name || data.username);

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
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('user_role');
    sessionStorage.removeItem('username');
    sessionStorage.removeItem('full_name');
    sessionStorage.removeItem('svu_chat_history'); // Clear chat history on logout
    sessionStorage.removeItem('chat_session_id');
    localStorage.removeItem('last_notification_id'); // Optional: clear notifications too
    
    ACCESS_TOKEN = null;
    USER_ROLE = null;

    // Reset to Light Mode on Logout
    sessionStorage.setItem('svu_theme', 'light');
    document.body.classList.remove('dark-mode');
    updateThemeUI(false);


    // Hide restricted links immediately
    const navAdmin = document.getElementById('nav-admin');
    const navDashboard = document.getElementById('nav-dashboard');
    if (navAdmin) navAdmin.style.display = 'none';
    if (navDashboard) navDashboard.style.display = 'none';

    location.reload();
}

// Chat History State
let chatHistory = JSON.parse(sessionStorage.getItem('svu_chat_history') || '[]');

function loadChatHistory() {
    if (chatHistory.length > 0 && welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }
    chatHistory.forEach(msg => appendMessage(msg.text, msg.sender, false));
    if (chatHistory.length > 0) scrollToBottom();
}

// ... existing code ...






function populateSidebarProfile() {
    const fullName = sessionStorage.getItem('full_name');
    const role = sessionStorage.getItem('user_role');
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



async function loadTrendingQueries() {
    console.time("TrendingQueriesLoad");
    try {
        const res = await fetch(`${API_URL}/admin/trending`);
        const data = await res.json();
        const container = document.getElementById('trending-queries-container');
        
        if (!container) return;
        container.innerHTML = '';
        
        if (data.length === 0) {
            // Fallback if no dynamic queries
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:10px;">Ask me anything!</p>';
            console.timeEnd("TrendingQueriesLoad");
            return;
        }
        
        data.forEach(q => {
            const card = document.createElement('div');
            card.className = 'suggestion-card';
            // Pass response if it exists, otherwise just text
            const responseArg = q.response ? `, '${q.response.replace(/'/g, "\\'")}'` : '';
            card.setAttribute('onclick', `appendQuick('${q.text.replace(/'/g, "\\'")}'${responseArg})`);
            card.innerHTML = `<div class='icon'><i class='${q.icon}'></i></div><div><div class='title'>${q.text}</div><div class='desc'>${q.subtext}</div></div>`;
            container.appendChild(card);
        });
        console.timeEnd("TrendingQueriesLoad");
    } catch (e) { 
        console.error('Failed to load trending queries', e); 
        console.timeEnd("TrendingQueriesLoad");
    }
}



function showSection(section) {
    console.warn(`[DEBUG] showSection called for: ${section}`);

    // Auto-close sidebar on mobile
    if (window.innerWidth <= 768) {
        toggleSidebar(true);
    }
    
    // Prevent non-admins from accessing restricted sections
    if ((section === 'admin' || section === 'dashboard') && USER_ROLE !== 'admin') {
        console.warn(`[DEBUG] Access denied for ${section}. Role: ${USER_ROLE}`);
        showSection('chat');
        return;
    }

    const sections = ['chat', 'admin', 'dashboard', 'calendar', 'locations', 'study', 'career'];

    sections.forEach(s => {
        const el = document.getElementById(`${s}-section`);
        if (el) el.style.display = 'none';

        const nav = document.getElementById(`nav-${s}`);
        if (nav) nav.classList.remove('active');
    });

    const activeSection = document.getElementById(`${section}-section`);
    if (activeSection) {
        // We use flex for chat and locations sections to maintain layout, block for others
        activeSection.style.display = (section === 'chat' || section === 'locations') ? 'flex' : 'block';
    }

    const activeNav = document.getElementById(`nav-${section}`);
    if (activeNav) activeNav.classList.add('active');

    // Trigger specific loaders
    if (section === 'dashboard') {
        console.warn("[DEBUG] Triggering loadDashboard from showSection");
        loadDashboard();
    }
    if (section === 'admin') {
        loadDashboard(); // Ensure dashboard stats/charts are loaded
        loadDocuments();
        loadAllTickets();
        loadAcademicCalendar(); // Load admin calendar management table
        loadUsers();
        fetchLocations();
        loadSystemHealth();
        loadSuggestedFAQs();
        loadAdminTrending();
        loadTrainStatus(); // Load training status dashboard
    }

    if (section === 'calendar') {
        loadCalendar(); // Load student calendar view
    }
    if (section === 'study') {
        loadStudyBuddy();
    }
    if (section === 'locations') {
        fetchLocations(); // Fetch and render locations
    }
    if (section === 'career') {
        loadCareerCenter();
    }
    if (section === 'chat') {
        // Countdown widget removed
    }
}

async function appendQuick(text, preDefinedResponse = null) {
    if (preDefinedResponse) {
        // Hide welcome screen if visible
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen && welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
        }
        
        appendMessage(text, 'user', true);
        showTypingIndicator();
        
        // Simulate a small delay for natural feeling
        setTimeout(() => {
            hideTypingIndicator();
            appendMessage(preDefinedResponse, 'bot', true);
            scrollToBottom();
        }, 600);
        return;
    }

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
    let sessionId = sessionStorage.getItem('chat_session_id');
    if (!sessionId) {
        sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('chat_session_id', sessionId);
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

        if (response.status === 401) {
            alert("Session expired. Please log in again.");
            logout();
            return;
        }

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
    console.warn("[DEBUG] loadDashboard function STARTED");
    if (!ACCESS_TOKEN) {
        console.error("[DEBUG] No ACCESS_TOKEN found!");
        return;
    }

    try {
        console.log("[DEBUG] Fetching /dashboard-stats...");
        const res = await fetch(`${API_URL}/dashboard-stats`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (!res.ok) {
            console.error("Dashboard API Failed:", res.status);
            return;
        }

        const data = await res.json();
        console.warn("[DEBUG] Dashboard Data Received:", data);

        // precise helpers to update text
        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setText('total-queries', data.total_queries);
        setText('active-users', data.active_users);
        
        // Update Documents Count
        const docCount = (data.total_documents !== undefined) ? data.total_documents : 0;
        setText('total-documents', docCount);

        // Update description text in Settings card if it exists
        // const docDesc = document.querySelector('.settings-card p');
        // if (docDesc && docDesc.textContent.includes('documents in your knowledge base')) {
        //      docDesc.textContent = `You have ${docCount} documents in your knowledge base. Use the Admin Settings to add, remove, or update documents.`;
        // }

        renderCharts(data.role_distribution, data.sentiment_stats);
        
        // Start live updates for other components
        loadSystemHealth();
        loadFAQs();
        loadDocuments();
        loadUsers();

    } catch (e) {
        console.error("Dashboard Loading Error:", e);
        showStatusPopup("Failed to refresh dashboard: " + e.message, 3000);
    }
}

async function loadUsers() {
    // Function removed - see optimized version below
    console.warn("Using deprecated loadUsers - check script.js structure");
}

async function loadDocuments() {
    if (!ACCESS_TOKEN) return;
    try {
        const res = await fetch(`${API_URL}/admin/documents?limit=50`, {
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
        btn = container.querySelector('.btn-view-more');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btn-secondary btn-view-more';
            btn.style.width = '100%';
            btn.style.marginTop = '15px';
            btn.style.textAlign = 'center';
            container.appendChild(btn);
        }
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
        let iconClass = 'fa-file-pdf';
        let typeLabel = 'PDF';
        let badgeClass = 'success';

        if (doc.type === 'url') {
            iconClass = 'fa-link';
            typeLabel = 'URL';
            badgeClass = 'warning';
        } else if (doc.type === 'text') {
            iconClass = 'fa-pen';
            typeLabel = 'TEXT';
            badgeClass = 'info';
        }

        tbody.innerHTML += `
            <tr>
                <td style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid ${iconClass}" style="color: var(--accent-color);"></i>
                    ${escapeHtml(doc.filename)}
                </td>
                <td><span class="badge ${badgeClass}">${typeLabel}</span></td>
                <td style="text-align: center;">${doc.chunks || 0}</td>
                <td style="text-align: center;">${doc.extracted_faqs || 0}</td>
                <td style="text-align: center;">${doc.uploaded_by || 'Admin'}</td>
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
            showStatusPopup("Document deleted.");
            loadDocuments();
        }
    } catch (e) { console.error(e); }
}


/**
 * FAQ Management: View All FAQs
 */
let allFaqsData = [];
let currentFilteredFAQs = [];
let currentFAQPage = 0;
const FAQ_BATCH_SIZE = 50;
let activeFAQFilterDocId = null; 
let activeFAQFilterSource = null; 

async function loadAllFAQs() {
    console.log("loadAllFAQs called", activeFAQFilterSource ? "Filtering by: " + activeFAQFilterSource : "Show All");
    const list = document.getElementById('all-faqs-list');
    const empty = document.getElementById('all-faqs-empty');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color);"></i><p style="margin-top:15px;color:var(--text-secondary);">Loading FAQs...</p></div>';
    empty.style.display = 'none';

    // Update modal header actions
    const actionContainer = document.getElementById('modal-action-container');
    if (actionContainer) {
        actionContainer.innerHTML = '';
    }

    try {
        const res = await fetch(`${API_URL}/admin/faqs`);
        if (!res.ok) throw new Error("Failed to fetch FAQs: " + res.status);
        const faqs = await res.json();
        
        allFaqsData = Array.isArray(faqs) ? faqs : [];
        
        // Apply Source Filter if active
        if (activeFAQFilterSource) {
            currentFilteredFAQs = allFaqsData.filter(f => 
                f.source_urls && f.source_urls.includes(activeFAQFilterSource)
            );
        } else {
            currentFilteredFAQs = allFaqsData;
        }

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
    
    const modal = document.getElementById('all-faqs-modal');
    if (modal) {
        modal.classList.add('active');
        
        // Update header for document-specific view
        const modalTitle = document.getElementById('faq-modal-title');
        const modalSubtitle = document.getElementById('faq-modal-subtitle');
        if (modalTitle) modalTitle.textContent = "Extracted FAQs";
        if (modalSubtitle) modalSubtitle.textContent = `Source: ${filename}`;

        // Reset sub-filters when viewing specific doc
        const categoryFilter = document.getElementById('faq-category-filter');
        const searchInput = document.getElementById('faq-search-input');
        if (categoryFilter) categoryFilter.value = "";
        if (searchInput) searchInput.value = "";
        
        await loadAllFAQs();
    }
}

async function openAllFaqsModal() {
    activeFAQFilterDocId = null;
    activeFAQFilterSource = null;
    
    const modal = document.getElementById('all-faqs-modal');
    if (modal) {
        modal.classList.add('active');

        // Update header for all FAQs view
        const modalTitle = document.getElementById('faq-modal-title');
        const modalSubtitle = document.getElementById('faq-modal-subtitle');
        if (modalTitle) modalTitle.textContent = "Knowledge Base FAQs";
        if (modalSubtitle) modalSubtitle.textContent = "Browse, edit, and manage all extracted FAQs";

        await loadAllFAQs();
    }
}

function closeAllFaqsModal() {
    const modal = document.getElementById('all-faqs-modal');
    if (modal) {
        modal.classList.remove('active');
        activeFAQFilterDocId = null;
        activeFAQFilterSource = null;
    }
}

function updateFAQCount() {
    const countEl = document.getElementById('faq-count');
    if (countEl) {
        countEl.textContent = `Showing ${Math.min((currentFAQPage + 1) * FAQ_BATCH_SIZE, currentFilteredFAQs.length)} of ${currentFilteredFAQs.length} FAQs`;
    }
}

function renderAllFAQs(reset = false) {
    const list = document.getElementById('all-faqs-list');
    const empty = document.getElementById('all-faqs-empty');
    if (!list) return;

    if (currentFilteredFAQs.length === 0) {
        list.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    list.style.display = 'block';
    empty.style.display = 'none';

    if (reset) {
        list.innerHTML = '';
        currentFAQPage = 0;
    }

    const start = currentFAQPage * FAQ_BATCH_SIZE;
    const end = start + FAQ_BATCH_SIZE;
    const batch = currentFilteredFAQs.slice(start, end);

    batch.forEach(f => {
        list.appendChild(renderFAQItem(f));
    });

    // Handle "View More" button
    const existingBtn = document.getElementById('faq-view-more-btn');
    if (existingBtn) existingBtn.remove();

    if (end < currentFilteredFAQs.length) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'faq-view-more-btn';
        loadMoreBtn.className = 'btn-secondary';
        loadMoreBtn.style.display = 'block';
        loadMoreBtn.style.width = '100%';
        loadMoreBtn.style.marginTop = '20px';
        loadMoreBtn.innerHTML = `View More (${currentFilteredFAQs.length - end} remaining)`;
        loadMoreBtn.onclick = () => {
            currentFAQPage++;
            renderAllFAQs(false);
            updateFAQCount();
        };
        list.appendChild(loadMoreBtn);
    }
}

function filterFAQs() {
    const categoryFilter = document.getElementById('faq-category-filter');
    const searchInput = document.getElementById('faq-search-input');
    if (!categoryFilter || !searchInput) return;

    const category = categoryFilter.value;
    const term = searchInput.value.toLowerCase().trim();

    let filtered = allFaqsData;
    if (category) {
        filtered = filtered.filter(f => f.category === category);
    }
    if (term) {
        filtered = filtered.filter(f => 
            f.question.toLowerCase().includes(term) || 
            f.answer.toLowerCase().includes(term)
        );
    }

    currentFilteredFAQs = filtered;
    renderAllFAQs(true);
    updateFAQCount();
}

/**
 * Shared FAQ Item Renderer
 */
function renderFAQItem(f) {
    const item = document.createElement('div');
    item.className = 'faq-item';
    item.id = `all-faq-item-${f.id}`;
    item.style.marginBottom = '20px';
    item.style.padding = '15px';
    item.style.background = 'var(--bg-secondary)';
    item.style.borderRadius = '12px';
    item.style.border = '1px solid var(--border-color)';

    item.innerHTML = `
        <div class="faq-display-mode">
            <div style="font-weight: 600; color: var(--accent-color); margin-bottom: 8px; font-size: 15px;">Q: ${escapeHtml(f.question)}</div>
            <div style="color: var(--text-primary); line-height: 1.5; font-size: 14px;">A: ${escapeHtml(f.answer)}</div>
            <div style="margin-top: 12px; display: flex; gap: 10px; align-items: center;">
                <span class="badge info" style="font-size: 10px; padding: 4px 8px;">${escapeHtml(f.category || 'General')}</span>
                <div style="margin-left: auto; display: flex; gap: 12px;">
                    <button onclick="enableEditAllFAQ('${f.id}')" style="background: none; border: none; color: var(--primary-color); cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button onclick="deleteAllFAQ('${f.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        </div>
        
        <div class="faq-edit-mode" style="display: none;">
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <input type="text" id="all-edit-q-${f.id}" value="${escapeHtml(f.question)}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                <textarea id="all-edit-a-${f.id}" rows="4" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">${escapeHtml(f.answer)}</textarea>
                <div style="display: flex; gap: 10px;">
                    <select id="all-edit-c-${f.id}" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                        <option value="General" ${f.category === 'General' ? 'selected' : ''}>General</option>
                        <option value="Academic" ${f.category === 'Academic' ? 'selected' : ''}>Academic</option>
                        <option value="Admissions" ${f.category === 'Admissions' ? 'selected' : ''}>Admissions</option>
                        <option value="Facilities" ${f.category === 'Facilities' ? 'selected' : ''}>Facilities</option>
                        <option value="Hostels" ${f.category === 'Hostels' ? 'selected' : ''}>Hostels</option>
                        <option value="Placements" ${f.category === 'Placements' ? 'selected' : ''}>Placements</option>
                        <option value="User added faqs" ${f.category === 'User added faqs' ? 'selected' : ''}>User Contributions</option>
                    </select>
                    <button onclick="cancelEditAllFAQ('${f.id}')" class="btn-ghost">Cancel</button>
                    <button onclick="updateAllFAQ('${f.id}')" class="btn-primary">Save</button>
                </div>
            </div>
        </div>
    `;
    return item;
}

function enableEditAllFAQ(id) {
    const item = document.getElementById(`all-faq-item-${id}`);
    if (!item) return;
    item.querySelector('.faq-display-mode').style.display = 'none';
    item.querySelector('.faq-edit-mode').style.display = 'block';
}

function cancelEditAllFAQ(id) {
    const item = document.getElementById(`all-faq-item-${id}`);
    if (!item) return;
    item.querySelector('.faq-display-mode').style.display = 'block';
    item.querySelector('.faq-edit-mode').style.display = 'none';
}

async function updateAllFAQ(id) {
    const q = document.getElementById(`all-edit-q-${id}`).value;
    const a = document.getElementById(`all-edit-a-${id}`).value;
    const c = document.getElementById(`all-edit-c-${id}`).value;

    if (!q || !a) return alert("Question and Answer are required");

    try {
        const res = await fetch(`${API_URL}/admin/faqs/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ question: q, answer: a, category: c })
        });

        if (res.ok) {
            showStatusPopup("FAQ Updated");
            // Sync state
            const idx = allFaqsData.findIndex(f => f.id === id);
            if (idx !== -1) {
                allFaqsData[idx].question = q;
                allFaqsData[idx].answer = a;
                allFaqsData[idx].category = c;
            }
            renderAllFAQs(true);
        } else {
            alert("Failed to update FAQ");
        }
    } catch (e) { console.error(e); }
}

async function deleteAllFAQ(id) {
    if (!confirm("Delete this FAQ?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/faqs/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("FAQ Deleted");
            allFaqsData = allFaqsData.filter(f => f.id !== id);
            currentFilteredFAQs = currentFilteredFAQs.filter(f => f.id !== id);
            renderAllFAQs(true);
            updateFAQCount();
        } else {
            alert("Failed to delete FAQ");
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


// Section for consolidated functions - removing duplicate sendMessage placeholder


function appendMessage(text, sender, save = true) {
    if (save) {
        chatHistory.push({ text, sender });
        sessionStorage.setItem('svu_chat_history', JSON.stringify(chatHistory));
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
// loadSystemHealth definition moved to Admin section


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
    sessionStorage.removeItem('svu_chat_history');

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

    // Default English Logic
    if (!preferredVoice && selectedLang === 'en') {
        // Prioritize "Microsoft Zira" or "Google US English"
        preferredVoice = availableVoices.find(v =>
            v.name.includes("Zira") ||
            (v.name.includes("Google") && v.lang === 'en-US')
        );
    }

    // 4.1 Force Reset if voice is stuck (Safety Mechanism)
    if (!preferredVoice && availableVoices.length > 0) {
        // If still no voice, just take the first one that matches the language prefix
        preferredVoice = availableVoices.find(v => v.lang.startsWith(selectedLang)) || availableVoices[0];
    }

    if (preferredVoice) {
        console.log(`[TTS] Using voice: ${preferredVoice.name} (${preferredVoice.lang})`);
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
    } else {
        // Fallback
        utterance.lang = targetLangCode;
    }

    // Adjust rate/pitch for better naturalness
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Store in global to prevent Garbage Collection (CRITICAL FIX)
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

        // Handle interruption/error
        utterance.onerror = (e) => {
            console.error("[TTS] Utterance Error:", e);
            resetHighlighting();
        };
    }

    // 5. Execution - Immediate & Robust
    console.log("[TTS] Executing commands...");
    try {
        // Browser quirk fix: Cancel before speaking to clear queue
        synth.cancel();

        // Timeout to detect if speech didn't start (common Chrome bug)
        const speechTimeout = setTimeout(() => {
            if (synth.speaking) return; // Started fine
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
        // Standard check: is index inside the word or right at start?
        // Note: charIndex matches the start position of the words in the original string
        return charIndex >= start && charIndex < end;
    });

    // Fallback 1: Exact Start Match (Most reliable for boundaries)
    if (!targetSpan) {
        targetSpan = spans.find(span => parseInt(span.dataset.start) === charIndex);
    }

    // Fallback 2: Nearest Forward Neighbour (Handle slight drift/whitespace skips)
    if (!targetSpan) {
        // Find smallest positive difference
        let closest = null;
        let minDiff = 5; // Tolerance window

        spans.forEach(span => {
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

// 2. Speech-to-Text (STT) Refactored
const micBtn = document.getElementById('mic-btn');
let recognition = null;
let isListening = false; // Explicit state tracking

function initializeSTT() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        if (micBtn) micBtn.style.display = 'none';
        console.warn("Web Speech API not supported.");
        return null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognizer = new SpeechRecognition();

    recognizer.continuous = false;
    recognizer.interimResults = false;

    // Dynamic Language Selection based on dropdown
    const langSelect = document.getElementById('lang-select');
    const selectedLang = langSelect ? langSelect.value : 'en';

    // Map short codes to full BCP-47 codes
    const langMap = {
        'en': 'en-US',
        'te': 'te-IN',
        'hi': 'hi-IN'
    };
    recognizer.lang = langMap[selectedLang] || 'en-US';
    console.log(`[STT] Initialized for language: ${recognizer.lang}`);

    recognizer.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        // micBtn.innerHTML = '<i class="fa-solid fa-microphone-lines"></i>'; // Optional icon change
        userInput.placeholder = "Listening... Speak now";
    };

    recognizer.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        // micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        userInput.placeholder = "Ask anything... (Type or Speak)";
    };

    recognizer.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log(`[STT] Heard: "${transcript}"`);
        userInput.value = transcript;

        // Optional: Auto-send after short delay
        setTimeout(() => sendMessage(), 500);
    };

    recognizer.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        isListening = false;
        micBtn.classList.remove('listening');

        if (event.error === 'not-allowed') {
            showStatusPopup("Microphone access denied. Please enable permissions.", 4000);
        } else if (event.error === 'no-speech') {
            showStatusPopup("No speech detected. Please try again.", 2000);
        }
    };

    return recognizer;
}

function toggleVoiceInput() {
    // Always re-initialize to pick up latest language selection
    if (isListening && recognition) {
        recognition.stop();
        return;
    }

    // Create new instance with current settings
    recognition = initializeSTT();

    if (recognition) {
        try {
            recognition.start();
        } catch (e) {
            console.error("Failed to start recognition:", e);
            // Sometimes it throws if already started, force stop and retry logic could go here
        }
    }
}

function stopVoiceInput() {
    if (recognition && isListening) {
        recognition.stop();
    }
}
// --- End Voice Assistant ---

// --- Navigation Logic ---
// Navigation Logic moved to top of file
// Duplicate showSection removed

// --- Dashboard Logic ---


// Dashboard Logic moved to top of file
// Duplicate loadDashboard removed

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

// --- Document Management ---


function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

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
    const suggested_by = sessionStorage.getItem('username') || "Anonymous";

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
        renderSuggestedFAQsTable(suggestions, 3);
    } catch (e) { console.error("Load Suggestions Error", e); }
}

function renderSuggestedFAQsTable(suggestions, limit = null) {
    const tbody = document.getElementById('suggested-faqs-table-body');
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
        btn = container.querySelector('.btn-view-more');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btn-secondary btn-view-more';
            btn.style.width = '100%';
            btn.style.marginTop = '15px';
            btn.style.textAlign = 'center';
            container.appendChild(btn);
        }
    }

    tbody.innerHTML = '';
    if (suggestions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No suggestions pending.</td></tr>';
        btn.style.display = 'none';
        return;
    }

    const showCount = limit ? limit : suggestions.length;
    const visibleSuggestions = suggestions.slice(0, showCount);

    visibleSuggestions.forEach(s => {
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

    // Toggle Button Logic
    if (suggestions.length <= 3) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        if (limit) {
            btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> View More (${suggestions.length - 3} more)`;
            btn.onclick = () => renderSuggestedFAQsTable(suggestions, null);
        } else {
            btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> View Less`;
            btn.onclick = () => renderSuggestedFAQsTable(suggestions, 3);
        }
    }
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
    <div class="modal-content premium-ticket-modal">
        <div class="premium-modal-header">
            <div class="modal-header-content">
                <div class="modal-icon-wrapper ticket-icon">
                    <i class="fa-solid fa-ticket"></i>
                </div>
                <div class="modal-title-section">
                    <h3 class="modal-title">Raise Support Ticket</h3>
                    <p class="modal-subtitle">We'll help you resolve your issue</p>
                </div>
            </div>
            <button class="modal-close-btn" onclick="closeTicketModal()">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        
        <div class="premium-modal-body">
            <div class="premium-form-group">
                <label class="premium-label">Subject</label>
                <div class="premium-input-wrapper">
                    <i class="fa-solid fa-heading input-icon"></i>
                    <input type="text" id="ticket-subject" placeholder="Brief summary of the issue" class="premium-input">
                </div>
            </div>
            
            <div class="premium-form-group">
                <label class="premium-label">Description</label>
                <div class="premium-input-wrapper">
                    <i class="fa-solid fa-align-left input-icon textarea-icon"></i>
                    <textarea id="ticket-desc" rows="5" placeholder="Describe your issue in detail..." class="premium-textarea"></textarea>
                </div>
            </div>
            
            <div class="premium-form-group">
                <label class="premium-label">Category</label>
                <div class="premium-select-wrapper">
                    <i class="fa-solid fa-layer-group input-icon"></i>
                    <select id="ticket-cat" class="premium-select">
                        <option value="General">General Inquiry</option>
                        <option value="Technical">Technical Issue</option>
                        <option value="Academic">Academic/Grades</option>
                        <option value="Facilities">Campus Facilities</option>
                    </select>
                    <i class="fa-solid fa-chevron-down select-arrow"></i>
                </div>
            </div>
        </div>
        
        <div class="premium-modal-footer">
            <button class="btn-modal-cancel" onclick="closeTicketModal()">Cancel</button>
            <button class="btn-modal-submit" onclick="submitTicket()">
                <i class="fa-solid fa-paper-plane"></i>
                Submit Ticket
            </button>
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

    // Display all events without pagination
    const cardsHtml = events.map(e => {
        const fromDate = e.from_date || e.date || '';
        const toDate = e.to_date || e.date || '';
        
        // Parse as datetime
        const fromDateTime = new Date(fromDate);
        const toDateTime = new Date(toDate);
        
        // Extract date parts for comparison
        const fromDateOnly = fromDateTime.toISOString().split('T')[0];
        const toDateOnly = toDateTime.toISOString().split('T')[0];
        const isSingleDay = fromDateOnly === toDateOnly;
        
        // Format time in 24-hour format
        const formatTime = (date) => {
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        };
        
        // Calendar card display (day/month)
        const day = fromDateTime.getDate();
        const month = fromDateTime.toLocaleString('default', { month: 'short' }).toUpperCase();

        // Date range text with time
        let dateRangeText;
        if (isSingleDay) {
            const dateFormatted = fromDateTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const startTime = formatTime(fromDateTime);
            const endTime = formatTime(toDateTime);
            dateRangeText = `${dateFormatted} | ${startTime} - ${endTime}`;
        } else {
            const fromFormatted = fromDateTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const toFormatted = toDateTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const startTime = formatTime(fromDateTime);
            const endTime = formatTime(toDateTime);
            dateRangeText = `${fromFormatted} ${startTime} — ${toFormatted} ${endTime}`;
        }

        let colorClass = 'event-holiday';
        if (e.type === 'Exam') colorClass = 'event-exam';
        if (e.type === 'Event') colorClass = 'event-general';

        return `
            <div class="calendar-card ${colorClass}" onclick="addToGoogleCalendar('${escapeHtml(e.title)}', '${fromDate}', '${toDate}', '${escapeHtml(e.description || '')}')" style="cursor: pointer;" title="Add to Google Calendar">
                <div class="calendar-date">
                    <span class="day">${day}</span>
                    <span class="month">${month}</span>
                </div>
                <div class="calendar-info">
                    <span class="event-tag">${e.type}</span>
                    <h4 class="event-title">${e.title}</h4>
                    <p class="event-desc">${e.description || ''}</p>
                    <div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
                         <i class="fa-regular fa-calendar"></i> ${dateRangeText}
                    </div>
                    ${e.location ? `<div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
                         <i class="fa-solid fa-map-pin"></i> ${escapeHtml(e.location)}
                    </div>` : ''}
                    <div style="margin-top: 8px; font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 5px;">
                         <i class="fa-brands fa-google"></i> <span style="text-decoration: underline;">Add to Calendar</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    list.innerHTML = cardsHtml;
}

function addToGoogleCalendar(title, fromDateStr, toDateStr, desc) {
    const fromDate = new Date(fromDateStr);
    const toDate = new Date(toDateStr);

    // Format for Google Calendar: YYYYMMDDTHHmmss
    const fmtDateTime = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
    };

    const start = fmtDateTime(fromDate);
    const end = fmtDateTime(toDate);

    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(desc)}`;

    if (confirm(`Add "${title}" to your Google Calendar?`)) {
        window.open(url, '_blank');
    }
}

// --- Calendar Admin Logic ---

    // Consolidating calendar loading logic - removing duplicate function here
    // The main function is defined below around line 2900

// Alias for compatibility
async function loadCalendarAdmin() {
    const events = await loadAcademicCalendar();
    window.allAdminEvents = events || [];
    renderCalendarAdminTable(window.allAdminEvents);
}


function renderCalendarAdminTable(events, limit = null) {
    const tbody = document.getElementById('calendar-admin-table-body');
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
        btn = container.querySelector('.btn-view-more');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btn-secondary btn-view-more';
            btn.style.width = '100%';
            btn.style.marginTop = '15px';
            btn.style.textAlign = 'center';
            container.appendChild(btn);
        }
    }

    if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No events posted.</td></tr>';
        btn.style.display = 'none';
        return;
    }

    const showCount = limit ? limit : events.length;
    const visibleEvents = events.slice(0, showCount);

    tbody.innerHTML = visibleEvents.map(e => {
        const fromDate = e.from_date || e.date || '';
        const toDate = e.to_date || e.date || '';
        
        // Parse as datetime
        const fromDateTime = new Date(fromDate);
        const toDateTime = new Date(toDate);
        
        // Extract date parts for comparison
        const fromDateOnly = fromDateTime.toISOString().split('T')[0];
        const toDateOnly = toDateTime.toISOString().split('T')[0];
        const isSingleDay = fromDateOnly === toDateOnly;
        
        // Format time in 24-hour format
        const formatTime = (date) => {
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        };
        
        // Date display with time
        let dateDisplay;
        if (isSingleDay) {
            const dateFormatted = fromDateTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const startTime = formatTime(fromDateTime);
            const endTime = formatTime(toDateTime);
            dateDisplay = `${dateFormatted} | ${startTime} - ${endTime}`;
        } else {
            const fromFormatted = fromDateTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const toFormatted = toDateTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const startTime = formatTime(fromDateTime);
            const endTime = formatTime(toDateTime);
            dateDisplay = `${fromFormatted} ${startTime} → ${toFormatted} ${endTime}`;
        }
        
        return `
        <tr>
            <td style="padding: 12px;">${dateDisplay}</td>
            <td style="padding: 12px; font-weight: 500;">
                ${e.title}
                ${e.location ? `<div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;"><i class="fa-solid fa-map-pin"></i> ${escapeHtml(e.location)}</div>` : ''}
            </td>
            <td style="padding: 12px;"><span class="event-tag" style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(0,0,0,0.05);">${e.type}</span></td>
            <td style="padding: 12px; text-align: right;">
                <button onclick="editCalendarEvent('${e.id}')" style="color: #6366f1; background: none; border: none; cursor: pointer; margin-right: 8px;" title="Edit event">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="deleteCalendarEvent('${e.id}')" style="color: #ef4444; background: none; border: none; cursor: pointer;" title="Delete event">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        </tr>
    `;
    }).join('');

    // Toggle Button Logic
    if (events.length <= 3) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        if (limit) {
            const hiddenCount = events.length - limit;
            btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> View More (${hiddenCount})`;
            btn.onclick = () => renderCalendarAdminTable(events, null); // Show all
        } else {
            btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> Show Less`;
            btn.onclick = () => renderCalendarAdminTable(events, 3); // Show Less
        }
    }
}

let currentEditEventId = null;

function toggleCustomEventType() {
    const typeSelect = document.getElementById('calendar-event-type');
    const customContainer = document.getElementById('custom-event-type-container');
    const customInput = document.getElementById('custom-event-type-input');
    
    if (typeSelect.value === 'Custom') {
        customContainer.style.display = 'block';
        customInput.focus();
    } else {
        customContainer.style.display = 'none';
        customInput.value = '';
    }
}
window.toggleCustomEventType = toggleCustomEventType;

function openCalendarModal(eventData = null) {
    const modal = document.getElementById('calendar-event-modal');
    
    if (eventData) {
        // Edit mode
        currentEditEventId = eventData.id;
        document.getElementById('event-title').value = eventData.title;
        document.getElementById('event-from-date').value = eventData.from_date;
        document.getElementById('event-to-date').value = eventData.to_date;
        
        // Restrict to future dates (even for edit)
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const minDateTime = now.toISOString().slice(0, 16);
        
        document.getElementById('event-from-date').min = minDateTime;
        document.getElementById('event-to-date').min = minDateTime;

        // Check if it's a predefined type or custom
        const predefinedTypes = ['Event', 'Exam', 'Holiday'];
        if (predefinedTypes.includes(eventData.type)) {
            document.getElementById('calendar-event-type').value = eventData.type;
            document.getElementById('custom-event-type-container').style.display = 'none';
        } else {
            document.getElementById('calendar-event-type').value = 'Custom';
            document.getElementById('custom-event-type-input').value = eventData.type;
            document.getElementById('custom-event-type-container').style.display = 'block';
        }
        
        document.getElementById('event-location').value = eventData.location || '';
        document.getElementById('event-desc').value = eventData.description || '';
    } else {
        // Create mode
        currentEditEventId = null;
        document.getElementById('event-title').value = '';
        document.getElementById('event-from-date').value = '';
        document.getElementById('event-to-date').value = '';
        
        // Restrict to future dates
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const minDateTime = now.toISOString().slice(0, 16);
        
        document.getElementById('event-from-date').min = minDateTime;
        document.getElementById('event-to-date').min = minDateTime;

        document.getElementById('calendar-event-type').value = 'Event';
        document.getElementById('custom-event-type-container').style.display = 'none';
        document.getElementById('custom-event-type-input').value = '';
        document.getElementById('event-location').value = '';
        document.getElementById('event-desc').value = '';
    }
    
    modal.classList.add('active');
}

function closeCalendarModal() {
    currentEditEventId = null;
    document.getElementById('calendar-event-modal').classList.remove('active');
}

async function saveCalendarEvent() {
    const title = document.getElementById('event-title').value;
    const fromDate = document.getElementById('event-from-date').value;
    const toDate = document.getElementById('event-to-date').value;
    let type = document.getElementById('calendar-event-type').value;
    const location = document.getElementById('event-location').value;
    const desc = document.getElementById('event-desc').value;
    
    // If custom type is selected, use the custom input value
    if (type === 'Custom') {
        const customType = document.getElementById('custom-event-type-input').value.trim();
        if (!customType) {
            alert('Please enter a custom event type name.');
            return;
        }
        type = customType;
    }

    if (!title || !fromDate || !toDate) {
        alert("Please provide title, from date (and) to date.");
        return;
    }

    if (new Date(toDate) < new Date(fromDate)) {
        alert("To Date cannot be before From Date.");
        return;
    }

    try {
        const isEdit = currentEditEventId !== null;
        const url = isEdit ? `${API_URL}/admin/calendar/${currentEditEventId}` : `${API_URL}/admin/calendar`;
        const method = isEdit ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ title, from_date: fromDate, to_date: toDate, type, location, description: desc })
        });

        if (res.ok) {
            closeCalendarModal();
            loadAcademicCalendar();
            showStatusPopup(isEdit ? "Event updated successfully!" : "Event added successfully!");
        } else {
            const data = await res.json();
            alert(`Failed to save event: ${data.detail || res.statusText}`);
        }
    } catch (e) {
        console.error(e);
        alert("Error saving event");
    }
}

async function editCalendarEvent(eventId) {
    // Find the event from the cached list
    const event = window.allCalendarEvents.find(e => e.id === eventId);
    if (event) {
        openCalendarModal(event);
    } else {
        alert("Event not found");
    }
}
window.editCalendarEvent = editCalendarEvent;

// --- Restored Calendar Admin Logic ---

async function loadCalendarAdmin() {
    // Alias for consistency with other load functions
    await loadAcademicCalendar();
}

// Global alias for HTML onclick access if needed
window.loadCalendarAdmin = loadCalendarAdmin;

async function loadAcademicCalendar() {
    const tableBody = document.getElementById('calendar-admin-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Loading events...</td></tr>';

    try {
        const res = await fetch(`${API_URL}/admin/calendar`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            const events = await res.json();
            window.allCalendarEvents = events;
            window.allAdminEvents = events; // Fix for search filter
            renderCalendarAdminTable(events);
            return events; // Return events for other callers
        } else {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load events.</td></tr>';
        }
    } catch (e) {
        console.error(e);
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Connection error.</td></tr>';
    }
}
window.loadAcademicCalendar = loadAcademicCalendar;



function getEventTypeBadge(type) {
    const typeMap = {
        'Exam': 'error',     // Red for exams
        'Holiday': 'success', // Green for holidays
        'Event': 'info'       // Blue for events
    };
    return typeMap[type] || 'info';
}

async function deleteCalendarEvent(eventId) {
    if (!confirm('Are you sure you want to delete this event?')) return;

    try {
        const res = await fetch(`${API_URL}/admin/calendar/${eventId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup('Event deleted successfully');
            loadAcademicCalendar(); // Refresh admin list
            loadCalendar(); // Refresh student view
        } else {
            const data = await res.json();
            showStatusPopup(data.detail || 'Failed to delete event', 'error');
        }
    } catch (e) {
        console.error(e);
        showStatusPopup('Connection error', 'error');
    }
}
window.deleteCalendarEvent = deleteCalendarEvent;

async function loadAllTickets() {
    if (!ACCESS_TOKEN) return;
    try {
        const res = await fetch(`${API_URL}/admin/tickets?limit=50`, {
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
        btn = container.querySelector('.btn-view-more');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btn-secondary btn-view-more';
            btn.style.width = '100%';
            btn.style.marginTop = '15px';
            btn.style.textAlign = 'center';
            container.appendChild(btn);
        }
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

        // Delete Button Logic (Only for Closed Tickets and Admins)
        let deleteBtn = '';
        // Strict role check from storage to ensure freshness
        const currentRole = localStorage.getItem('user_role');
        if (t.status.toLowerCase() === 'closed' && currentRole === 'admin') {
            deleteBtn = `
                <button class="icon-btn" title="Delete Ticket" onclick="deleteTicket('${t.id}')" style="color: #ef4444;">
                    <i class="fa-solid fa-trash"></i>
                </button>
             `;
        }

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
                ${deleteBtn}
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

async function deleteTicket(id) {
    if (!confirm("Are you sure you want to delete this ticket permanently?")) return;

    try {
        const res = await fetch(`${API_URL}/tickets/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("Ticket deleted.");
            loadAllTickets();
        } else {
            const data = await res.json();
            alert(data.detail || "Failed to delete ticket.");
        }
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
    "SVU Central Library",
    "SVU College of Engineering (Main Block)",
    "SVU College of Arts",
    "SVU College of Sciences",
    "SVU College of Pharmaceutical Sciences",
    "SVU College of Commerce, Management & Computer Science",
    "SVU Administration Building",
    "SVU Health Center",
    "SVU Indoor Stadium",
    "SVU Outdoor Stadium (Tarakarama Stadium)",
    "SVU Computer Centre",
    "Department of Computer Science",
    "Department of Physics",
    "Department of Chemistry",
    "Department of Mathematics",
    "Department of Botany",
    "Department of Zoology",
    "Department of Biotechnology",
    "Department of biochemistry",
    "Department of Microbiology",
    "Department of Statistics",
    "Department of Psychology",
    "Department of Economics",
    "Department of English",
    "Department of Telugu",
    "Department of History",
    "Department of Political Science & Public Administration",
    "Department of Civil Engineering",
    "Department of Mechanical Engineering",
    "Department of Electrical & Electronics Engineering",
    "Department of Electronics & Communication Engineering",
    "Department of Chemical Engineering",
    "SVU Boys Hostel (Blocks 1-10)",
    "SVU Girls Hostel",
    "SVU Canteen",
    "SVU Post Office",
    "SVU State Bank of India & ATM",
    "SVU Auditorium",
    "SVU Guest House",
    "DDE (Directorate of Distance Education)",
    "SVU Career and Counseling Cell",
    "NSS Office SVU",
    "NCC Office SVU"
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

    // Customized Status Message
    if (currentUploadTarget === 'study') {
        statusText.textContent = "Uploading & Analyzing with AI... (This may take a moment)";
    } else {
        statusText.textContent = "Uploading and processing (Extracting FAQs)...";
    }

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

            if (currentUploadTarget === 'study') {
                showStatusPopup("Notes uploaded & Summarized!");
                loadStudyBuddy();
                // Inject Summary
                if (data.summary) {
                    const summaryEl = document.getElementById('material-summary-content');
                    if (summaryEl) {
                        summaryEl.innerHTML = `<div class="markdown-body">${marked.parse(data.summary)}</div>`;
                        // Highlight the sidebar to show user something happened
                        summaryEl.parentElement.style.border = "2px solid var(--accent-color)";
                        setTimeout(() => { summaryEl.parentElement.style.border = "none"; }, 2000);
                    }
                }
            } else {
                showStatusPopup(`Uploaded! ${data.faqs_extracted || 0} FAQs extracted.`);
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

// Text Entry Ingestion
const textModal = document.getElementById('text-modal');
function openTextModal() { if (textModal) textModal.classList.add('active'); }
function closeTextModal() { if (textModal) textModal.classList.remove('active'); }

async function submitText() {
    const title = document.getElementById('text-title').value.trim();
    const content = document.getElementById('text-content').value.trim();
    const progressDiv = document.getElementById('text-progress');
    const statusText = document.getElementById('text-status');

    if (!title || !content) {
        alert("Please provide both a Title and Content.");
        return;
    }

    progressDiv.style.display = 'block';
    statusText.textContent = "Processing text (Extracting FAQs)...";
    statusText.style.color = "var(--accent-color)";

    try {
        const res = await fetch(`${API_URL}/admin/add-text`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: title, content: content })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Text ingestion failed");
        }

        const data = await res.json();

        statusText.textContent = `Success! ${data.faqs_extracted || 0} FAQs extracted.`;
        statusText.style.color = "#10b981";

        setTimeout(() => {
            closeTextModal();
            showStatusPopup(`Text Ingested! ${data.faqs_extracted || 0} FAQs added.`);
            loadDocuments();
            loadFAQs();

            // Reset fields
            document.getElementById('text-title').value = "";
            document.getElementById('text-content').value = "";
            progressDiv.style.display = 'none';
        }, 1500);

    } catch (e) {
        statusText.textContent = "Error: " + e.message;
        statusText.style.color = "#ef4444";
    }
}

// --- Resume Checker Logic ---
// checkResume defined below


// --- Locations Logic ---
function filterLocations(query) {
    const listEl = document.getElementById('locations-list');
    if (!listEl) return;

    const searchTerm = query.toLowerCase().trim();
    const items = listEl.querySelectorAll('.location-item');

    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
            item.style.display = 'block';
            // Simple animation
            item.style.opacity = '1';
        } else {
            item.style.display = 'none';
            item.style.opacity = '0';
        }
    });
}

function openLocations() {
    const listEl = document.getElementById('locations-list');
    const searchInput = document.getElementById('locations-search');
    
    // Reset search on open
    if (searchInput) searchInput.value = "";

    if (listEl) {
        // Keep the highlighter, clear and re-populate the rest
        const highlighter = document.getElementById('locations-highlighter');
        // Clear all except highlighter
        Array.from(listEl.children).forEach(child => {
            if (child.id !== 'locations-highlighter') child.remove();
        });

        locations.forEach((name, index) => {
            const a = document.createElement('a');
            a.href = '#';
            a.className = 'location-item';
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
            listEl.appendChild(a);
        });
    }
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
        const res = await fetch(`${API_URL}/admin/users?limit=50`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (!res.ok) return;
        const users = await res.json();
        // Store globally for see more/less functionality
        window.allUsers = users;
        // Render only first 3 users initially
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

// --- Data Mutation Logic (User) ---

// 1. User Creation Logic
const addUserModal = document.getElementById('add-user-modal');

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
window.toggleUserRole = toggleUserRole;

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
            loadUsers(); // Refresh the list
        } else {

            showStatusPopup(data.detail || "Failed to create user", "error");
        }
    } catch (e) {
        console.error(e);
        showStatusPopup("Connection error", "error");
    }
}

/**
 * Global Admin Refresh: Reloads all dynamic content in the admin section
 */
async function refreshAllAdminData() {
    console.log("Global Admin Refresh Triggered...");
    const refreshBtn = document.getElementById('admin-refresh-all');
    const refreshIcon = refreshBtn ? refreshBtn.querySelector('i') : null;
    
    // Start spin animation
    if (refreshIcon) refreshIcon.classList.add('fa-spin');
    
    try {
        showToast("Admin Refresh", "Updating all system features...");
        
        // Run all refresh functions in parallel
        await Promise.all([
            loadDashboard(),
            loadAdminTrending(),
            loadUsers(),
            loadDocuments(),
            loadCalendarAdmin(),
            fetchLocations(),
            loadAllTickets(),
            loadSuggestedFAQs(),
            loadSystemHealth(),
            loadTrainStatus()
        ]);
        
        showToast("Success", "All admin features updated successfully!");
    } catch (error) {
        console.error("Global Refresh Failed:", error);
        showToast("Refresh Error", "Some components failed to reload.", "error");
    } finally {
        // Stop spin animation after a slight delay for better UX
        setTimeout(() => {
            if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        }, 800);
    }
}


// --- Study Buddy Feature ---
async function loadStudyBuddy() {
    if (!ACCESS_TOKEN) return;
    const listEl = document.getElementById('study-materials-list');

    // Removed Exam Loading Logic
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
}
window.loadStudyBuddy = loadStudyBuddy;

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

let currentStudyMaterialId = null;

// --- Study Text Modal Functions ---
function openStudyTextModal() {
    const modal = document.getElementById('study-text-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('study-text-title').value = '';
        document.getElementById('study-text-content').value = '';
    }
}

function closeStudyTextModal() {
    const modal = document.getElementById('study-text-modal');
    if (modal) modal.classList.remove('active');
}

async function submitStudyText() {
    const title = document.getElementById('study-text-title').value.trim();
    const content = document.getElementById('study-text-content').value.trim();

    if (!title || !content) {
        alert("Please enter both a title and some content.");
        return;
    }

    // Show loading state
    const btn = document.querySelector('#study-text-modal .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/study-buddy/upload-text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ title, content })
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
        alert("Error: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
window.openStudyTextModal = openStudyTextModal;
window.closeStudyTextModal = closeStudyTextModal;
window.submitStudyText = submitStudyText;

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
        
        // Setup Chat
        currentStudyMaterialId = id;
        const chatCard = document.getElementById('document-chat-card');
        if (chatCard) {
            chatCard.style.display = 'flex';
            const history = document.getElementById('document-chat-history');
            if (history) history.innerHTML = '<p style="color: var(--text-secondary); text-align: center; margin: auto;">Notes loaded. Ask me anything about them!</p>';
        }
    } catch (e) {
        summaryEl.innerHTML = `<p style="color: #ef4444;">Failed to generate summary: ${e.message}</p>`;
        console.error(e);
    }
}

async function askStudyBuddy() {
    if (!currentStudyMaterialId) return;
    const input = document.getElementById('document-chat-input');
    const history = document.getElementById('document-chat-history');
    const query = input.value.trim();
    
    if (!query) return;
    
    // Add user message to mini-history
    const userMsg = document.createElement('div');
    userMsg.style.cssText = "align-self: flex-end; background: var(--gradient-primary); color: white; padding: 8px 12px; border-radius: 12px 12px 0 12px; max-width: 85%; font-size: 13px;";
    userMsg.textContent = query;
    history.appendChild(userMsg);
    input.value = '';
    
    // Typing indicator
    const typing = document.createElement('div');
    typing.innerHTML = '<i class="fa-solid fa-ellipsis fa-fade"></i> AI is reading...';
    typing.style.cssText = "align-self: flex-start; color: var(--text-secondary); font-size: 11px; margin-top: 5px;";
    history.appendChild(typing);
    history.scrollTop = history.scrollHeight;

    try {
        const res = await fetch(`${API_URL}/study-buddy/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ material_id: currentStudyMaterialId, query: query })
        });
        
        history.removeChild(typing);
        
        if (!res.ok) throw new Error("Chat failed");
        const data = await res.json();
        
        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = "align-self: flex-start; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 12px; border-radius: 12px 12px 12px 0; max-width: 85%; font-size: 13px; line-height: 1.4;";
        aiMsg.innerHTML = marked.parse(data.response);
        history.appendChild(aiMsg);
        history.scrollTop = history.scrollHeight;
        
    } catch (e) {
        if (typing.parentNode) history.removeChild(typing);
        const errorMsg = document.createElement('div');
        errorMsg.style.cssText = "align-self: center; color: #ef4444; font-size: 11px;";
        errorMsg.textContent = "Connection error.";
        history.appendChild(errorMsg);
    }
}

// --- Career Center Feature ---
async function loadCareerCenter() {
    // Placements feature removed - focusing on Resume Checker
}
window.loadCareerCenter = loadCareerCenter;


function switchCareerTab(tab) {
    const checkerTab = document.getElementById('tab-resume-checker');
    const makerTab = document.getElementById('tab-resume-maker');
    const checkerView = document.getElementById('resume-checker-view');
    const makerView = document.getElementById('resume-maker-view');

    if (tab === 'checker') {
        checkerTab.classList.add('active');
        makerTab.classList.remove('active');
        checkerView.style.display = 'block';
        makerView.style.display = 'none';
    } else {
        checkerTab.classList.remove('active');
        makerTab.classList.add('active');
        checkerView.style.display = 'none';
        makerView.style.display = 'block';
    }
}
window.switchCareerTab = switchCareerTab;

// Store generated resume text globally for download
let currentGeneratedResume = "";
let currentAnalysisResult = "";

async function downloadAnalysis(format) {
    if (!currentAnalysisResult) {
        alert("Please analyze a resume first.");
        return;
    }

    const btn = document.getElementById(`btn-analysis-download-${format}`);
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    btn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/career/download-resume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ 
                resume_text: currentAnalysisResult,
                format: format 
            })
        });

        if (!response.ok) throw new Error("Download failed");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resume_analysis.${format === 'pdf' ? 'pdf' : 'docx'}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

    } catch (e) {
        console.error("Download Error:", e);
        alert("Failed to download analysis. Please try again.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
window.downloadAnalysis = downloadAnalysis;

async function downloadResume(format) {
    if (!currentGeneratedResume) {
        alert("Please generate a resume first.");
        return;
    }

    const btn = document.getElementById(`btn-download-${format}`);
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading...`;
    btn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/career/download-resume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({ 
                resume_text: currentGeneratedResume,
                format: format 
            })
        });

        if (!response.ok) throw new Error("Download failed");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resume.${format === 'pdf' ? 'pdf' : 'docx'}`; // Correct extension
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

    } catch (e) {
        console.error("Download Error:", e);
        alert("Failed to download resume. Please try again.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
window.downloadResume = downloadResume;

// Updated generateResume to include download buttons
async function generateResume() {
    // Collect Inputs
    const fullName = document.getElementById('maker-fullname').value.trim();
    const email = document.getElementById('maker-email').value.trim();
    const phone = document.getElementById('maker-phone').value.trim();
    const linkedin = document.getElementById('maker-linkedin').value.trim();
    const qualification = document.getElementById('maker-qualification').value.trim();
    const percentage = document.getElementById('maker-percentage').value.trim();
    const role = document.getElementById('maker-role').value.trim();
    const level = document.getElementById('maker-level').value;
    const skillsTech = document.getElementById('maker-skills-tech').value.trim();
    const skillsCoding = document.getElementById('maker-skills-coding').value.trim();
    const skillsSoft = document.getElementById('maker-skills-soft').value.trim();
    const research = document.getElementById('maker-research').value.trim();
    const experience = document.getElementById('maker-experience').value.trim();
    
    const feedbackEl = document.getElementById('resume-generation-feedback');

    // Validation
    if (!fullName || !email || !qualification || !role || !skillsTech) {
        alert("Please fill in all required fields (Name, Email, Qualification, Role, Technical Skills).");
        return;
    }

    feedbackEl.style.display = 'block';
    feedbackEl.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Generating Professional Resume...</div>';

    try {
        const res = await fetch(`${API_URL}/career/generate-resume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                full_name: fullName,
                contact_email: email,
                contact_phone: phone,
                linkedin: linkedin,
                qualification: qualification,
                qualification_percentage: percentage,
                skills_soft: skillsSoft,
                skills_technical: skillsTech,
                skills_coding: skillsCoding,
                experience_level: level,
                target_role: role,
                research_publications: research,
                industry_experience: experience
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Generation failed");
        }

        const data = await res.json();
        currentGeneratedResume = data.resume; // Store for download
        feedbackEl.innerHTML = `<div class="markdown-body">${marked.parse(data.resume)}</div>`;
        
        // Action Buttons Container
        const actionsDiv = document.createElement('div');
        actionsDiv.style.marginTop = '20px';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '10px';
        actionsDiv.style.flexWrap = 'wrap';

        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-secondary';
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Text';
        copyBtn.onclick = () => {
             navigator.clipboard.writeText(data.resume);
             showStatusPopup("Resume Copied to Clipboard!");
        };

        // Download PDF Button
        const pdfBtn = document.createElement('button');
        pdfBtn.id = 'btn-download-pdf';
        pdfBtn.className = 'btn-primary';
        pdfBtn.style.background = '#ef4444'; // Red for PDF
        pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
        pdfBtn.onclick = () => downloadResume('pdf');

        // Download Word Button
        const docxBtn = document.createElement('button');
        docxBtn.id = 'btn-download-docx';
        docxBtn.className = 'btn-primary';
        docxBtn.style.background = '#2563eb'; // Blue for Word
        docxBtn.innerHTML = '<i class="fa-solid fa-file-word"></i> Download Word';
        docxBtn.onclick = () => downloadResume('docx');

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(pdfBtn);
        actionsDiv.appendChild(docxBtn);
        feedbackEl.appendChild(actionsDiv);

    } catch (e) {
        feedbackEl.innerHTML = `<p style="color: #ef4444;">Error: ${e.message}</p>`;
        console.error(e);
    }
}
window.generateResume = generateResume;

async function checkResume() {
    const textInput = document.getElementById('resume-text-input');
    const text = textInput ? textInput.value.trim() : "";
    const feedbackEl = document.getElementById('resume-feedback');
    const targetRole = document.getElementById('resume-target-role')?.value.trim();

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
            body: JSON.stringify({ 
                resume_text: text,
                target_role: targetRole || null
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Server error");
        }

        const data = await res.json();
        currentAnalysisResult = data.analysis;
        feedbackEl.innerHTML = `<div class="markdown-body">${marked.parse(data.analysis)}</div>`;

        // Action Buttons Container
        const actionsDiv = document.createElement('div');
        actionsDiv.style.marginTop = '20px';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '10px';
        actionsDiv.style.flexWrap = 'wrap';

        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-secondary';
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Analysis';
        copyBtn.onclick = () => {
             navigator.clipboard.writeText(data.analysis);
             showStatusPopup("Analysis Copied to Clipboard!");
        };

        // Download PDF Button
        const pdfBtn = document.createElement('button');
        pdfBtn.id = 'btn-analysis-download-pdf';
        pdfBtn.className = 'btn-primary';
        pdfBtn.style.background = '#ef4444'; // Red for PDF
        pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
        pdfBtn.onclick = () => downloadAnalysis('pdf');

        // Download Word Button
        const docxBtn = document.createElement('button');
        docxBtn.id = 'btn-analysis-download-docx';
        docxBtn.className = 'btn-primary';
        docxBtn.style.background = '#2563eb'; // Blue for Word
        docxBtn.innerHTML = '<i class="fa-solid fa-file-word"></i> Download Word';
        docxBtn.onclick = () => downloadAnalysis('docx');

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(pdfBtn);
        actionsDiv.appendChild(docxBtn);
        feedbackEl.appendChild(actionsDiv);
    } catch (e) {
        feedbackEl.innerHTML = `<p style="color: #ef4444;">Analysis failed: ${e.message}</p>`;
        console.error(e);
    }
}
window.checkResume = checkResume;


// --- University Locations Logic ---

let locationsData = [];
let isAdminLocationsExpanded = false;

function renderLocations(data = locationsData) {
    const list = document.getElementById('locations-list');
    if (!list) return;

    list.innerHTML = ''; // Clear existing content

    // Add Highlighter Div
    const highlighter = document.createElement('div');
    highlighter.id = 'locations-highlighter';
    highlighter.className = 'locations-highlighter';
    list.appendChild(highlighter);

    const categories = [...new Set(data.map(item => item.category))];

    categories.forEach(category => {
        // Create Category Header
        const header = document.createElement('h3');
        header.className = 'locations-category-header';
        header.textContent = category;
        list.appendChild(header);

        // Create Grid for items
        const grid = document.createElement('div');
        grid.className = 'locations-category-grid';

        const categoryItems = data.filter(item => item.category === category);
        
        categoryItems.forEach((loc, index) => {
            const item = document.createElement('div');
            item.className = 'location-item';
            item.textContent = loc.name;
            item.style.animationDelay = `${index * 0.03}s`; // Stagger effect
            item.onclick = (e) => {
                e.stopPropagation();
                window.open(`https://www.google.com/maps/search/?api=1&query=Sri+Venkateswara+University+${encodeURIComponent(loc.name)}`, '_blank');
            };
            
            // Hover logic for highlighter
            item.onmouseenter = (e) => {
                const rect = item.getBoundingClientRect();
                const containerRect = list.getBoundingClientRect();
                
                highlighter.style.width = `${rect.width}px`;
                highlighter.style.height = `${rect.height}px`;
                highlighter.style.top = `${item.offsetTop}px`;
                highlighter.style.left = `${item.offsetLeft}px`;
                highlighter.style.opacity = '1';
            };

            grid.appendChild(item);
        });

        list.appendChild(grid);
    });

    // Hide highlighter on mouse leave
    list.onmouseleave = () => {
        highlighter.style.opacity = '0';
    };
}

function filterLocations(query) {
    const term = query.toLowerCase();
    
    // Filter data
    const filtered = term ? locationsData.filter(loc => 
        loc.name.toLowerCase().includes(term) || 
        loc.category.toLowerCase().includes(term)
    ) : locationsData;

    renderLocations(filtered);

    // If search produced no results
    if (term && filtered.length === 0) {
        const list = document.getElementById('locations-list');
        if (list) {
            list.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No locations found for "${query}"</div>`;
        }
    }
}

function askLocation(locationName) {
    showSection('chat');
    const input = document.getElementById('user-input');
    if (input) {
        input.value = `Where is ${locationName}?`;
        sendMessage(); 
    }
}

// --- Location CRUD Functions (Admin) ---

async function fetchLocations() {
    try {
        const res = await fetch(`${API_URL}/locations`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        if (res.ok) {
            locationsData = await res.json();
            renderLocations();
            renderAdminLocationsTable();
        }
    } catch (e) { console.error("Fetch Locations Error", e); }
}

function renderAdminLocationsTable(data = locationsData, bypassExpand = false) {
    const tbody = document.getElementById('locations-admin-table-body');
    const toggleContainer = document.getElementById('location-admin-view-toggle');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No locations found.</td></tr>';
        if (toggleContainer) toggleContainer.style.display = 'none';
        return;
    }

    // Show toggle button if there are many locations and we're not searching
    if (toggleContainer) {
        toggleContainer.style.display = (!bypassExpand && data.length > 3) ? 'block' : 'none'; // Changed from 5 to 3
        const btnText = document.getElementById('location-view-btn-text');
        const btnIcon = document.getElementById('location-view-btn-icon');
        if (btnText) btnText.textContent = isAdminLocationsExpanded ? "View Less" : "View More";
        if (btnIcon) btnIcon.className = isAdminLocationsExpanded ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
    }

    const displayedData = (isAdminLocationsExpanded || bypassExpand) ? data : data.slice(0, 3); // Changed default limit to 3

    displayedData.forEach(loc => {
        tbody.innerHTML += `
        <tr>
            <td style="padding: 12px; font-weight: 500;">${escapeHtml(loc.name)}</td>
            <td style="padding: 12px;"><span class="badge info">${escapeHtml(loc.category)}</span></td>
            <td style="padding: 12px; text-align: right;">
                <button class="icon-btn" onclick="openLocationModal('${loc.id}')" title="Edit">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="icon-btn" onclick="deleteLocation('${loc.id}')" style="color: #ef4444;" title="Delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });
}

function toggleAdminLocationsView() {
    isAdminLocationsExpanded = !isAdminLocationsExpanded;
    renderAdminLocationsTable();
}

window.toggleAdminLocationsView = toggleAdminLocationsView;

function openLocationModal(locId = null) {
    const modal = document.getElementById('location-modal');
    const title = document.getElementById('location-modal-title');
    const nameInput = document.getElementById('location-name');
    const catSelect = document.getElementById('location-category');
    const descInput = document.getElementById('location-description');
    const idInput = document.getElementById('location-id');

    if (!modal) return;

    if (locId) {
        const loc = locationsData.find(l => l.id === locId);
        if (loc) {
            title.textContent = "Edit Location";
            nameInput.value = loc.name;
            catSelect.value = loc.category;
            descInput.value = loc.description || "";
            idInput.value = loc.id;
        }
    } else {
        title.textContent = "Add New Location";
        nameInput.value = "";
        catSelect.value = "Constituent Colleges";
        descInput.value = "";
        idInput.value = "";
    }

    modal.classList.add('active');
}

function closeLocationModal() {
    const modal = document.getElementById('location-modal');
    if (modal) modal.classList.remove('active');
}

async function saveLocation() {
    const id = document.getElementById('location-id').value;
    const name = document.getElementById('location-name').value.trim();
    const category = document.getElementById('location-category').value;
    const description = document.getElementById('location-description').value.trim();

    if (!name || !category) {
        showStatusPopup("Please enter name and category", "warning");
        return;
    }

    const payload = { name, category, description };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_URL}/admin/locations/${id}` : `${API_URL}/admin/locations`;

    try {
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showStatusPopup(id ? "Location updated!" : "Location added!");
            closeLocationModal();
            fetchLocations();
        } else {
            const data = await res.json();
            showStatusPopup(data.detail || "Failed to save location", "error");
        }
    } catch (e) { console.error(e); }
}

async function deleteLocation(id) {
    if (!confirm("Delete this location?")) return;

    try {
        const res = await fetch(`${API_URL}/admin/locations/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        if (res.ok) {
            showStatusPopup("Location deleted");
            fetchLocations();
        } else {
            showStatusPopup("Failed to delete", "error");
        }
    } catch (e) { console.error(e); }
}

window.openLocationModal = openLocationModal;
window.closeLocationModal = closeLocationModal;
window.saveLocation = saveLocation;
window.deleteLocation = deleteLocation;

// --- Admin Filtering Logic ---

function filterAdminUsers() {
    const query = document.getElementById('user-search-input').value.toLowerCase();
    const filtered = (window.allUsers || []).filter(u => 
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.email && u.email.toLowerCase().includes(query)) ||
        (u.full_name && u.full_name.toLowerCase().includes(query))
    );
    renderUsersTable(filtered);
}

function filterAdminCalendar() {
    const query = document.getElementById('calendar-search-input').value.toLowerCase();
    const filtered = (window.allAdminEvents || []).filter(e => 
        (e.title && e.title.toLowerCase().includes(query)) ||
        (e.category && e.category.toLowerCase().includes(query)) ||
        (e.description && e.description.toLowerCase().includes(query))
    );
    renderCalendarAdminTable(filtered);
}

function filterAdminLocations() {
    const query = document.getElementById('location-search-input').value.toLowerCase();
    const filtered = (locationsData || []).filter(l => 
        (l.name && l.name.toLowerCase().includes(query)) ||
        (l.category && l.category.toLowerCase().includes(query)) ||
        (l.description && l.description.toLowerCase().includes(query))
    );
    // When filtering, we usually want to see all matches, so we bypass the collapsed state if query is present
    const bypassExpand = query.length > 0;
    renderAdminLocationsTable(filtered, bypassExpand);
}

function filterAdminTickets() {
    const query = document.getElementById('ticket-search-input').value.toLowerCase();
    const filtered = (window.allTickets || []).filter(t => 
        (t.subject && t.subject.toLowerCase().includes(query)) ||
        (t.category && t.category.toLowerCase().includes(query)) ||
        (t.user_email && t.user_email.toLowerCase().includes(query)) ||
        (String(t.id) && String(t.id).toLowerCase().includes(query))
    );
    renderTicketsTable(filtered);
}

function filterAdminSuggestions() {
    const query = document.getElementById('suggestion-search-input').value.toLowerCase();
    const filtered = (window.allSuggestions || []).filter(s => 
        (s.question && s.question.toLowerCase().includes(query)) ||
        (s.answer && s.answer.toLowerCase().includes(query)) ||
        (s.user_email && s.user_email.toLowerCase().includes(query))
    );
    renderSuggestedFAQsTable(filtered);
}

window.filterAdminUsers = filterAdminUsers;
window.filterAdminCalendar = filterAdminCalendar;
window.filterAdminLocations = filterAdminLocations;
window.filterAdminTickets = filterAdminTickets;
window.filterAdminSuggestions = filterAdminSuggestions;

// --- Trending Queries Logic ---

let trendingShowAll = false;
let currentTrendingQueries = [];

async function loadAdminTrending() {
    try {
        const res = await fetch(`${API_URL}/admin/trending`, {headers: {'Authorization': `Bearer ${ACCESS_TOKEN}`}});
        currentTrendingQueries = await res.json();
        renderAdminTrendingList();
    } catch (e) { console.error('Failed to load admin trending', e); }
}

function renderAdminTrendingList() {
    const list = document.getElementById('admin-trending-list');
    const viewMoreContainer = document.getElementById('trending-view-more');
    if (!list) return;

    list.innerHTML = '';
    
    // Logic for View More/Less
    const visibleQueries = trendingShowAll ? currentTrendingQueries : currentTrendingQueries.slice(0, 3);
    
    visibleQueries.forEach(q => {
        const item = document.createElement('div');
        item.className = 'trending-item-card';
        // Applying styles directly for immediate reflection, though external CSS is better
        item.style.cssText = `
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.05);
            padding: 15px 20px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 12px;
            transition: transform 0.2s, background 0.2s;
        `;
        
        item.onmouseenter = () => { item.style.background = 'rgba(255, 255, 255, 0.08)'; item.style.transform = 'translateY(-2px)'; };
        item.onmouseleave = () => { item.style.background = 'rgba(255, 255, 255, 0.05)'; item.style.transform = 'translateY(0)'; };
        
        item.innerHTML = `
            <div style='width:42px; height:42px; background: linear-gradient(135deg, #14b8a6, #0d9488); color:white; display:flex; align-items:center; justify-content:center; border-radius:10px; margin-right:18px; box-shadow: 0 4px 10px rgba(20, 184, 166, 0.2);'>
                <i class='${q.icon}' style='font-size: 18px;'></i>
            </div>
            <div style='flex:1;'>
                <div style='font-weight:600; color:var(--text-primary); font-size:15px; margin-bottom: 2px;'>${q.text}</div>
                <div style='font-size:13px; color:var(--text-secondary); opacity: 0.8;'>${q.subtext}</div>
            </div>
            <div style='display:flex; gap:10px;'>
                <button onclick='editTrendingQuery("${q.id}")' style='background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color:var(--text-secondary); cursor:pointer; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;' title='Edit'>
                    <i class='fa-solid fa-pen' style='font-size: 13px;'></i>
                </button>
                <button onclick='deleteTrendingQuery("${q.id}")' style='background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color:#ef4444; cursor:pointer; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;' title='Delete'>
                    <i class='fa-solid fa-trash' style='font-size: 13px;'></i>
                </button>
            </div>
        `;
        list.appendChild(item);
    });

    // Update View More Link
    if (viewMoreContainer) {
        if (currentTrendingQueries.length > 3) {
            viewMoreContainer.style.display = 'block';
            viewMoreContainer.querySelector('span').innerText = trendingShowAll ? 'View Less' : 'View All';
        } else {
            viewMoreContainer.style.display = 'none';
        }
    }
}

function editTrendingQuery(id) {
    const query = currentTrendingQueries.find(q => q.id === id);
    if (query) {
        openAddTrendingModal(query);
    }
}

function toggleTrendingView() {
    trendingShowAll = !trendingShowAll;
    renderAdminTrendingList();
}

function openAddTrendingModal(query = null) {
    const modal = document.getElementById('trending-modal');
    if (!modal) return;

    // Check limit for new additions
    if (!query && currentTrendingQueries.length >= 4) {
        showStatusPopup("Maximum Queries reached", 1000);
        return;
    }

    // Reset or Populate
    const idInput = document.getElementById('trending-id');
    const textInput = document.getElementById('trending-text');
    const subtextInput = document.getElementById('trending-subtext');
    const responseInput = document.getElementById('trending-response');
    const hiddenIcon = document.getElementById('trending-icon');
    const modalTitle = modal.querySelector('h3');
    const submitBtn = document.getElementById('btn-trending-submit');

    if (query) {
        // Edit Mode
        if(idInput) idInput.value = query.id;
        if(textInput) textInput.value = query.text;
        if(subtextInput) subtextInput.value = query.subtext;
        if(responseInput) responseInput.value = query.response || '';
        if(hiddenIcon) hiddenIcon.value = query.icon;
        
        if(modalTitle) modalTitle.innerText = 'Update Trending Query';
        if(submitBtn) {
            submitBtn.innerText = 'Update Query';
            submitBtn.onclick = addTrendingQuery;
        }

        // Highlight icon
        document.querySelectorAll('.icon-option').forEach(el => {
           if(el.innerHTML.includes(query.icon)) el.classList.add('selected');
           else el.classList.remove('selected');
        });
    } else {
        // Add Mode
        if(idInput) idInput.value = '';
        if(textInput) textInput.value = '';
        if(subtextInput) subtextInput.value = '';
        if(responseInput) responseInput.value = '';
        if(hiddenIcon) hiddenIcon.value = 'fa-solid fa-fire'; // Default
        
        if(modalTitle) modalTitle.innerText = 'Add Trending Query';
        if(submitBtn) {
            submitBtn.innerText = 'Add Query';
            submitBtn.onclick = addTrendingQuery;
        }
        
        // Reset icon selection
        document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
    }

    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('active'));
    renderSymbolPicker();
}

const TRENDING_ICONS = [
    'fa-solid fa-graduation-cap', 'fa-solid fa-book', 'fa-solid fa-calendar-days',
    'fa-solid fa-map-location-dot', 'fa-solid fa-bus', 'fa-solid fa-building-columns',
    'fa-solid fa-user-graduate', 'fa-solid fa-microscope', 'fa-solid fa-flask',
    'fa-solid fa-laptop-code', 'fa-solid fa-fire', 'fa-solid fa-star'
];

const ICON_NAMES = {
    'fa-solid fa-graduation-cap': 'Academics',
    'fa-solid fa-book': 'Library/Study',
    'fa-solid fa-calendar-days': 'Events/Calendar',
    'fa-solid fa-map-location-dot': 'Campus Map',
    'fa-solid fa-bus': 'Transport',
    'fa-solid fa-building-columns': 'University/Dept',
    'fa-solid fa-user-graduate': 'Student/Faculty',
    'fa-solid fa-microscope': 'Research',
    'fa-solid fa-flask': 'Science/Labs',
    'fa-solid fa-laptop-code': 'IT/Tech',
    'fa-solid fa-fire': 'Trending',
    'fa-solid fa-star': 'Featured/Important'
};

function closeTrendingModal() {
    const modal = document.getElementById('trending-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

function renderSymbolPicker() {
    const container = document.getElementById('icon-picker');
    const hiddenInput = document.getElementById('trending-icon');
    if (!container) return;
    
    container.innerHTML = '';
    TRENDING_ICONS.forEach(icon => {
        const div = document.createElement('div');
        div.className = 'icon-option';
        div.setAttribute('title', ICON_NAMES[icon] || 'Icon'); // Add Tooltip
        div.innerHTML = `<i class='${icon}'></i>`;
        
        if (hiddenInput.value === icon) {
            div.classList.add('selected');
        }
        
        div.onclick = () => {
            hiddenInput.value = icon;
            document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
        };
        container.appendChild(div);
    });
}

async function addTrendingQuery() {
    const id = document.getElementById('trending-id').value;
    const text = document.getElementById('trending-text').value;
    const subtext = document.getElementById('trending-subtext').value;
    const icon = document.getElementById('trending-icon').value;
    const response = document.getElementById('trending-response').value.trim();
    
    if (!text || !subtext) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        const payload = { text, subtext, icon, order: 0, response: response };
        
        console.log('Saving Query:', { id, payload });

        let url = `${API_URL}/admin/trending`;
        let method = 'POST';

        if (id) {
             url = `${API_URL}/admin/trending/${id}`;
             method = 'PUT';
        }

        const res = await fetch(url, {
            method: method,
            headers:{'Content-Type': 'application/json', 'Authorization': `Bearer ${ACCESS_TOKEN}`},
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            closeTrendingModal();
            loadAdminTrending();
            loadTrendingQueries(); // Refresh main view too
            showStatusPopup(id ? "Query updated successfully!" : "Query added successfully!");
        } else {
            const data = await res.json();
            alert(`Failed to save query: ${data.detail || res.statusText}`);
            console.error('Save Query Error:', data);
        }
    } catch (e) { console.error(e); }
}

async function deleteTrendingQuery(id) {
    if (!confirm('Delete this query?')) return;
    try {
        const res = await fetch(`${API_URL}/admin/trending/${id}`, {
            method: 'DELETE',
            headers: {'Authorization': `Bearer ${ACCESS_TOKEN}`}
        });
        if (res.ok) {
            loadAdminTrending();
            loadTrendingQueries();
            showStatusPopup("Query deleted");
        }
    } catch (e) { console.error(e); }
}

window.openAddTrendingModal = openAddTrendingModal;
window.closeTrendingModal = closeTrendingModal;
window.addTrendingQuery = addTrendingQuery;
window.deleteTrendingQuery = deleteTrendingQuery;

// --- Zen AI Assistant Logic ---
let zenChatHistory = [];
let zenRecognition = null;

function switchStudyTab(tab) {
    const notesTab = document.getElementById('tab-study-notes');
    const zenTab = document.getElementById('tab-study-zen');
    const notesView = document.getElementById('study-notes-view');
    const zenView = document.getElementById('study-zen-view');

    if (tab === 'notes') {
        notesTab.classList.add('active');
        zenTab.classList.remove('active');
        notesView.style.display = 'flex';
        zenView.style.display = 'none';
    } else {
        zenTab.classList.add('active');
        notesTab.classList.remove('active');
        zenView.style.display = 'flex';
        notesView.style.display = 'none';
        document.getElementById('zen-input').focus();
    }
}

async function sendZenMessage() {
    const input = document.getElementById('zen-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    appendZenMessage(text, 'user');

    try {
        const response = await fetch(`${API_URL}/study-buddy/zen`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                query: text,
                history: zenChatHistory
            })
        });

        const data = await response.json();
        if (data.response) {
            appendZenMessage(data.response, 'zen');
            zenChatHistory.push({ role: 'user', content: text });
            zenChatHistory.push({ role: 'assistant', content: data.response });
        } else {
            appendZenMessage("Zen is momentarily offline. Please try again.", 'zen');
        }
    } catch (err) {
        console.error('Zen Error:', err);
        appendZenMessage("Zen encountered a neural hiccup. Check your connection.", 'zen');
    }
}

function appendZenMessage(text, role) {
    const history = document.getElementById('zen-chat-history');
    if (!history) return;

    const welcome = history.querySelector('.welcome-chat');
    if (welcome) welcome.remove();

    // Create Item Wrapper
    const messageItem = document.createElement('div');
    messageItem.className = `zen-message-item ${role}`;

    // Create Message Bubble
    const bubble = document.createElement('div');
    bubble.className = `zen-message ${role}`;

    // Process for formatting
    let displayText = text;
    let followups = null;

    // Extract follow-up questions if any
    const followupMatch = text.match(/Follow-up questions:[\s\S]*$/i) || text.match(/Would you like to know about:[\s\S]*$/i);
    if (followupMatch && role === 'zen') {
        const followupText = followupMatch[0];
        displayText = text.replace(followupText, '');
        
        followups = document.createElement('div');
        followups.className = 'zen-followup-container';
        
        const questions = followupText.split('\n').filter(q => q.trim() && q.includes('?'));
        questions.forEach(q => {
            const cleanQ = q.replace(/^[\d.*-\s]+/, '').trim();
            if (cleanQ) {
                const btn = document.createElement('button');
                btn.className = 'zen-followup-btn';
                btn.innerText = cleanQ;
                btn.onclick = () => {
                    document.getElementById('zen-input').value = cleanQ;
                    sendZenMessage();
                };
                followups.appendChild(btn);
            }
        });
    }

    bubble.innerHTML = formatText(displayText);
    messageItem.appendChild(bubble);

    // Create Actions Bar
    const actions = document.createElement('div');
    actions.className = 'zen-actions';

    // Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'zen-action-btn';
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.title = 'Copy';
    copyBtn.onclick = () => {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = displayText;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        document.execCommand('copy');
        document.body.removeChild(tempTextArea);
        showStatusPopup("Copied to clipboard!", 1500);
    };

    // Speak Button
    const speakBtn = document.createElement('button');
    speakBtn.className = 'zen-action-btn';
    speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    speakBtn.title = 'Listen';
    speakBtn.onclick = () => speakText(displayText, bubble, speakBtn);

    actions.appendChild(copyBtn);
    actions.appendChild(speakBtn);
    messageItem.appendChild(actions);

    // Add Follow-ups if Zen
    if (followups) {
        messageItem.appendChild(followups);
    }

    history.appendChild(messageItem);
    history.scrollTop = history.scrollHeight;
}

function newZenChat() {
    zenChatHistory = [];
    const history = document.getElementById('zen-chat-history');
    if (history) {
        history.innerHTML = `<div class="welcome-chat" style="text-align: center; margin: auto; padding: 20px;"><i class="fa-solid fa-brain" style="font-size: 40px; color: var(--accent-color); margin-bottom: 15px; opacity: 0.8;"></i><h4 style="margin-bottom: 8px;">I am Zen</h4><p style="color: var(--text-secondary); font-size: 14px;">Your generative AI partner for academic brilliance. Ask me anything!</p></div>`;
    }
    showStatusPopup("New session started. History cleared.", 2000);
}

function refreshZenChat() {
    showStatusPopup("Refreshing connection to Zen...", 1500);
}

function startZenSTT() {
    if (!('webkitSpeechRecognition' in window)) {
        showStatusPopup("STT not supported in this browser.");
        return;
    }

    if (zenRecognition) {
        zenRecognition.stop();
        return;
    }

    zenRecognition = new webkitSpeechRecognition();
    zenRecognition.lang = document.getElementById('lang-select')?.value === 'te' ? 'te-IN' : (document.getElementById('lang-select')?.value === 'hi' ? 'hi-IN' : 'en-US');
    
    const btn = document.getElementById('zen-mic-btn');
    zenRecognition.onstart = () => btn.classList.add('active');
    zenRecognition.onend = () => {
        btn.classList.remove('active');
        zenRecognition = null;
    };
    
    zenRecognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById('zen-input').value = transcript;
        sendZenMessage();
    };
    
    zenRecognition.start();
}

// Expose Zen functions
window.switchStudyTab = switchStudyTab;
window.sendZenMessage = sendZenMessage;
window.newZenChat = newZenChat;
window.refreshZenChat = refreshZenChat;
window.startZenSTT = startZenSTT;

// --- Notification Logic ---
let notificationPollInterval = null;

function toggleNotifications() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;
    
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'flex';
        fetchNotifications(); // Refresh when opening
        
        // Close on outside click
        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target) && e.target.id !== 'notification-bell') {
                dropdown.style.display = 'none';
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => document.addEventListener('click', closeDropdown), 10);
    } else {
        dropdown.style.display = 'none';
    }
}

async function fetchNotifications() {
    if (!ACCESS_TOKEN) return;
    
    try {
        const res = await fetch(`${API_URL}/notifications`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        
        if (res.status === 401) {
            console.warn("Session expired during notification poll");
            stopNotificationPolling();
            return;
        }
        
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
        const data = await res.json();
        renderNotifications(data.notifications, data.unread_count);
    } catch (e) {
        console.error("Failed to fetch notifications:", e);
    }
}

function renderNotifications(notifications, unreadCount) {
    const container = document.getElementById('notification-items');
    const badge = document.getElementById('notification-badge');
    
    if (!container) return;
    
    // Update badge
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
    
    if (!notifications || notifications.length === 0) {
        container.innerHTML = '<div class="no-notifications">No notifications yet</div>';
        return;
    }
    
    const html = notifications.map(notif => {
        const timeStr = formatNotifTime(notif.created_at);
        return `
            <div class="notification-item-wrapper ${notif.is_read ? '' : 'unread'}">
                <div class="notification-item" onclick="handleNotifClick('${notif.id}', '${notif.link || ''}')">
                    <div class="notif-title">${notif.title}</div>
                    <div class="notif-msg">${notif.message}</div>
                    <div class="notif-time notif-time-text" data-created-at="${notif.created_at}">${timeStr}</div>
                </div>
                <button class="notif-delete-btn" onclick="deleteNotification(event, '${notif.id}')" title="Delete notification">
                    <i class="fa-solid fa-x"></i>
                </button>
            </div>
        `;
    }).join('');
    
    console.log("Rendering notifications. First item HTML:", notifications.length > 0 ? html.substring(0, 200) : "empty");
    container.innerHTML = html;
}

function formatNotifTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
}

async function handleNotifClick(id, link) {
    // Mark as read
    try {
        await fetch(`${API_URL}/notifications/${id}/read`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        fetchNotifications(); // Refresh UI
        
        if (link) {
            // If it's an internal route
            if (link.startsWith('#')) {
                const section = link.substring(1);
                showSection(section);
            } else {
                window.open(link, '_blank');
            }
        }
    } catch (e) {
        console.error("Failed to mark notification as read:", e);
    }
}

async function markAllNotificationsAsRead() {
    if (!ACCESS_TOKEN) return;
    
    try {
        const res = await fetch(`${API_URL}/notifications/read-all`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        
        if (res.ok) {
            fetchNotifications();
            showStatusPopup("All notifications marked as read");
        } else {
            throw new Error("Failed to mark all as read");
        }
    } catch (e) {
        console.error("Error marking all notifications as read:", e);
        showStatusPopup("Failed to mark all as read");
    }
}

async function clearAllNotifications() {
    if (!ACCESS_TOKEN) return;
    
    if (!confirm("Are you sure you want to clear your notifications? This will delete your personal alerts.")) return;
    
    try {
        const res = await fetch(`${API_URL}/notifications/clear-all`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        
        if (res.ok) {
            fetchNotifications();
            showStatusPopup("Notifications cleared");
        } else {
            throw new Error("Failed to clear notifications");
        }
    } catch (e) {
        console.error("Error clearing notifications:", e);
        showStatusPopup("Failed to clear notifications");
    }
}

function startNotificationPolling() {
    if (notificationPollInterval) clearInterval(notificationPollInterval);
    
    // Initial fetch
    fetchNotifications();
    
    // Poll every 30 seconds
    notificationPollInterval = setInterval(fetchNotifications, 30000);
}

function stopNotificationPolling() {
    if (notificationPollInterval) {
        clearInterval(notificationPollInterval);
        notificationPollInterval = null;
    }
}

function updateNotificationTimestamps() {
    const timeElements = document.querySelectorAll('.notif-time-text');
    timeElements.forEach(el => {
        const createdAt = el.getAttribute('data-created-at');
        if (createdAt) {
            el.textContent = formatNotifTime(createdAt);
        }
    });
}

// Update timestamps every minute
setInterval(updateNotificationTimestamps, 60000);

async function deleteNotification(event, id) {
    if (event) event.stopPropagation(); // Prevent notification click trigger
    
    try {
        const res = await fetch(`${API_URL}/notifications/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        
        if (res.ok) {
            fetchNotifications(); // Refresh list
        } else {
            console.error("Failed to delete notification");
        }
    } catch (e) {
        console.error("Error deleting notification:", e);
    }
}

// --- Train The Brain Feature ---

async function loadTrainStatus() {
    if (!ACCESS_TOKEN) return;
    const bodyEl = document.getElementById('brain-training-body');
    if (!bodyEl) return;

    try {
        const res = await fetch(`${API_URL}/admin/brain/status`, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Failed to load status");

        if (data.length === 0) {
            bodyEl.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-secondary);">No documents available for training.</td></tr>';
            return;
        }

        bodyEl.innerHTML = data.map(doc => {
            const lastTrained = doc.last_trained ? formatDate(doc.last_trained) : "Never";
            const statusClass = doc.is_trained ? 'status-pill status-active' : 'status-pill status-pending';
            const statusText = doc.is_trained ? 'Trained' : 'Untrained';
            const typeLabel = doc.type ? doc.type.toUpperCase() : 'PDF';
            
            return `
                <tr class="brain-doc-row" data-filename="${doc.filename.toLowerCase()}">
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="${getFileIconClass(doc.filename)}" style="color: var(--accent-color)"></i>
                            <span>${escapeHtml(doc.filename)}</span>
                        </div>
                    </td>
                    <td style="text-align: center"><span class="type-pill">${typeLabel}</span></td>
                    <td style="text-align: center">${doc.faq_count}</td>
                    <td style="text-align: center"><span class="${statusClass}">${statusText}</span></td>
                    <td style="text-align: center; font-size: 12px; color: var(--text-secondary)">${lastTrained}</td>
                    <td style="text-align: right">
                        <button class="speech-btn" onclick="trainBrain('${doc.id}')" title="Train on this document" 
                                style="width: 28px; height: 28px; background: ${doc.is_trained ? 'rgba(0,0,0,0.05)' : 'var(--accent-color)'}; color: ${doc.is_trained ? 'var(--text-secondary)' : 'white'}">
                            <i class="fa-solid fa-brain"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Apply existing filter if search input is not empty
        filterTrainDocs();

    } catch (e) {
        console.error("Load Train Status Error:", e);
        bodyEl.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error loading status.</td></tr>';
    }
}

function filterTrainDocs() {
    const input = document.getElementById('brain-search-input');
    if (!input) return;
    const filter = input.value.toLowerCase();
    const rows = document.querySelectorAll('.brain-doc-row');
    
    rows.forEach(row => {
        const filename = row.getAttribute('data-filename') || "";
        if (filename.includes(filter)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

async function trainBrain(id) {
    if (!ACCESS_TOKEN) return;
    
    if(typeof showStatusPopup === 'function') showStatusPopup("Activating Brain Cells...");
    
    try {
        const res = await fetch(`${API_URL}/admin/train/${id}`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await res.json();
        
        if (res.ok) {
            if(typeof showStatusPopup === 'function') showStatusPopup("Document Knowledge Ingested!");
            loadTrainStatus();
            if(typeof loadSystemHealth === 'function') loadSystemHealth();
        } else {
            const errorMsg = data.detail || "Training failed";
            if(typeof showStatusPopup === 'function') showStatusPopup(errorMsg);
            console.error("Train Brain Specific Error:", data);
        }
    } catch (e) {
        if(typeof showStatusPopup === 'function') showStatusPopup("Connection Error");
        console.error("Train Brain Network Error:", e);
    }
}

async function trainAllBrain(e) {
    if (!ACCESS_TOKEN) return;
    
    const event = e || (typeof window !== 'undefined' ? window.event : null);
    const btn = event?.currentTarget || event?.target?.closest('button');
    const icon = btn?.querySelector('i');
    
    if (icon) icon.classList.add('fa-spin');
    console.log("Starting Global Brain Training...");

    if(typeof showStatusPopup === 'function') showStatusPopup("Activating University-Wide Brain...");

    try {
        const res = await fetch(`${API_URL}/admin/train/all`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await res.json();
        console.log("Train All Brain Response:", data);

        if (data.status === 'no_updates') {
            alert("No new data is injected to train.");
            if(typeof showStatusPopup === 'function') showStatusPopup("Brain is already up to date.");
        } else if (res.ok) {
            if(typeof showStatusPopup === 'function') showStatusPopup(`Trained on ${data.trained_count} new document(s)!`);
            loadTrainStatus();
            if(typeof loadSystemHealth === 'function') loadSystemHealth();
        } else {
            const errorMsg = data.detail || "Global training failed";
            if(typeof showStatusPopup === 'function') showStatusPopup(errorMsg);
        }
    } catch (e) {
        if(typeof showStatusPopup === 'function') showStatusPopup("Failed to connect to service");
        console.error("Train All Brain Error:", e);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

function formatDate(dateStr) {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getFileIconClass(filename) {
    if (!filename) return 'fa-solid fa-file';
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'fa-solid fa-file-pdf';
    if (lower.startsWith('http')) return 'fa-solid fa-link';
    return 'fa-solid fa-file-lines';
}

// Expose functions to window
window.toggleNotifications = toggleNotifications;
window.markAllNotificationsAsRead = markAllNotificationsAsRead;
window.clearAllNotifications = clearAllNotifications;
window.handleNotifClick = handleNotifClick;
window.deleteNotification = deleteNotification;
window.trainBrain = trainBrain;
window.trainAllBrain = trainAllBrain;
window.filterTrainDocs = filterTrainDocs;
window.loadTrainStatus = loadTrainStatus;

// Initialize if already logged in
if (ACCESS_TOKEN) {
    if (typeof startNotificationPolling === 'function') startNotificationPolling();
}

// Window Resize Listener for Responsive Reset
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        toggleSidebar(true); // Force close sidebar and overlay
    }
});
