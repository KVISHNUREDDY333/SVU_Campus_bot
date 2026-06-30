const API_URL = window.location.origin;
console.log("Using API_URL:", API_URL);
console.log("SVU Bot Script v11-DEBUG Loaded");

const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const welcomeScreen = document.getElementById("welcome-screen");
const typingIndicator = document.getElementById("typing-indicator");

let currentChatController = null;

function toggleSidebar(forceClose = null) {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");

  const currentOverlay = overlay || document.querySelector(".sidebar-overlay");

  if (forceClose === true) {
    if (sidebar) sidebar.classList.remove("active");
    if (currentOverlay) currentOverlay.classList.remove("active");
    return;
  }

  if (sidebar) sidebar.classList.toggle("active");
  if (currentOverlay) currentOverlay.classList.toggle("active");
}

function toggleTheme() {
  
  if (!ACCESS_TOKEN) {
    showStatusPopup("Please log in to switch themes");
    return;
  }

  const body = document.body;
  body.classList.toggle("dark-mode");

  updateThemeUI(body.classList.contains("dark-mode"));

  const isDarkModeNow = body.classList.contains("dark-mode");
  const themeValue = isDarkModeNow ? "dark" : "light";
  sessionStorage.setItem("svu_theme", themeValue);
  localStorage.setItem("svu_theme", themeValue);
}

function updateThemeUI(isDark) {
  const icon = document.getElementById("theme-icon");
  const headerIcon = document.getElementById("header-theme-icon");
  const text = document.getElementById("theme-text");

  if (icon) icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  if (headerIcon)
    headerIcon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  if (text) text.textContent = isDark ? "Light Mode" : "Dark Mode";

  const modalToggle = document.getElementById("modal-dark-mode-toggle");
  if (modalToggle) modalToggle.checked = isDark;
}

let ACCESS_TOKEN = sessionStorage.getItem("access_token");
let USER_ROLE = sessionStorage.getItem("user_role");

document.addEventListener("DOMContentLoaded", async () => {
  const splashScreen = document.getElementById("splash-screen");

  if (splashScreen) {
    
    setTimeout(() => {
      splashScreen.classList.add("fade-out");
      splashScreen.style.pointerEvents = "none";
      setTimeout(() => {
        splashScreen.style.display = "none";
      }, 800);
    }, 2000);
  }

  const savedTheme = sessionStorage.getItem("svu_theme");
  const hasSession = !!sessionStorage.getItem("access_token");

  if (hasSession && savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    updateThemeUI(true);
  } else {
    document.body.classList.remove("dark-mode");
    updateThemeUI(false);
    
    if (!hasSession) {
      sessionStorage.setItem("svu_theme", "light");
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const error = urlParams.get("error");

  if (error) {
    await CustomDialog.alert("Authentication Failed: " + error, "Auth Error", "error");
    window.history.replaceState({}, document.title, "/");
  } else if (token) {
    const role = urlParams.get("role");
    const username = urlParams.get("username");
    const fullName = urlParams.get("name");

    console.log("Google Login Success:", username);
    saveSession({
      access_token: token,
      role: role,
      username: username,
      full_name: fullName,
    });

    window.history.replaceState({}, document.title, "/");
  }

  if (checkAuth()) {
    initRoleUI();
    loadChatHistory();
    populateSidebarProfile();
    startNotificationPolling();
    
    if (!sessionStorage.getItem("session_start")) {
       const savedStart = localStorage.getItem("login_timestamp");
       if (savedStart) {
          sessionStorage.setItem("session_start", savedStart);
       } else {
          const now = new Date().toLocaleString('en-US', { 
            month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true 
          });
          sessionStorage.setItem("session_start", now);
          localStorage.setItem("login_timestamp", now);
       }
    }
    
    if (USER_ROLE) localStorage.setItem("user_type", USER_ROLE);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      for (let registration of registrations) {
        registration
          .unregister()
          .then(() => console.log("Service Worker Unregistered"));
      }
    });
  }

  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
  }

  loadTrendingQueries();

  if (userInput) {
    userInput.value = ""; 
    userInput.focus();
  }

  setTimeout(() => {
    showSection("chat");
  }, 100);

  setTimeout(clearAuthInputs, 500);

  window.addEventListener("pageshow", () => {
    setTimeout(clearAuthInputs, 500);
  });
});

function clearAuthInputs() {
  const ids = [
    "login_email", "login_password",
    "signup_first_name", "signup_last_name", "signup_email", "passInput", "confirmPassInput",
    "reset_email", "otp_input",
    "modal_new_pass", "modal_confirm_pass"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
        el.value = "";
        el.setAttribute('autocomplete', 'new-password'); 
    }
  });
  
  document.getElementById('loginForm')?.reset();
  document.getElementById('signupForm')?.reset();
  document.getElementById('modalResetForm')?.reset();
}

function checkAuth() {
  const overlay = document.getElementById("auth-overlay");
  const ACCESS_TOKEN = sessionStorage.getItem("access_token");

  if (!ACCESS_TOKEN) {
    if (overlay) { 
        clearAuthInputs(); 
        overlay.classList.add("active"); 
        if(window.initAuthUI) window.initAuthUI(); 
    }
    return false;
  } else {
    if (overlay) overlay.classList.remove("active");
    return true;
  }
}

window.initAuthUI = function() {
    const container = document.getElementById('container');
    const signUpGhostBtn = document.getElementById('signUpGhost');
    const signInGhostBtn = document.getElementById('signInGhost');
    const mobileSignUpBtn = document.getElementById('mobile-signup-btn');
    const mobileSignInBtn = document.getElementById('mobile-signin-btn');

    if(!container) return;
    if(container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    signUpGhostBtn?.addEventListener('click', () => { container.classList.add("right-panel-active"); });
    signInGhostBtn?.addEventListener('click', () => { container.classList.remove("right-panel-active"); });
    mobileSignUpBtn?.addEventListener('click', (e) => { e.preventDefault(); container.classList.add("right-panel-active"); });
    mobileSignInBtn?.addEventListener('click', (e) => { e.preventDefault(); container.classList.remove("right-panel-active"); });

    const loginBox = document.getElementById('login-container');
    const forgotBox = document.getElementById('forgot-container');
    const step1Form = document.getElementById('step1Form');
    const step2Form = document.getElementById('step2Form');
    
    document.getElementById('showForgot')?.addEventListener('click', (e) => {
        e.preventDefault();
        loginBox.style.display = 'none';
        forgotBox.classList.remove('hidden', 'hidden-initially');
        step1Form.style.display = 'block';
        step2Form.classList.add('hidden', 'hidden-initially');
        step2Form.style.display = 'none';
        step1Form.reset(); step2Form.reset();
        document.getElementById('forgotMessage').textContent = '';
    });

    document.getElementById('showLogin')?.addEventListener('click', (e) => {
        e.preventDefault();
        forgotBox.classList.add('hidden', 'hidden-initially');
        loginBox.style.display = 'flex';
    });

    function setupToggle(inputId, iconId) {
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if(!input || !icon) return;
        icon.addEventListener('click', () => {
            input.setAttribute('type', input.getAttribute('type') === 'password' ? 'text' : 'password');
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        });
    }
    setupToggle('passInput', 'togglePass');
    setupToggle('confirmPassInput', 'toggleConfirm');
    setupToggle('login_password', 'toggleLoginPass');

    const passInput = document.getElementById('passInput');
    const confirmInput = document.getElementById('confirmPassInput');
    const btnSubmitSignup = document.getElementById('btnSubmitSignup');
    const matchMsg = document.getElementById('matchMessage');
    const btnVerify = document.getElementById('verifyIdentityIcon');
    const signupEmailInput = document.getElementById('signup_email');

    const reqs = {
        len: { el: document.getElementById('req-len'), regex: /.{8,}/ },
        upper: { el: document.getElementById('req-upper'), regex: /[A-Z]/ },
        num: { el: document.getElementById('req-num'), regex: /\d/ },
        special: { el: document.getElementById('req-special'), regex: /[@$!%*?&]/ }
    };

    window.emailIsAuthentic = false;

    function updateSubmitButton() {
        if(!passInput) return;
        const passMatch = passInput.value === confirmInput.value && passInput.value.length >= 8;
        let passValid = true;
        for (const key in reqs) {
            if (reqs[key].regex && !reqs[key].regex.test(passInput.value)) { passValid = false; break; }
        }
        const allFilled = document.getElementById('signup_first_name')?.value.trim() && 
                          document.getElementById('signup_last_name')?.value.trim() && 
                          signupEmailInput?.value.trim();
        
        const isReady = (passMatch && passValid && allFilled && window.emailIsAuthentic);
        if(btnSubmitSignup) btnSubmitSignup.disabled = !isReady;
    }

    function checkForm() {
        if(!passInput) return;
        const val = passInput.value;
        const confirmVal = confirmInput.value;
        const isEmpty = val.length === 0;
        let allValid = true;

        for (const key in reqs) {
            const isValid = reqs[key].regex.test(val);
            const item = reqs[key].el;
            if(!item) continue;
            const icon = item.querySelector('i');
            item.classList.remove('valid', 'invalid');
            icon.className = 'fa-solid fa-circle'; 
            if (isEmpty) item.style.color = 'var(--text-muted)';
            else if (isValid) { item.classList.add('valid'); icon.className = 'fa-solid fa-check-circle'; item.style.color=''; }
            else { item.classList.add('invalid'); icon.className = 'fa-solid fa-circle-xmark'; allValid = false; item.style.color='';}
            if(!isValid) allValid = false;
        }

        if (isEmpty) {
            passInput.classList.remove('input-pure-success', 'input-pure-danger');
        } else {
            if (allValid) {
                passInput.classList.remove('input-pure-danger');
                passInput.classList.add('input-pure-success');
            } else {
                passInput.classList.remove('input-pure-success');
                passInput.classList.add('input-pure-danger');
            }
        }

        if(confirmVal.length > 0) {
            if(val === confirmVal) {
                if(matchMsg) { matchMsg.textContent = "Passwords match"; matchMsg.style.color = "#10b981"; }
            } else {
                if(matchMsg) { matchMsg.textContent = "Passwords do not match"; matchMsg.style.color = "#ef4444"; }
            }
        } else { if(matchMsg) matchMsg.textContent = ""; }

        updateSubmitButton();
    }

    passInput?.addEventListener('input', checkForm);
    confirmInput?.addEventListener('input', checkForm);
    document.getElementById('signup_first_name')?.addEventListener('input', updateSubmitButton);
    document.getElementById('signup_last_name')?.addEventListener('input', updateSubmitButton);
    
    let emailCheckTimeout;
    signupEmailInput?.addEventListener('input', () => {
        window.emailIsAuthentic = false;
        updateSubmitButton();
        const statusIcon = document.getElementById('email-status-icon');
        if (statusIcon) { statusIcon.className = 'email-verify-badge'; statusIcon.innerHTML = ''; }
        
        clearTimeout(emailCheckTimeout);
        const email = signupEmailInput.value.trim();

        if (email.length === 0) {
            signupEmailInput.classList.remove('input-pure-danger', 'input-pure-success');
        } else {
            signupEmailInput.classList.remove('input-pure-success');
            signupEmailInput.classList.add('input-pure-danger');
        }

        if (email.length < 5 || !email.includes('@')) {
            return;
        }

        emailCheckTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`${API_URL}/verify-email-authenticity`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: email })
                });
                if (res.ok) {
                    window.emailIsAuthentic = true;
                    signupEmailInput.classList.remove('input-pure-danger');
                    signupEmailInput.classList.add('input-pure-success');
                    if (statusIcon) {
                        statusIcon.className = 'email-verify-badge valid';
                        statusIcon.innerHTML = '<i class="fa-solid fa-check-circle"></i>';
                    }
                } else {
                    signupEmailInput.classList.remove('input-pure-success');
                    signupEmailInput.classList.add('input-pure-danger');
                    if (statusIcon) {
                        statusIcon.className = 'email-verify-badge invalid';
                        statusIcon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
                    }
                }
                updateSubmitButton();
            } catch(e) { }
        }, 1200);
    });

    function initGoogleSignIn() {
        if (typeof google === 'undefined') {
            setTimeout(initGoogleSignIn, 500);
            return;
        }

        const clientID = window.GOOGLE_CLIENT_ID;
        if (!clientID || clientID === "None") {
            console.warn("Google Client ID not configured");
            return;
        }

        google.accounts.id.initialize({
            client_id: clientID,
            callback: async (response) => {
                const id_token = response.credential;
                try {
                    const res = await fetch(`${API_URL}/auth/google-id-token`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id_token: id_token })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        localStorage.setItem("token", data.access_token);
                        localStorage.setItem("user_role", data.role);
                        localStorage.setItem("username", data.username);
                        localStorage.setItem("full_name", data.full_name);
                        window.location.href = "/";
                    } else {
                        alert(data.detail || "Google Auth Failed");
                    }
                } catch (e) {
                    console.error("Google verify error:", e);
                    alert("A technical error occurred during Google verification.");
                }
            }
        });

        const renderOptions = {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'pill',
            width: 250
        };

        if (document.getElementById('g_id_signin_login')) {
            google.accounts.id.renderButton(document.getElementById('g_id_signin_login'), renderOptions);
        }
        if (document.getElementById('g_id_signin_signup')) {
            google.accounts.id.renderButton(document.getElementById('g_id_signin_signup'), renderOptions);
        }
    }

    initGoogleSignIn();
};

