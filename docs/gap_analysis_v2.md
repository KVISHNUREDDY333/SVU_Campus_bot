# Gap Analysis & Implementation Roadmap: Intelligent Campus Assistant v2

## 1. Current State vs. New Requirements

| Feature Category | Requirement | Status | Action Required |
| :--- | :--- | :--- | :--- |
| **Core AI** | LLM RAG, Vector Search, LangChain | ✅ Implemented | Refine for role-specific context. |
| **Interface** | Web Chat, STT/TTS | ✅ Implemented | Add dashboard views. |
| **Access Control** | **RBAC (Student/Faculty/Admin/Parent)** | ❌ **Missing** | **Implement JWT Auth, User Models, Role Middleware.** |
| **Privacy** | **Data Control (GDPR, Incognito, Auto-delete)** | ❌ **Missing** | **Add "Incognito Mode" toggle, data retention policies.** |
| **Analytics** | **Dashboard (Study patterns, Gamification)** | ❌ **Missing** | **Create User Dashboard, Log analytics events.** |
| **Notifications** | **Smart Notifications (Alerts, Scheduling)** | ❌ **Missing** | **Implement WebSockets/Polling for alerts.** |
| **Offline** | **Offline Mode (Service Workers)** | ❌ **Missing** | **Add PWA manifest, Service Worker for caching.** |
| **Academic AI** | **Academic Helper (Grades, Prerequisites)** | ❌ **Missing** | **Expand Knowledge Base with Course/Grade data logic.** |
| **Scheduling** | **Smart Schedule (Conflict detection)** | ❌ **Missing** | **Integrate Calendar/Timetable data structure.** |

---

## 2. Implementation Roadmap

### Phase 1: Foundation - Security & Identity (RBAC) **<-- STARTING HERE**
*   **Goal:** distinct experiences for Students, Faculty, and Admins.
*   **Tasks:**
    1.  Install Auth dependencies (`pyjwt`, `passlib`).
    2.  Update MongoDB schema to include `users` collection.
    3.  Create Login/Register API endpoints.
    4.  Create Login UI.
    5.  Protect Chat endpoints (require Login).

### Phase 2: User Experience - Privacy & Offline Support
*   **Goal:** Trust and reliability.
*   **Tasks:**
    1.  Implement "Incognito" switch (session-only memory).
    2.  Implement "Clear Data" and "Export Data" features.
    3.  Add Service Worker for PWA (Progressive Web App) capabilities.

### Phase 3: Advanced Intelligence - Dashboard & Academic Helper
*   **Goal:** Value-add features beyond simple Q&A.
*   **Tasks:**
    1.  Build Analytics Dashboard (charts for query history).
    2.  Expand RAG to handle personalized academic data (mock grades/schedule).

---

## 3. Immediate Next Steps (Configuration)
1.  Update `requirements.txt`.
2.  Refactor `backend/main.py` to handle Auth.