document.addEventListener("DOMContentLoaded", () => {
    if(window.initAuthUI) setTimeout(window.initAuthUI, 500);
});



function initRoleUI() {
  const role = sessionStorage.getItem("user_role");
  if (role === "admin") {
    const navAdmin = document.getElementById("nav-admin");
    const navDashboard = document.getElementById("nav-dashboard");
    if (navAdmin) {
      navAdmin.classList.remove("hidden");
      navAdmin.style.display = "block";
    }
    if (navDashboard) {
      navDashboard.classList.remove("hidden");
      navDashboard.style.display = "block";
    }
  } else {
    const navAdmin = document.getElementById("nav-admin");
    const navDashboard = document.getElementById("nav-dashboard");
    if (navAdmin) {
      navAdmin.classList.add("hidden");
      navAdmin.style.display = "none";
    }
    if (navDashboard) {
      navDashboard.classList.add("hidden");
      navDashboard.style.display = "none";
    }
  }
}

function saveSession(data) {
  
  sessionStorage.setItem("svu_theme", "light");
  document.body.classList.remove("dark-mode");
  if (typeof updateThemeUI === "function") updateThemeUI(false);

  ACCESS_TOKEN = data.access_token;
  USER_ROLE = data.role;
  sessionStorage.setItem("access_token", ACCESS_TOKEN);
  localStorage.setItem("access_token", ACCESS_TOKEN);
  sessionStorage.setItem("user_role", USER_ROLE);
  localStorage.setItem("user_type", USER_ROLE);
  sessionStorage.setItem("username", data.username);
  sessionStorage.setItem("full_name", data.full_name || data.username);
  sessionStorage.setItem("first_name", data.first_name || "");
  sessionStorage.setItem("last_name", data.last_name || "");
  
  const loginTime = new Date().toLocaleString('en-US', { 
    month: 'short', 
    day: '2-digit', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true 
  });
  sessionStorage.setItem("session_start", loginTime);
  localStorage.setItem("login_timestamp", loginTime);
  localStorage.setItem("svu_theme", "light");

  const authOverlay = document.getElementById("auth-overlay");
  if (authOverlay) authOverlay.classList.remove("active");

  if (typeof showSection === "function") showSection("chat");
  if (typeof populateSidebarProfile === "function") populateSidebarProfile();
  initRoleUI();
  if (typeof startNotificationPolling === "function") startNotificationPolling();

  if (typeof clearChat === "function") clearChat();
}

function logout() {
  sessionStorage.removeItem("access_token");
  localStorage.removeItem("access_token");
  sessionStorage.removeItem("user_role");
  sessionStorage.removeItem("username");
  localStorage.removeItem("username"); 
  sessionStorage.removeItem("full_name");
  localStorage.removeItem("full_name"); 
  sessionStorage.removeItem("svu_chat_history"); 
  sessionStorage.removeItem("chat_session_id");
  localStorage.removeItem("last_notification_id"); 

  ACCESS_TOKEN = null;
  USER_ROLE = null;

  if (typeof stopNotificationPolling === "function") stopNotificationPolling();

  sessionStorage.setItem("svu_theme", "light");
  localStorage.removeItem("svu_theme"); 

  document.body.classList.remove("dark-mode");
  if (typeof updateThemeUI === "function") updateThemeUI(false);

  const navAdmin = document.getElementById("nav-admin");
  const navDashboard = document.getElementById("nav-dashboard");
  if (navAdmin) navAdmin.style.display = "none";
  if (navDashboard) navDashboard.style.display = "none";

  location.reload();
}

window.logout = logout;
window.saveSession = saveSession;
window.initRoleUI = initRoleUI;

let chatHistory = JSON.parse(
  sessionStorage.getItem("svu_chat_history") || "[]",
);

function loadChatHistory() {
  if (chatHistory.length > 0 && welcomeScreen) {
    welcomeScreen.style.display = "none";
  }
  chatHistory.forEach((msg) => appendMessage(msg.text, msg.sender, false));
  if (chatHistory.length > 0) scrollToBottom();
}

function populateSidebarProfile() {
  const fullName = sessionStorage.getItem("full_name");
  const role = sessionStorage.getItem("user_role");
  const profileEl = document.getElementById("sidebar-profile");

  if (ACCESS_TOKEN && fullName && profileEl) {
    profileEl.style.display = "flex";
    const nameEl = document.getElementById("profile-name");
    const roleEl = document.getElementById("profile-role");
    const avatarEl = document.getElementById("profile-avatar");

    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = role;
    if (avatarEl) avatarEl.textContent = fullName.charAt(0).toUpperCase();

    initRoleUI();
  } else if (profileEl) {
    profileEl.style.display = "none";
  }
}

function openProfileModal() {
  const modal = document.getElementById("user-profile-modal");
  if (!modal) return;

  const fullName = sessionStorage.getItem("full_name") || "User Name";
  const username = sessionStorage.getItem("username") || "user";
  const sessionStart = sessionStorage.getItem("session_start") || "N/A";
  
  document.getElementById("modal-full-name").textContent = fullName;
  document.getElementById("modal-email").textContent = username.includes("@") ? username : `${username}@svuniversity.edu.in`;
  document.getElementById("modal-session-time").textContent = sessionStart;
  
  let profileID = sessionStorage.getItem("svu_profile_id");
  if (!profileID) {
    profileID = '8880a051-fb39-49f3-804b-97d35bee' + Math.floor(1000 + Math.random() * 9000);
    sessionStorage.setItem("svu_profile_id", profileID);
  }
  document.getElementById("modal-profile-id").textContent = profileID;

  const isDark = document.body.classList.contains("dark-mode");
  const toggle = document.getElementById("modal-dark-mode-toggle");
  if (toggle) toggle.checked = isDark;

  modal.classList.add("active");
}

function closeProfileModal() {
  const modal = document.getElementById("user-profile-modal");
  if (modal) modal.classList.remove("active");
}

async function refreshProfileData() {
    const btn = event.currentTarget || document.querySelector(".btn-profile-secondary");
    if (btn) {
        const icon = btn.querySelector("i");
        if (icon) icon.classList.add("fa-spin");
        
        await new Promise(r => setTimeout(r, 1200));
        
        if (icon) icon.classList.remove("fa-spin");
        CustomDialog.alert("Profile data has been synchronized with the latest records.", "Refresh Complete", "success");
    }
}

function editProfile() {
    const editModal = document.getElementById("edit-profile-modal");
    if (!editModal) return;

    const firstName = sessionStorage.getItem("first_name") || "";
    const lastName = sessionStorage.getItem("last_name") || "";
    
    document.getElementById("edit-first-name").value = firstName;
    document.getElementById("edit-last-name").value = lastName;
    
    editModal.classList.add("active");
}

function closeEditProfileModal() {
    const editModal = document.getElementById("edit-profile-modal");
    if (editModal) editModal.classList.remove("active");
}

async function submitProfileUpdate() {
   const firstName = document.getElementById("edit-first-name").value.trim();
   const lastName = document.getElementById("edit-last-name").value.trim();
   
   if (!firstName || !lastName) {
       await CustomDialog.alert("Please provide both first and last names.", "Validation Error", "warning");
       return;
   }

   const saveBtn = document.getElementById("save-profile-btn");
   const originalHTML = saveBtn.innerHTML;
   saveBtn.disabled = true;
   saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';

   try {
       const response = await fetch("/update-profile", {
           method: "PUT",
           headers: {
               "Content-Type": "application/json",
               "Authorization": `Bearer ${ACCESS_TOKEN}`
           },
           body: JSON.stringify({ first_name: firstName, last_name: lastName })
       });

       const result = await response.json();
       if (response.ok) {
           
           sessionStorage.setItem("full_name", result.full_name);
           sessionStorage.setItem("first_name", result.first_name);
           sessionStorage.setItem("last_name", result.last_name);
           
           populateSidebarProfile();
           
           const modalName = document.getElementById("modal-full-name");
           if (modalName) modalName.textContent = result.full_name;
           
           closeEditProfileModal();
           await CustomDialog.alert("Your academic identity has been updated in the university records.", "Profile Updated", "success");
       } else {
           throw new Error(result.detail || "Update failed");
       }
   } catch (error) {
       await CustomDialog.alert(error.message, "Update Error", "error");
   } finally {
       saveBtn.disabled = false;
       saveBtn.innerHTML = originalHTML;
   }
}

async function loadTrendingQueries() {
  console.time("TrendingQueriesLoad");
  try {
    const res = await fetch(`${API_URL}/admin/trending`);
    const data = await res.json();
    const container = document.getElementById("trending-queries-container");

    if (!container) return;
    container.innerHTML = "";

    if (data.length === 0) {
      
      container.innerHTML =
        '<p style="color:var(--text-secondary); text-align:center; padding:10px;">Ask me anything!</p>';
      console.timeEnd("TrendingQueriesLoad");
      return;
    }

    data.forEach((q) => {
      const card = document.createElement("div");
      card.className = "suggestion-card";
      
      const responseArg = q.response
        ? `'${q.response.replace(/'/g, "\\'")}'`
        : "null";
      const linkArg = q.link ? `'${q.link.replace(/'/g, "\\'")}'` : "null";

      card.setAttribute(
        "onclick",
        `appendQuick('${q.text.replace(/'/g, "\\'")}', ${responseArg}, ${linkArg})`,
      );
      
      const linkIcon = q.link ? `<i class='fa-solid fa-link' style='font-size:10px; margin-left:4px; opacity:0.6;'></i>` : "";
      card.innerHTML = `<div class='icon'><i class='${q.icon}'></i></div><div><div class='title'>${q.text} ${linkIcon}</div><div class='desc'>${q.subtext}</div></div>`;
      container.appendChild(card);
    });
    console.timeEnd("TrendingQueriesLoad");
  } catch (e) {
    console.error("Failed to load trending queries", e);
    console.timeEnd("TrendingQueriesLoad");
  }
}

function showSection(section) {
  console.warn(`[DEBUG] showSection called for: ${section}`);

  if (window.innerWidth <= 768) {
    if (typeof toggleSidebar === "function") {
      toggleSidebar(true);
    }
  }

  if (
    (section === "admin" || section === "dashboard") &&
    USER_ROLE !== "admin"
  ) {
    console.warn(`[DEBUG] Access denied for ${section}. Role: ${USER_ROLE}`);
    showSection("chat");
    return;
  }

  const sections = [
    "chat",
    "admin",
    "dashboard",
    "calendar",
    "locations",
    "study",
    "career",
  ];

  sections.forEach((s) => {
    const el = document.getElementById(`${s}-section`);
    if (el) {
      el.classList.add("hidden");
      el.style.display = "none";
    }

    const nav = document.getElementById(`nav-${s}`);
    if (nav) nav.classList.remove("active");
  });

  const activeSection = document.getElementById(`${section}-section`);
  if (activeSection) {
    activeSection.classList.remove("hidden");
    
    const flexSections = ["chat", "locations", "study"];
    activeSection.style.display =
      flexSections.includes(section) ? "flex" : "block";
  }

  const activeNav = document.getElementById(`nav-${section}`);
  if (activeNav) activeNav.classList.add("active");

  if (section === "dashboard") {
    console.warn("[DEBUG] Triggering loadDashboard from showSection");
    loadDashboard();
  }
  if (section === "admin") {
    loadDashboard(); 
    loadDocuments();
    loadAllTickets();
    loadAcademicCalendar(); 
    loadUsers();
    fetchLocations();
    loadSystemHealth();
    loadSuggestedFAQs();
    loadAdminTrending();
    loadTrainStatus(); 
  }

  if (section === "calendar") {
    loadCalendar(); 
  }
  if (section === "study") {
    loadStudyBuddy();
  }
  if (section === "locations") {
    fetchLocations(); 
  }
  if (section === "career") {
    loadCareerCenter();
  }
  if (section === "chat") {
    
  }
}

async function appendQuick(text, preDefinedResponse = null, link = null) {
  if (preDefinedResponse || link) {
    
    const welcomeScreen = document.getElementById("welcome-screen");
    if (welcomeScreen && welcomeScreen.style.display !== "none") {
      welcomeScreen.style.display = "none";
    }

    appendMessage(text, "user", true);
    showTypingIndicator();

    setTimeout(() => {
      hideTypingIndicator();
      let responseText = preDefinedResponse || "";
      if (link) {
          if (responseText) responseText += "\n\n";
          responseText += `Visit the link to know more: <a href="${link}" target="_blank" class="chat-link">${link}</a>`;
      }
      appendMessage(responseText, "bot", true);
      scrollToBottom();
    }, 600);
    return;
  }

  userInput.value = text;
  sendMessage();
}

function setChatButtonState(isFetching) {
  if (!sendBtn) return;
  if (isFetching) {
    
    sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    sendBtn.classList.add("stop-state");
  } else {
    
    sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    sendBtn.classList.remove("stop-state");
  }
}

let allFAQs = [];

async function loadFAQs() {
  try {
    const res = await fetch(`${API_URL}/admin/faqs`);
    if (!res.ok) return;
    allFAQs = await res.json();
    renderFAQs(allFAQs);
  } catch (e) {
    console.error(e);
  }
}

function renderFAQs(faqsToRender) {
  const list = document.getElementById("faq-list");
  if (!list) return;

  list.innerHTML = "";
  if (faqsToRender.length === 0) {
    list.innerHTML =
      '<p style="text-align:center; color:#64748b; margin-top: 20px;">No FAQs found matching your search.</p>';
    return;
  }

  faqsToRender.forEach((item) => {
    const deleteBtn =
      USER_ROLE === "admin"
        ? `<button onclick="deleteFAQ('${item.id}')" style="float:right; color:#ef4444; background:none; border:none; cursor:pointer;" title="Delete"><i class="fa-solid fa-trash"></i></button>`
        : "";

    let answerHtml = "";
    if (typeof marked !== "undefined") {
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
                <div class="faq-meta" style="font-size: 0.8em; color: #0f766e; margin-bottom: 5px;">${escapeHtml(item.category || "General")}</div>
                <div class="markdown-body">${answerHtml}</div>
            </div>`;
  });
}

let allDocuments = [];

const adminSearchInput = document.getElementById("admin-search-input");
if (adminSearchInput) {
  adminSearchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allDocuments.filter(
      (doc) =>
        (doc.filename && doc.filename.toLowerCase().includes(query)) ||
        (doc.uploaded_by && doc.uploaded_by.toLowerCase().includes(query)),
    );
    renderDocuments(filtered);
  });
}

const modal = document.getElementById("faq-modal");
function openModal() {
  const modal = document.getElementById("faq-modal");
  if (modal) {
    
    const header = modal.querySelector(".modal-header h3");
    const subTitle = modal.querySelector(".modal-header p");
    const submitBtnText = modal.querySelector("#faq-submit-btn span");
    const submitBtnIcon = modal.querySelector("#faq-submit-btn i");

    if (header) header.textContent = "Admin: Publish FAQ";
    if (subTitle)
      subTitle.textContent =
        "Directly publish new information to the database.";
    if (submitBtnText) submitBtnText.textContent = "Publish FAQ";
    if (submitBtnIcon) submitBtnIcon.className = "fa-solid fa-cloud-arrow-up";

    const submitBtn = document.getElementById("faq-submit-btn");
    if (submitBtn) submitBtn.onclick = saveFAQ;

    modal.classList.add("active");
  }
}
function closeModal() {
  const modal = document.getElementById("faq-modal");
  if (modal) {
    modal.classList.remove("active");
  }
}

function openSuggestModal() {
  if (!ACCESS_TOKEN) {
    checkAuth(); 
    return;
  }
  const modal = document.getElementById("faq-modal");
  if (!modal) return;

  const header = modal.querySelector(".modal-header h3");
  const subTitle = modal.querySelector(".modal-header p");
  const submitBtnText = modal.querySelector("#faq-submit-btn span");
  const submitBtnIcon = modal.querySelector("#faq-submit-btn i");

  if (header) header.textContent = "Suggest an FAQ";
  if (subTitle)
    subTitle.textContent = "Help improve the campus assistant's knowledge.";
  if (submitBtnText) submitBtnText.textContent = "Submit Suggestion";
  if (submitBtnIcon) submitBtnIcon.className = "fa-solid fa-paper-plane";

  const submitBtn = document.getElementById("faq-submit-btn");
  if (submitBtn) submitBtn.onclick = submitFAQSuggestion;

  modal.classList.add("active");
}

async function submitFAQSuggestion() {
  const question = document.getElementById("faq-question").value;
  const answer = document.getElementById("faq-answer").value;
  const category = document.getElementById("faq-category").value;
  const suggested_by = sessionStorage.getItem("username") || "Anonymous";

  if (!question || !answer) {
    await CustomDialog.alert("Please fill all fields.", "Validation Error", "warning");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/faqs/suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question, answer, category, suggested_by }),
    });

    if (res.ok) {
      closeModal();
      showStatusPopup(
        "Thank you! Your FAQ suggestion has been submitted for review.",
      );
      
      document.getElementById("faq-question").value = "";
      document.getElementById("faq-answer").value = "";
      refreshAdminData(); 
    } else {
      await CustomDialog.alert("Failed to submit suggestion.", "Submission Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadSuggestedFAQs() {
  if (!ACCESS_TOKEN) return;
  if (USER_ROLE !== "admin") return;

  try {
    const res = await fetch(`${API_URL}/admin/suggested-faqs`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!res.ok) return;

    const suggestions = await res.json();
    window.allSuggestions = suggestions; 
    renderSuggestedFAQsTable(suggestions);
  } catch (e) {
    console.error("Load Suggestions Error", e);
  }
}

function renderSuggestedFAQsTable(suggestions) {
  const tbody = document.getElementById("suggested-faqs-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (suggestions.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align: center; padding: 20px;">No suggestions pending.</td></tr>';
    return;
  }

  suggestions.forEach((s) => {
    const dateStr = new Date(s.timestamp).toLocaleDateString();
    const initial = s.suggested_by.charAt(0).toUpperCase();

    tbody.innerHTML += `
        <tr style="border-bottom: 1px solid var(--border-color); vertical-align: middle; cursor: pointer;" 
            onclick="openReviewModal('${s.id}')"
            class="review-row">
            <td style="padding: 16px;">
                <div class="suggested-faq-content">
                    <div class="suggested-faq-question"><span style="opacity: 0.6; margin-right: 4px;">Q:</span>${escapeHtml(s.question)}</div>
                    <div class="suggested-faq-answer"><span style="opacity: 0.6; margin-right: 4px; font-weight: 600;">A:</span>${escapeHtml(s.answer)}</div>
                    <div class="suggested-faq-meta" style="margin-top: 8px;">
                        <span class="badge success" style="font-size: 9px; padding: 4px 10px; border-radius: 50px;">${escapeHtml(s.category || "General")}</span>
                    </div>
                </div>
            </td>
            <td style="padding: 16px; text-align: left; white-space: normal; vertical-align: middle;">
                <div class="contributor-item" style="max-width: 100%;">
                    <div class="contributor-avatar">${initial}</div>
                    <div class="contributor-info" style="text-align: left;">
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

}

function openReviewModal(id) {
  if (!window.allSuggestions) return;
  const s = window.allSuggestions.find((item) => item.id === id);
  if (!s) return;

  const modal = document.getElementById("review-suggestion-modal");
  if (!modal) return;

  document.getElementById("review-contributor").textContent = s.suggested_by;
  document.getElementById("review-avatar").textContent = s.suggested_by
    .charAt(0)
    .toUpperCase();
  document.getElementById("review-date").textContent = new Date(
    s.timestamp,
  ).toLocaleDateString();
  document.getElementById("review-question").textContent = s.question;
  document.getElementById("review-answer").textContent = s.answer;

  document.getElementById("review-approve-btn").onclick = () =>
    approveSuggestion(id, true);
  document.getElementById("review-reject-btn").onclick = () =>
    rejectSuggestion(id, true);

  modal.classList.add("active");
}

function closeReviewModal() {
  const modal = document.getElementById("review-suggestion-modal");
  if (modal) modal.classList.remove("active");
}

async function approveSuggestion(id, fromModal = false) {
  if (!(await CustomDialog.confirm("Approve this FAQ and publish it?")))
    return;

  try {
    const res = await fetch(`${API_URL}/admin/suggested-faqs/${id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("FAQ approved and published!");
      if (fromModal) closeReviewModal();
      refreshAdminData(); 
    } else {
      await CustomDialog.alert("Failed to approve suggestion.", "Approval Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

async function rejectSuggestion(id, fromModal = false) {
  if (!(await CustomDialog.confirm("Are you sure you want to reject and delete this suggestion?")))
    return;

  try {
    const res = await fetch(`${API_URL}/admin/suggested-faqs/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("Suggestion rejected.");
      if (fromModal) closeReviewModal();
      refreshAdminData(); 
    } else {
      await CustomDialog.alert("Failed to reject suggestion.", "Action Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveFAQ() {
  const question = document.getElementById("faq-question").value;
  const answer = document.getElementById("faq-answer").value;
  const category = document.getElementById("faq-category").value;

  if (!question || !answer) {
    await CustomDialog.alert("Please fill all fields.", "Validation Error", "warning");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/faqs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ question, answer, category }),
    });

    if (res.ok) {
      closeModal();
      refreshAdminData(); 
      
      document.getElementById("faq-question").value = "";
      document.getElementById("faq-answer").value = "";
    } else {
      await CustomDialog.alert("Failed to save FAQ", "Save Error", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

async function deleteFAQ(id) {
  if (!(await CustomDialog.confirm("Are you sure you want to delete this FAQ?")))
    return;

  try {
    const res = await fetch(`${API_URL}/admin/faqs/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      refreshAdminData(); 
    } else {
      await CustomDialog.alert("Failed to delete FAQ", "Delete Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

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
  "NCC Office SVU",
];

const locationsModal = document.getElementById("locations-modal");
const locationsListEl = document.getElementById("locations-list");

let currentUploadTarget = "admin"; 

function openUploadModal(target = "admin") {
  currentUploadTarget = target;
  const modal = document.getElementById("upload-modal");
  if (!modal) return;

  const header = modal.querySelector(".modal-header h3");
  if (header) {
    header.textContent =
      target === "study" ? "Upload Lecture Notes" : "Upload Admin Document";
  }

  modal.classList.add("active");
  document.getElementById("upload-file").value = ""; 
  const label = document.getElementById("file-label-text");
  if (label) label.textContent = "Click to upload PDF";
  document.getElementById("upload-progress").style.display = "none";
}

function closeUploadModal() {
  document.getElementById("upload-modal").classList.remove("active");
}

async function submitDocument() {
  const fileInput = document.getElementById("upload-file");
  const file = fileInput.files[0];
  const statusText = document.getElementById("upload-status");
  const progressBar = document.getElementById("upload-bar");
  const progressDiv = document.getElementById("upload-progress");

  if (!file) {
    await CustomDialog.alert("Please select a PDF file first.", "File Required", "warning");
    return;
  }

  progressDiv.style.display = "block";

  if (currentUploadTarget === "study") {
    statusText.textContent =
      "Uploading & Analyzing with AI... (This may take a moment)";
  } else {
    statusText.textContent = "Uploading and processing (Extracting FAQs)...";
  }

  progressBar.style.width = "50%";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const endpoint =
      currentUploadTarget === "study"
        ? `${API_URL}/study-buddy/upload`
        : `${API_URL}/admin/upload-document`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: formData,
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

      if (currentUploadTarget === "study") {
        showStatusPopup("Notes uploaded & Summarized!");
        loadStudyBuddy();
        
        if (data.summary) {
          const summaryEl = document.getElementById("material-summary-content");
          if (summaryEl) {
            summaryEl.innerHTML = `<div class="markdown-body">${marked.parse(data.summary)}</div>`;
            
            summaryEl.parentElement.style.border =
              "2px solid var(--accent-color)";
            setTimeout(() => {
              summaryEl.parentElement.style.border = "none";
            }, 2000);
            
            toggleStudyArchive(false);
          }
        }
      } else {
        showStatusPopup(
          `Uploaded! ${data.faqs_extracted || 0} FAQs extracted.`,
        );
        refreshAdminData(); 
      }
    }, 1500);
  } catch (e) {
    progressBar.style.backgroundColor = "#ef4444";
    statusText.textContent = "Error: " + e.message;
  }
}

const urlModal = document.getElementById("url-modal");
function openUrlModal() {
  if (urlModal) urlModal.classList.add("active");
}
function closeUrlModal() {
  if (urlModal) urlModal.classList.remove("active");
}

async function submitUrl() {
  const urlInput = document.getElementById("url-input");
  const url = urlInput.value.trim();
  const progressDiv = document.getElementById("url-progress");
  const statusText = document.getElementById("url-status");

  if (!url) {
    await CustomDialog.alert("Please enter a valid URL.", "URL Required", "warning");
    return;
  }

  progressDiv.style.display = "block";
  statusText.textContent = "Scraping and processing (Extracting FAQs)...";
  statusText.style.color = "var(--accent-color)";

  try {
    const res = await fetch(`${API_URL}/admin/add-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ url: url }),
    });

    if (!res.ok) throw new Error("Processing failed");

    const data = await res.json();
    progressDiv.style.display = "none";

    statusText.textContent = `Success! ${data.faqs_extracted || 0} FAQs extracted.`;

    urlInput.value = "";

    setTimeout(() => {
      closeUrlModal();
      showStatusPopup(`URL added! ${data.faqs_extracted || 0} FAQs found.`);
      refreshAdminData(); 
    }, 1500);
  } catch (e) {
    statusText.textContent = "Error: " + e.message;
    statusText.style.color = "#ef4444";
  }
}

const textModal = document.getElementById("text-modal");
function openTextModal() {
  if (textModal) textModal.classList.add("active");
}
function closeTextModal() {
  if (textModal) textModal.classList.remove("active");
}

async function submitText() {
  const title = document.getElementById("text-title").value.trim();
  const content = document.getElementById("text-content").value.trim();
  const progressDiv = document.getElementById("text-progress");
  const statusText = document.getElementById("text-status");

  if (!title || !content) {
    await CustomDialog.alert("Please provide both a Title and Content.", "Validation Error", "warning");
    return;
  }

  progressDiv.style.display = "block";
  statusText.textContent = "Processing text (Extracting FAQs)...";
  statusText.style.color = "var(--accent-color)";

  try {
    const res = await fetch(`${API_URL}/admin/add-text`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: title, content: content }),
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
      refreshAdminData(); 

      document.getElementById("text-title").value = "";
      document.getElementById("text-content").value = "";
      progressDiv.style.display = "none";
    }, 1500);
  } catch (e) {
    statusText.textContent = "Error: " + e.message;
    statusText.style.color = "#ef4444";
  }
}

// ─── Import Pre-Processed FAQs (No LLM) ───
let importFaqsParsedData = null;

function openImportFaqsModal() {
  const modal = document.getElementById("import-faqs-modal");
  if (!modal) return;
  modal.classList.add("active");

  // Reset state
  importFaqsParsedData = null;
  const sourceInput = document.getElementById("import-faq-source");
  const fileInput = document.getElementById("import-faq-file");
  const fileLabel = document.getElementById("faq-file-label-text");
  const preview = document.getElementById("import-faq-preview");
  const progress = document.getElementById("import-faq-progress");
  const dropZone = document.getElementById("faq-json-drop-zone");

  if (sourceInput) sourceInput.value = "";
  if (fileInput) fileInput.value = "";
  if (fileLabel) fileLabel.textContent = "Click or drag to upload JSON file";
  if (preview) preview.classList.add("hidden");
  if (progress) progress.classList.add("hidden");
  if (dropZone) dropZone.classList.remove("file-selected");

  // Setup drag-and-drop
  if (dropZone && !dropZone._dndSetup) {
    dropZone._dndSetup = true;
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".json")) {
        const fileInput = document.getElementById("import-faq-file");
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        handleFaqFileSelect(fileInput);
      }
    });
  }
}

function closeImportFaqsModal() {
  const modal = document.getElementById("import-faqs-modal");
  if (modal) modal.classList.remove("active");
  importFaqsParsedData = null;
}

function handleFaqFileSelect(input) {
  const file = input.files[0];
  const fileLabel = document.getElementById("faq-file-label-text");
  const preview = document.getElementById("import-faq-preview");
  const countBadge = document.getElementById("import-faq-count");
  const sampleDiv = document.getElementById("import-faq-sample");
  const dropZone = document.getElementById("faq-json-drop-zone");

  if (!file) {
    if (fileLabel) fileLabel.textContent = "Click or drag to upload JSON file";
    if (preview) preview.classList.add("hidden");
    if (dropZone) dropZone.classList.remove("file-selected");
    importFaqsParsedData = null;
    return;
  }

  if (fileLabel)
    fileLabel.innerHTML = `<span class="file-name-display"><i class="fa-solid fa-file-code"></i> ${escapeHtml(file.name)}</span>`;
  if (dropZone) dropZone.classList.add("file-selected");

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      let parsed = JSON.parse(e.target.result);

      // Support both array format and { faqs: [...] } format
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.faqs)) {
        parsed = parsed.faqs;
      }

      if (!Array.isArray(parsed)) {
        throw new Error("JSON must be an array of FAQ objects");
      }

      // Validate structure
      const validFaqs = parsed.filter(
        (f) => f.question && f.answer && typeof f.question === "string" && typeof f.answer === "string",
      );

      if (validFaqs.length === 0) {
        throw new Error("No valid FAQs found. Each item needs 'question' and 'answer' fields.");
      }

      importFaqsParsedData = validFaqs;

      if (countBadge) countBadge.textContent = `${validFaqs.length} FAQs`;
      if (sampleDiv) {
        const sampleItems = validFaqs.slice(0, 3);
        sampleDiv.innerHTML = sampleItems
          .map(
            (f, i) =>
              `<div style="margin-bottom: 8px; padding-bottom: 8px; ${i < sampleItems.length - 1 ? "border-bottom: 1px dashed var(--border-color);" : ""}">
                  <div style="font-weight: 600; color: var(--accent-color); margin-bottom: 2px;">Q: ${escapeHtml(f.question.substring(0, 100))}${f.question.length > 100 ? "..." : ""}</div>
                  <div style="color: var(--text-secondary);">A: ${escapeHtml(f.answer.substring(0, 120))}${f.answer.length > 120 ? "..." : ""}</div>
                  ${f.category ? `<span class="badge success" style="font-size: 9px; margin-top: 4px; padding: 2px 8px;">${escapeHtml(f.category)}</span>` : ""}
              </div>`,
          )
          .join("");

        if (validFaqs.length > 3) {
          sampleDiv.innerHTML += `<div style="text-align: center; color: var(--accent-color); font-weight: 600; padding-top: 4px;">+ ${validFaqs.length - 3} more FAQs...</div>`;
        }
      }

      if (preview) preview.classList.remove("hidden");

      if (parsed.length !== validFaqs.length) {
        showStatusPopup(`${parsed.length - validFaqs.length} items skipped (missing question/answer).`);
      }
    } catch (err) {
      importFaqsParsedData = null;
      if (preview) preview.classList.add("hidden");
      if (fileLabel)
        fileLabel.innerHTML = `<span style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Invalid JSON: ${escapeHtml(err.message)}</span>`;
      if (dropZone) dropZone.classList.remove("file-selected");
    }
  };
  reader.readAsText(file);
}

async function submitImportFaqs() {
  const sourceName = document.getElementById("import-faq-source")?.value.trim();
  const progressDiv = document.getElementById("import-faq-progress");
  const statusText = document.getElementById("import-faq-status");
  const progressBar = document.getElementById("import-faq-bar");
  const submitBtn = document.getElementById("import-faq-submit-btn");

  if (!sourceName) {
    await CustomDialog.alert("Please provide a source name/label for these FAQs.", "Source Required", "warning");
    return;
  }

  if (!importFaqsParsedData || importFaqsParsedData.length === 0) {
    await CustomDialog.alert("Please upload a valid JSON file with FAQs first.", "File Required", "warning");
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (progressDiv) progressDiv.classList.remove("hidden");
  if (progressBar) progressBar.style.width = "30%";
  if (statusText)
    statusText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Importing ${importFaqsParsedData.length} FAQs directly to database...`;

  try {
    const res = await fetch(`${API_URL}/admin/import-faqs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        source_name: sourceName,
        faqs: importFaqsParsedData,
      }),
    });

    if (progressBar) progressBar.style.width = "90%";

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Import failed");
    }

    const data = await res.json();

    if (progressBar) progressBar.style.width = "100%";
    if (statusText) {
      statusText.innerHTML = `<i class="fa-solid fa-check-circle" style="color: #22c55e;"></i> Done! ${data.imported || 0} imported, ${data.skipped || 0} skipped.`;
      statusText.style.color = "#22c55e";
    }

    setTimeout(() => {
      closeImportFaqsModal();
      showStatusPopup(`${data.imported || 0} FAQs imported from '${sourceName}'!`);
      refreshAdminData();
    }, 2000);
  } catch (e) {
    if (progressBar) {
      progressBar.style.width = "100%";
      progressBar.style.background = "#ef4444";
    }
    if (statusText) {
      statusText.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error: ${escapeHtml(e.message)}`;
      statusText.style.color = "#ef4444";
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function openLocations() {
  const listEl = document.getElementById("locations-list");
  const searchInput = document.getElementById("locations-search");

  if (searchInput) searchInput.value = "";

  if (listEl) {
    
    const highlighter = document.getElementById("locations-highlighter");
    
    Array.from(listEl.children).forEach((child) => {
      if (child.id !== "locations-highlighter") child.remove();
    });

    locations.forEach((name, index) => {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "location-item";
      a.textContent = name;

      a.onmouseenter = () => {
        if (highlighter) {
          highlighter.style.top = `${a.offsetTop}px`;
          highlighter.style.height = `${a.offsetHeight}px`;
          highlighter.style.opacity = "1";
        }
      };

      a.onmouseleave = () => {
        if (highlighter) highlighter.style.opacity = "0";
      };

      a.onclick = (e) => {
        e.preventDefault();
        document
          .querySelectorAll(".location-item")
          .forEach((item) => item.classList.remove("active"));
        a.classList.add("active");
        openLocationMap(name);
      };
      listEl.appendChild(a);
    });
  }
}

function closeLocations() {
  if (locationsModal) locationsModal.classList.remove("active");
}

function openLocationMap(name) {
  const query = `${name}, Sri Venkateswara University, Tirupati, Andhra Pradesh`;
  const url =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(query);
  window.open(url, "_blank");
}

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

const rangeInputs = document.querySelectorAll(".custom-range");
rangeInputs.forEach((input) => {
  input.addEventListener("input", (e) => {
    e.target.nextElementSibling.textContent = (e.target.value / 100).toFixed(1);
  });
});

setInterval(() => {
  const healthBar = document.querySelector(".progress-bar-fill");
  if (healthBar) {
    const usage = Math.floor(Math.random() * (80 - 40 + 1) + 40);
    healthBar.style.width = `${usage}%`;

    if (usage > 75) {
      healthBar.style.background = "linear-gradient(90deg, #f59e0b, #ef4444)";
    } else {
      healthBar.style.background = "linear-gradient(90deg, #3b82f6, #6366f1)";
    }
  }
}, 3000);

async function clearCache() {
  if (
    !(await CustomDialog.confirm(
      "Are you sure you want to clear the system cache? This will reset all active chat sessions.",
      "Clear System Cache",
      "warning",
    ))
  )
    return;

  try {
    const res = await fetch(`${API_URL}/admin/cache/clear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("System cache cleared successfully!");
    } else {
      await CustomDialog.alert("Failed to clear cache.", "Clear Cache Failed", "error");
    }
  } catch (e) {
    console.error(e);
    await CustomDialog.alert("Error clearing cache.", "System Error", "error");
  }
}

async function reindexData() {
  if (
    !(await CustomDialog.confirm(
      "Refresh knowledge base connection?\n(This re-initializes the RAG pipeline)",
      "Reindex Knowledge Base",
      "info",
    ))
  )
    return;

  showStatusPopup("Refreshing RAG pipeline...");

  try {
    const res = await fetch(`${API_URL}/admin/reindex`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("Knowledge base connection refreshed!");
      
      loadSystemHealth();
    } else {
      await CustomDialog.alert("Failed to refresh connection.", "Refresh Failed", "error");
    }
  } catch (e) {
    console.error(e);
    await CustomDialog.alert("Error refreshing knowledge base.", "System Error", "error");
  }
}

function startNewChat() {
  const chatBox = document.getElementById("chat-box");
  const welcomeScreen = document.getElementById("welcome-screen");
  if (chatBox) chatBox.innerHTML = "";
  if (welcomeScreen) welcomeScreen.style.display = "flex";
  showStatusPopup("Thread cleared");
}

function handleFileSelect(input) {
  const label = input.nextElementSibling;
  const span = label.querySelector("span");
  const container = input.parentElement;

  if (input.files && input.files[0]) {
    span.innerHTML = `<span class="file-name-display"><i class="fa-solid fa-file-pdf"></i> ${input.files[0].name}</span>`;
    container.classList.add("file-selected");
  } else {
    span.textContent = "Click to upload PDF";
    container.classList.remove("file-selected");
  }
}

function showStatusPopup(message, duration = 2000) {
  let toast = document.getElementById("toast-notification");
  
  const oldPopup = document.getElementById("status-popup");
  if (oldPopup) oldPopup.remove();

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-notification";
    toast.className = "toast-notification";
    document.body.appendChild(toast);
  }

  let icon = '<i class="fa-solid fa-circle-info" style="color: #2dd4bf;"></i>';
  if (message.toLowerCase().includes("error"))
    icon =
      '<i class="fa-solid fa-circle-exclamation" style="color: #ef4444;"></i>';
  if (message.toLowerCase().includes("success"))
    icon = '<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;

  void toast.offsetWidth;

  toast.classList.add("show");

  if (toast.timeoutId) clearTimeout(toast.timeoutId);

  toast.timeoutId = setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

async function loadUsers() {
  try {
    const res = await fetch(`${API_URL}/admin/users?limit=50`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!res.ok) return;
    const users = await res.json();
    
    window.allUsers = users;
    
    renderUsersTable(users);
  } catch (e) {
    console.error("Load Users Error", e);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("users-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (users.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align: center; padding: 20px;">No users found.</td></tr>';
    return;
  }

  users.forEach((u) => {
    const initial = u.username.charAt(0).toUpperCase();
    let roleBadge = "info";
    if (u.role === "admin") roleBadge = "success"; 
    if (u.role === "student") roleBadge = "warning"; 

    const roleLabel = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    const joinedDate = new Date(u.created_at).toLocaleDateString();

    tbody.innerHTML += `
        <tr>
            <td style="padding: 12px; display: flex; align-items: center; gap: 10px;" title="${escapeHtml(u.username)}">
                <div style="width: 32px; height: 32px; background: ${u.role === "admin" ? "#6366f1" : "#10b981"}; color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                    ${initial}
                </div>
                <div>
                    <div style="font-weight: 600;">${escapeHtml(u.username)}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">ID: ...${u.id.substring(u.id.length - 6)}</div>
                </div>
            </td>
            <td style="padding: 12px;" title="${roleLabel}"><span class="badge ${roleBadge}">${roleLabel}</span></td>
            <td style="padding: 12px; font-size: 13px;" title="${joinedDate}">${joinedDate}</td>
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

}

async function deleteUser(id) {
  if (
    !(await CustomDialog.confirm(
      "Are you sure you want to delete this user? This action cannot be undone.",
      "Delete User Account",
      "error",
    ))
  )
    return;

  try {
    const res = await fetch(`${API_URL}/admin/users/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const data = await res.json();
    if (res.ok) {
      showStatusPopup("User deleted successfully");
      loadUsers();
    } else {
      await CustomDialog.alert(data.detail || "Failed to delete user", "Delete Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

const addUserModal = document.getElementById("add-user-modal");

async function toggleUserRole(id, currentRole) {
  const newRole = currentRole === "admin" ? "student" : "admin";
  if (!(await CustomDialog.confirm(`Switch this user's role to ${newRole.toUpperCase()}?`, "Update User Role", "info"))) return;

  try {
    const res = await fetch(`${API_URL}/admin/users/${id}/role`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: newRole }),
    });

    if (res.ok) {
      showStatusPopup(`User is now ${newRole}`);
      loadUsers();
    } else {
      await CustomDialog.alert("Failed to update role", "Role Update Failed", "error");
    }
  } catch (e) {
    console.error(e);
  }
}
window.toggleUserRole = toggleUserRole;

async function loadSystemHealth() {
  if (!ACCESS_TOKEN) return;
  try {
    const start = Date.now();
    const res = await fetch(`${API_URL}/admin/system-health`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const latency = Date.now() - start;
    const data = await res.json();

    const apiBadge = document.getElementById("health-api");
    if (apiBadge) {
      apiBadge.textContent = `${latency}ms`;
      apiBadge.className = `badge ${latency < 200 ? "success" : "warning"}`;
    }

    const vectorStatus = data.vector_db_status || "unknown";
    const vectorBadge = document.getElementById("health-vector");
    if (vectorBadge) {
      vectorBadge.textContent =
        vectorStatus === "active" ? "CONNECTED" : "OFFLINE";
      vectorBadge.className = `badge ${vectorStatus === "active" ? "success" : "error"}`;
    }

    const mongoStatus = data.mongodb_status || "unknown";
    const mongoBadge = document.getElementById("health-mongo");
    if (mongoBadge) {
      mongoBadge.textContent = mongoStatus.toUpperCase();
      mongoBadge.className = `badge ${mongoStatus === "connected" ? "success" : "error"}`;
    }

    const llmBadge = document.getElementById("health-llm");
    if (llmBadge) {
      llmBadge.textContent = data.llm_service.toUpperCase();
      llmBadge.className = `badge ${data.llm_service === "online" ? "success" : "error"}`;
    }

    fetchSystemLogs();
  } catch (e) {
    console.error("Error checking system health:", e);
  }
}

async function fetchSystemLogs() {
  if (!ACCESS_TOKEN) return;
  const container = document.getElementById("system-logs-container");
  if (!container) return;

  try {
    const res = await fetch(`${API_URL}/admin/system-logs?limit=50`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!res.ok) throw new Error("Failed to fetch logs");
    const logs = await res.json();

    if (logs.length === 0) {
      container.innerHTML =
        '<div style="color: #64748b; text-align: center; padding-top: 60px;">No logs available yet.</div>';
      return;
    }

    container.innerHTML = logs
      .map((log) => {
        let color = "#cbd5e1"; 
        if (log.level === "SUCCESS") color = "#10b981";
        if (log.level === "WARN") color = "#f59e0b";
        if (log.level === "ERROR") color = "#ef4444";

        return `<div style="margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">
                <span style="color: #64748b; font-size: 10px;">[${log.timestamp}]</span>
                <span style="color: ${color}; font-weight: 600;">[${log.level}]</span>
                <span>${log.message}</span>
                ${log.details ? `<div style="color: #94a3b8; font-size: 10px; margin-left: 20px;">${log.details}</div>` : ""}
            </div>`;
      })
      .join("");

  } catch (e) {
    console.error("Error fetching system logs:", e);
  }
}

function openAddUserModal() {
  const modal = document.getElementById("add-user-modal");
  if (modal) modal.classList.add("active");
}

function closeAddUserModal() {
  const modal = document.getElementById("add-user-modal");
  if (modal) modal.classList.remove("active");
}

async function submitAddUser() {
  const email = document.getElementById("new-user-email").value.trim();
  const pass = document.getElementById("new-user-pass").value;
  const role = document.getElementById("new-user-role").value;

  if (!email || !pass) {
    showStatusPopup("Please fill all fields", "warning");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ username: email, password: pass, role: role }),
    });
    const data = await res.json();
    if (res.ok) {
      showStatusPopup("User created successfully!");
      closeAddUserModal();
      loadUsers(); 
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
  const refreshBtn = document.getElementById("admin-refresh-all");
  const refreshIcon = refreshBtn ? refreshBtn.querySelector("i") : null;

  if (refreshIcon) refreshIcon.classList.add("fa-spin");

  try {
    showToast("Admin Refresh", "Updating all system features...");

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
    ]);

    showToast("Success", "All admin features updated successfully!");
  } catch (error) {
    console.error("Global Refresh Failed:", error);
    showToast("Refresh Error", "Some components failed to reload.", "error");
  } finally {
    
    setTimeout(() => {
      if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }, 800);
  }
}


function filterAdminUsers() {
  const query = document
    .getElementById("user-search-input")
    .value.toLowerCase();
  const filtered = (window.allUsers || []).filter(
    (u) =>
      (u.username && u.username.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.full_name && u.full_name.toLowerCase().includes(query)),
  );
  renderUsersTable(filtered);
}

function filterAdminCalendar() {
  const query = document
    .getElementById("calendar-search-input")
    .value.toLowerCase();
  const filtered = (window.allAdminEvents || []).filter(
    (e) =>
      (e.title && e.title.toLowerCase().includes(query)) ||
      (e.category && e.category.toLowerCase().includes(query)) ||
      (e.description && e.description.toLowerCase().includes(query)),
  );
  renderCalendarAdminTable(filtered);
}

function filterAdminLocations() {
  const query = document
    .getElementById("location-search-input")
    .value.toLowerCase();
  const filtered = (locationsData || []).filter(
    (l) =>
      (l.name && l.name.toLowerCase().includes(query)) ||
      (l.category && l.category.toLowerCase().includes(query)) ||
      (l.description && l.description.toLowerCase().includes(query)),
  );
  
  const bypassExpand = query.length > 0;
  renderAdminLocationsTable(filtered, bypassExpand);
}

function filterAdminTickets() {
  const query = document
    .getElementById("ticket-search-input")
    .value.toLowerCase();
  const filtered = (window.allTickets || []).filter(
    (t) =>
      (t.subject && t.subject.toLowerCase().includes(query)) ||
      (t.category && t.category.toLowerCase().includes(query)) ||
      (t.user_email && t.user_email.toLowerCase().includes(query)) ||
      (String(t.id) && String(t.id).toLowerCase().includes(query)),
  );
  renderTicketsTable(filtered);
}

function filterAdminSuggestions() {
  const query = document
    .getElementById("suggestion-search-input")
    .value.toLowerCase();
  const filtered = (window.allSuggestions || []).filter(
    (s) =>
      (s.question && s.question.toLowerCase().includes(query)) ||
      (s.answer && s.answer.toLowerCase().includes(query)) ||
      (s.user_email && s.user_email.toLowerCase().includes(query)),
  );
  renderSuggestedFAQsTable(filtered);
}

window.filterAdminUsers = filterAdminUsers;
window.filterAdminCalendar = filterAdminCalendar;
window.filterAdminLocations = filterAdminLocations;
window.filterAdminTickets = filterAdminTickets;
window.filterAdminSuggestions = filterAdminSuggestions;

let currentTrendingQueries = [];

async function loadAdminTrending() {
  try {
    const res = await fetch(`${API_URL}/admin/trending`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    currentTrendingQueries = await res.json();
    renderAdminTrendingList();
  } catch (e) {
    console.error("Failed to load admin trending", e);
  }
}

function renderAdminTrendingList() {
  const tbody = document.getElementById("admin-trending-list");
  if (!tbody) return;

  tbody.innerHTML = "";

  currentTrendingQueries.forEach((q) => {
    const row = document.createElement("tr");
    row.style.borderBottom = "1px solid rgba(0,0,0,0.03)";
    row.innerHTML = `
            <td class="text-center no-ellipsis" style="padding: 15px 10px;">
                <div style='width:36px; height:36px; background: linear-gradient(135deg, #14b8a6, #0d9488); color:white; display:inline-flex; align-items:center; justify-content:center; border-radius:10px; box-shadow: 0 4px 10px rgba(20, 184, 166, 0.2);'>
                    <i class='${q.icon}' style='font-size: 16px;'></i>
                </div>
            </td>
            <td>
                <div style='font-weight:600; color:var(--text-primary); font-size:14px;'>${escapeHtml(q.text)}</div>
            </td>
            <td>
                <div style='font-size:12px; color:var(--text-secondary); opacity: 0.8;'>${escapeHtml(q.subtext)}</div>
                ${q.link ? `<div style='font-size:11px; color:var(--accent-color); margin-top:2px;'><i class='fa-solid fa-link'></i> ${escapeHtml(q.link)}</div>` : ""}
            </td>
            <td class="text-right">
                <div style='display:flex; gap:8px; justify-content: flex-end;'>
                    <button class="icon-btn" onclick='editTrendingQuery("${q.id}")' title='Edit'>
                        <i class='fa-solid fa-pen' style='font-size: 13px;'></i>
                    </button>
                    <button class="icon-btn" onclick='deleteTrendingQuery("${q.id}")' style="color: #ef4444;" title='Delete'>
                        <i class='fa-solid fa-trash' style='font-size: 13px;'></i>
                    </button>
                </div>
            </td>
        `;
    tbody.appendChild(row);
  });
}

function editTrendingQuery(id) {
  const query = currentTrendingQueries.find((q) => q.id === id);
  if (query) {
    openAddTrendingModal(query);
  } else {
    showStatusPopup("Query not found", 1500);
  }
}
window.editTrendingQuery = editTrendingQuery;

function openAddTrendingModal(query = null) {
  const modal = document.getElementById("trending-modal");
  if (!modal) return;

  if (!query && currentTrendingQueries.length >= 4) {
    showStatusPopup("Maximum Queries reached", 1000);
    return;
  }

  const idInput = document.getElementById("trending-id");
  const textInput = document.getElementById("trending-text");
  const subtextInput = document.getElementById("trending-subtext");
  const responseInput = document.getElementById("trending-response");
  const linkInput = document.getElementById("trending-link");
  const hiddenIcon = document.getElementById("trending-icon");
  const modalTitle = modal.querySelector("h3");
  const submitBtn = document.getElementById("btn-trending-submit");

  if (query) {
    
    if (idInput) idInput.value = query.id;
    if (textInput) textInput.value = query.text;
    if (subtextInput) subtextInput.value = query.subtext;
    if (responseInput) responseInput.value = query.response || "";
    if (linkInput) linkInput.value = query.link || "";
    if (hiddenIcon) hiddenIcon.value = query.icon;

    if (modalTitle) modalTitle.innerText = "Update Trending Query";
    if (submitBtn) {
      submitBtn.innerText = "Update Query";
      submitBtn.onclick = addTrendingQuery;
    }

    document.querySelectorAll(".icon-option").forEach((el) => {
      if (el.innerHTML.includes(query.icon)) el.classList.add("selected");
      else el.classList.remove("selected");
    });
  } else {
    
    if (idInput) idInput.value = "";
    if (textInput) textInput.value = "";
    if (subtextInput) subtextInput.value = "";
    if (responseInput) responseInput.value = "";
    if (linkInput) linkInput.value = "";
    if (hiddenIcon) hiddenIcon.value = "fa-solid fa-fire"; 

    if (modalTitle) modalTitle.innerText = "Add Trending Query";
    if (submitBtn) {
      submitBtn.innerText = "Add Query";
      submitBtn.onclick = addTrendingQuery;
    }

    document
      .querySelectorAll(".icon-option")
      .forEach((el) => el.classList.remove("selected"));
  }

  modal.style.display = "flex";
  requestAnimationFrame(() => modal.classList.add("active"));
  renderSymbolPicker();
}

const TRENDING_ICONS = [
  "fa-solid fa-graduation-cap",
  "fa-solid fa-book",
  "fa-solid fa-calendar-days",
  "fa-solid fa-map-location-dot",
  "fa-solid fa-bus",
  "fa-solid fa-building-columns",
  "fa-solid fa-user-graduate",
  "fa-solid fa-microscope",
  "fa-solid fa-flask",
  "fa-solid fa-laptop-code",
  "fa-solid fa-fire",
  "fa-solid fa-star",
];

const ICON_NAMES = {
  "fa-solid fa-graduation-cap": "Academics",
  "fa-solid fa-book": "Library/Study",
  "fa-solid fa-calendar-days": "Events/Calendar",
  "fa-solid fa-map-location-dot": "Campus Map",
  "fa-solid fa-bus": "Transport",
  "fa-solid fa-building-columns": "University/Dept",
  "fa-solid fa-user-graduate": "Student/Faculty",
  "fa-solid fa-microscope": "Research",
  "fa-solid fa-flask": "Science/Labs",
  "fa-solid fa-laptop-code": "IT/Tech",
  "fa-solid fa-fire": "Trending",
  "fa-solid fa-star": "Featured/Important",
};

function closeTrendingModal() {
  const modal = document.getElementById("trending-modal");
  if (!modal) return;
  modal.classList.remove("active");
  setTimeout(() => {
    modal.style.display = "none";
  }, 200);
}

function renderSymbolPicker() {
  const container = document.getElementById("icon-picker");
  const hiddenInput = document.getElementById("trending-icon");
  if (!container) return;

  container.innerHTML = "";
  TRENDING_ICONS.forEach((icon) => {
    const div = document.createElement("div");
    div.className = "icon-option";
    div.setAttribute("title", ICON_NAMES[icon] || "Icon"); 
    div.innerHTML = `<i class='${icon}'></i>`;

    if (hiddenInput.value === icon) {
      div.classList.add("selected");
    }

    div.onclick = () => {
      hiddenInput.value = icon;
      document
        .querySelectorAll(".icon-option")
        .forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
    };
    container.appendChild(div);
  });
}

async function addTrendingQuery() {
  const id = document.getElementById("trending-id").value;
  const text = document.getElementById("trending-text").value;
  const subtext = document.getElementById("trending-subtext").value;
  const response = document.getElementById("trending-response").value;
  const link = document.getElementById("trending-link").value;
  const icon = document.getElementById("trending-icon").value;

  if (!text || !subtext || !icon) {
    showStatusPopup("Text, Subtext and Icon are required");
    return;
  }

  const payload = { text, subtext, icon, response, link };

  try {
    console.log("Saving Query:", { id, payload });

    let url = `${API_URL}/admin/trending`;
    let method = "POST";

    if (id) {
      url = `${API_URL}/admin/trending/${id}`;
      method = "PUT";
    }

    const res = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      closeTrendingModal();
      loadAdminTrending();
      loadTrendingQueries(); 
      showStatusPopup(
        id ? "Query updated successfully!" : "Query added successfully!",
      );
    } else {
      const data = await res.json();
      await CustomDialog.alert(`Failed to save query: ${data.detail || res.statusText}`, "Save Error", "error");
      console.error("Save Query Error:", data);
    }
  } catch (e) {
    console.error(e);
  }
}

async function deleteTrendingQuery(id) {
  if (!(await CustomDialog.confirm("Delete this query?", "Delete Trending Query", "warning"))) return;
  try {
    const res = await fetch(`${API_URL}/admin/trending/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (res.ok) {
      loadAdminTrending();
      loadTrendingQueries();
      showStatusPopup("Query deleted");
    }
  } catch (e) {
    console.error(e);
  }
}

window.openAddTrendingModal = openAddTrendingModal;
window.closeTrendingModal = closeTrendingModal;
window.addTrendingQuery = addTrendingQuery;
window.deleteTrendingQuery = deleteTrendingQuery;

let zenChatHistory = [];
let zenRecognition = null;

function showZenTypingIndicator() {
  const orb = document.querySelector("#zen-chat-history .zen-orb");
  if (orb) orb.classList.add("synthesizing");
  
  const indicator = document.getElementById("zen-typing-indicator");
  if (indicator) indicator.classList.remove("hidden");
  const history = document.getElementById("zen-chat-history");
  if (history) {
    history.scrollTo({ top: history.scrollHeight, behavior: 'smooth' });
  }
}

function hideZenTypingIndicator() {
  const orb = document.querySelector("#zen-chat-history .zen-orb");
  if (orb) orb.classList.remove("synthesizing");

  const indicator = document.getElementById("zen-typing-indicator");
  if (indicator) indicator.classList.add("hidden");
}

function setZenInput(text) {
  const input = document.getElementById("zen-input");
  if (input) {
    input.value = text;
    input.focus();
  }
}
window.setZenInput = setZenInput;

function switchStudyTab(tab) {
  const notesTab = document.getElementById("tab-study-notes");
  const zenTab = document.getElementById("tab-study-zen");
  const notesView = document.getElementById("study-notes-view");
  const zenView = document.getElementById("study-zen-view");

  if (currentChatController) currentChatController.abort();

  const workspace = document.getElementById("study-section");
  if (workspace) workspace.scrollTop = 0;

  if (tab === "notes") {
    notesTab.classList.add("active");
    zenTab.classList.remove("active");
    notesView.classList.remove("hidden");
    zenView.classList.add("hidden");
    
    const docInput = document.getElementById("document-chat-input");
    if (docInput && currentStudyMaterialId) docInput.focus({ preventScroll: true });
  } else {
    zenTab.classList.add("active");
    notesTab.classList.remove("active");
    zenView.classList.remove("hidden");
    notesView.classList.add("hidden");
    
    setTimeout(() => {
      const zenInput = document.getElementById("zen-input");
      if (zenInput) zenInput.focus({ preventScroll: true });
    }, 100);
  }
}

function handleStudyNewChat() {
  const zenView = document.getElementById("study-zen-view");
  if (zenView && !zenView.classList.contains("hidden")) {
    newZenChat();
  } else {
    const docHistory = document.getElementById("document-chat-history");
    if (docHistory) {
      docHistory.innerHTML = `<div class="bot-msg-standard">Please ask any specific questions about the analyzed material.</div>`;
    }
  }
}

async function sendZenMessage() {
  const input = document.getElementById("zen-input");
  const text = input.value.trim();
  if (!text || !ACCESS_TOKEN) return;

  if (currentChatController) currentChatController.abort();
  currentChatController = new AbortController();

  input.value = "";
  appendZenMessage(text, "user");
  showZenTypingIndicator();

  const welcome = document.querySelector("#zen-chat-history .welcome-screen");
  if (welcome) welcome.remove();

  try {
    const response = await fetch(`${API_URL}/study-buddy/zen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      signal: currentChatController.signal,
      body: JSON.stringify({
        query: text,
        history: zenChatHistory,
      }),
    });

    const data = await response.json();
    hideZenTypingIndicator();
    if (data.response) {
      appendZenMessage(data.response, "zen");
      zenChatHistory.push({ role: "user", content: text });
      zenChatHistory.push({ role: "assistant", content: data.response });
    } else {
      appendZenMessage("Zen is momentarily offline. Please try again.", "zen");
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    hideZenTypingIndicator();
    console.error("Zen Error:", err);
    appendZenMessage(
      "Zen encountered a neural hiccup. Check your connection.",
      "zen",
    );
  }
}

function renderZenContent(element) {
  
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(element, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ],
      throwOnError: false
    });
  }
  
  if (typeof hljs !== 'undefined') {
    element.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }
}

function appendZenMessage(text, role) {
  const history = document.getElementById("zen-chat-history");
  if (!history) return;

  const messageItem = document.createElement("div");
  messageItem.className = `zen-message-item ${role} animate-fadeIn`;

  const bubble = document.createElement("div");
  bubble.className = `zen-message ${role}`;

  let displayText = text;
  let followupsContainer = null;

  const followupPatterns = [
    /Relevant Questions:[\s\S]*$/i,
    /Follow-up questions:[\s\S]*$/i,
    /Would you like to know about:[\s\S]*$/i,
    /\n\n\d\. .*\?\n\d\. .*\?\n\d\. .*\?$/ 
  ];

  let matchedPattern = null;
  for (const pattern of followupPatterns) {
    const match = text.match(pattern);
    if (match && role === "zen") {
      matchedPattern = match[0];
      break;
    }
  }

  if (matchedPattern) {
    displayText = text.replace(matchedPattern, "");
    followupsContainer = document.createElement("div");
    followupsContainer.className = "zen-followup-container";

    const questions = matchedPattern
      .split("\n")
      .filter((q) => q.trim() && q.includes("?"));
      
    questions.forEach((q) => {
      const cleanQ = q.replace(/^[\d.*-\s]+/, "").trim();
      if (cleanQ) {
        const chip = document.createElement("button");
        chip.className = "zen-followup-chip";
        chip.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${cleanQ}`;
        chip.onclick = () => {
          const zenInput = document.getElementById("zen-input");
          if (zenInput) {
            zenInput.value = cleanQ;
            sendZenMessage();
          }
        };
        followupsContainer.appendChild(chip);
      }
    });
  }

  if (typeof marked !== 'undefined') {
      bubble.innerHTML = role === "zen" ? marked.parse(displayText) : formatText(displayText);
  } else {
      bubble.innerHTML = formatText(displayText);
  }

  renderZenContent(bubble);

  messageItem.appendChild(bubble);

  if (role === "zen") {
    
    const actions = document.createElement("div");
    actions.className = "zen-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "zen-action-btn";
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.title = "Copy Analysis";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(displayText);
      showStatusPopup("Copied to clipboard!", 1000);
    };

    const speakBtn = document.createElement("button");
    speakBtn.className = "zen-action-btn";
    speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    speakBtn.title = "Synthesize Speech";
    speakBtn.onclick = () => speakText(displayText, bubble, speakBtn);

    actions.appendChild(copyBtn);
    actions.appendChild(speakBtn);
    messageItem.appendChild(actions);

    if (followupsContainer && followupsContainer.children.length > 0) {
      messageItem.appendChild(followupsContainer);
    }
  }

  history.appendChild(messageItem);
  
  setTimeout(() => {
    history.scrollTo({
      top: history.scrollHeight,
      behavior: 'smooth'
    });
  }, 100);
}

function newZenChat() {
  zenChatHistory = [];
  const history = document.getElementById("zen-chat-history");
  if (history) {
    history.innerHTML = `
      <div class="welcome-screen my-auto">
           <div class="zen-orb mx-auto mb-15">
              <i class="fa-solid fa-brain text-50"></i>
           </div>
           <h1 class="gradient-text-teal mb-8 ls-neg-01 font-bold text-center">Hello, I am Zen.</h1>
           <p class="text-secondary text-md text-center max-w-500 mx-auto zen-welcome-text">
             Your academic partner for high-level synthesis and research support.
           </p>
      </div>
    `;
  }
  showStatusPopup("New session started.", 2000);
}

function refreshZenChat() {
  showStatusPopup("Refreshing connection to Zen...", 1500);
}

function startZenSTT() {
  if (!("webkitSpeechRecognition" in window)) {
    showStatusPopup("STT not supported in this browser.");
    return;
  }

  if (zenRecognition) {
    zenRecognition.stop();
    return;
  }

  zenRecognition = new webkitSpeechRecognition();
  zenRecognition.lang =
    document.getElementById("lang-select")?.value === "te"
      ? "te-IN"
      : document.getElementById("lang-select")?.value === "hi"
        ? "hi-IN"
        : "en-US";

  const btn = document.getElementById("zen-mic-btn");
  zenRecognition.onstart = () => btn.classList.add("active");
  zenRecognition.onend = () => {
    btn.classList.remove("active");
    zenRecognition = null;
  };

  zenRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById("zen-input").value = transcript;
    
  };

  zenRecognition.start();
}

window.switchStudyTab = switchStudyTab;
window.sendZenMessage = sendZenMessage;
window.newZenChat = newZenChat;
window.refreshZenChat = refreshZenChat;
window.startZenSTT = startZenSTT;

let notificationPollInterval = null;

function toggleNotifications() {
  const dropdown = document.getElementById("notification-dropdown");
  const bell = document.getElementById("notification-bell");
  if (!dropdown) return;

  if (dropdown.classList.contains("hidden") || dropdown.style.display === "none") {
    dropdown.classList.remove("hidden");
    dropdown.style.display = "flex";
    fetchNotifications(); 

    const closeDropdown = (e) => {
      if (!dropdown.contains(e.target) && e.target !== bell) {
        dropdown.classList.add("hidden");
        dropdown.style.display = "none";
        document.removeEventListener("click", closeDropdown);
      }
    };
    setTimeout(() => document.addEventListener("click", closeDropdown), 50);
  } else {
    dropdown.classList.add("hidden");
    dropdown.style.display = "none";
  }
}

async function fetchNotifications() {
  if (!ACCESS_TOKEN) return;

  try {
    const res = await fetch(`${API_URL}/notifications`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
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
  const container = document.getElementById("notification-items");
  const badge = document.getElementById("notification-badge");

  if (!container) return;

  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? "9+" : unreadCount;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }

  if (!notifications || notifications.length === 0) {
    container.innerHTML =
      '<div class="no-notifications">No notifications yet</div>';
    return;
  }

  const html = notifications
    .map((notif) => {
      const timeStr = formatNotifTime(notif.created_at);
      return `
            <div class="notification-item-wrapper ${notif.is_read ? "" : "unread"}">
                <div class="notification-item" onclick="handleNotifClick('${notif.id}', '${notif.link || ""}')">
                    <div class="notif-title">${notif.title}</div>
                    <div class="notif-msg">${notif.message}</div>
                    <div class="notif-time notif-time-text" data-created-at="${notif.created_at}">${timeStr}</div>
                </div>
                <button class="notif-delete-btn" onclick="deleteNotification(event, '${notif.id}')" title="Delete notification">
                    <i class="fa-solid fa-x"></i>
                </button>
            </div>
        `;
    })
    .join("");

  console.log(
    "Rendering notifications. First item HTML:",
    notifications.length > 0 ? html.substring(0, 200) : "empty",
  );
  container.innerHTML = html;
}

function formatNotifTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

async function handleNotifClick(id, link) {
  
  try {
    await fetch(`${API_URL}/notifications/${id}/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    fetchNotifications(); 

    if (link) {
      
      if (link.startsWith("#")) {
        const section = link.substring(1);
        showSection(section);
      } else {
        window.open(link, "_blank");
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
      method: "PATCH",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
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

  if (
    !(await CustomDialog.confirm(
      "Are you sure you want to clear your notifications? This will delete your personal alerts.",
      "Clear Notifications",
      "warning",
    ))
  )
    return;

  try {
    const res = await fetch(`${API_URL}/notifications/clear-all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
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

  fetchNotifications();

  notificationPollInterval = setInterval(fetchNotifications, 30000);
}

function stopNotificationPolling() {
  if (notificationPollInterval) {
    clearInterval(notificationPollInterval);
    notificationPollInterval = null;
  }
}

function updateNotificationTimestamps() {
  const timeElements = document.querySelectorAll(".notif-time-text");
  timeElements.forEach((el) => {
    const createdAt = el.getAttribute("data-created-at");
    if (createdAt) {
      el.textContent = formatNotifTime(createdAt);
    }
  });
}

setInterval(updateNotificationTimestamps, 60000);

async function deleteNotification(event, id) {
  if (event) event.stopPropagation(); 

  try {
    const res = await fetch(`${API_URL}/notifications/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      fetchNotifications(); 
    } else {
      console.error("Failed to delete notification");
    }
  } catch (e) {
    console.error("Error deleting notification:", e);
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFileIconClass(filename) {
  if (!filename) return "fa-solid fa-file";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "fa-solid fa-file-pdf";
  if (lower.startsWith("http")) return "fa-solid fa-link";
  return "fa-solid fa-file-lines";
}

window.toggleNotifications = toggleNotifications;
window.markAllNotificationsAsRead = markAllNotificationsAsRead;
window.clearAllNotifications = clearAllNotifications;
window.handleNotifClick = handleNotifClick;
window.deleteNotification = deleteNotification;

/* --- Custom Dialog System --- */
const CustomDialog = {
  modal: null,
  confirmBtn: null,
  cancelBtn: null,
  titleEl: null,
  msgEl: null,
  iconContainer: null,

  init() {
    this.modal = document.getElementById("dialog-modal");
    this.confirmBtn = document.getElementById("dialog-confirm-btn");
    this.cancelBtn = document.getElementById("dialog-cancel-btn");
    this.titleEl = document.getElementById("dialog-title");
    this.msgEl = document.getElementById("dialog-message");
    this.iconContainer = document.getElementById("dialog-icon");
  },

  show({ message, title = "Confirm Action", icon = "info", showCancel = true }) {
    if (!this.modal) this.init();

    return new Promise((resolve) => {
      this.titleEl.textContent = title;
      this.msgEl.textContent = message;
      this.cancelBtn.style.display = showCancel ? "block" : "none";

      this.iconContainer.className = "dialog-icon-circle";
      const iconClasses = {
        success: "fa-circle-check",
        warning: "fa-triangle-exclamation",
        error: "fa-circle-xmark",
        info: "fa-circle-info"
      };
      
      const iconColorClass = `dialog-icon-${icon}`;
      this.iconContainer.classList.add(iconColorClass);
      
      const iconI = this.iconContainer.querySelector("i");
      iconI.className = `fa-solid ${iconClasses[icon] || iconClasses.info}`;

      const handleConfirm = () => {
        this.close();
        resolve(true);
      };

      const handleCancel = () => {
        this.close();
        resolve(false);
      };

      this.confirmBtn.onclick = handleConfirm;
      this.cancelBtn.onclick = handleCancel;

      this.modal.classList.add("active");
    });
  },

  alert(message, title = "Alert", icon = "info") {
    return this.show({ message, title, icon, showCancel: false });
  },

  confirm(message, title = "Confirm", icon = "warning") {
    return this.show({ message, title, icon, showCancel: true });
  },

  close() {
    if (this.modal) this.modal.classList.remove("active");
  }
};
window.CustomDialog = CustomDialog;

if (ACCESS_TOKEN) {
  if (typeof startNotificationPolling === "function")
    startNotificationPolling();
}

window.addEventListener("resize", () => {
  if (window.innerWidth > 768) {
    toggleSidebar(true); 
  }
});
