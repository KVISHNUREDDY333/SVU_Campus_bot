async function loadCalendar() {
  const list = document.getElementById("calendar-list");
  list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
        <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
        <p style="margin-top: 10px;">Searching for upcoming events...</p>
    </div>`;

  try {
    const res = await fetch(`${API_URL}/calendar`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
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
  const list = document.getElementById("calendar-list");
  if (!list) return;

  if (events.length === 0) {
    list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-secondary);">
            <i class="fa-solid fa-calendar-day fa-3x" style="opacity: 0.3; margin-bottom: 20px;"></i>
            <p style="font-size: 1.1rem; font-weight: 500;">No upcoming events scheduled at this moment.</p>
        </div>`;
    return;
  }

  const cardsHtml = events
    .map((e) => {
      const fromDate = e.from_date || e.date || "";
      const toDate = e.to_date || e.date || "";
      const fromDateTime = new Date(fromDate);
      const toDateTime = new Date(toDate);

      if (isNaN(fromDateTime.getTime())) return "";

      const day = fromDateTime.getDate();
      const month = fromDateTime.toLocaleString("default", { month: "short" }).toUpperCase();

      let colorClass = "event-holiday";
      if (e.type === "Exam") colorClass = "event-exam";
      if (e.type === "Event") colorClass = "event-general";

      const escapedTitle = escapeHtml(e.title).replace(/'/g, "\\'");
      const escapedDesc = escapeHtml(e.description || "").replace(/'/g, "\\'");

      return `
            <div class="calendar-stats-card card-${(e.type || "Event").toLowerCase()}">
                <div class="date-side">
                    <div class="date-box">
                        <div class="day-num">${day}</div>
                        <div class="month-name">${month}</div>
                    </div>
                </div>
                <div class="info-side">
                    <div class="mb-4">
                        <span class="event-pill ${e.type === "Exam" ? "pill-exam" : e.type === "Event" ? "pill-event" : "pill-holiday"}">
                            ${(e.type || "Event").toUpperCase()}
                        </span>
                    </div>
                    <div class="event-title-main">${escapeHtml(e.title)}</div>

                    <div class="event-data-grid mt-16 mb-16">
                        <div class="data-row">
                            <i class="fa-solid fa-clock data-icon text-accent"></i>
                            <div class="data-content">
                                <span class="data-label">Time:</span>
                                <span class="data-value">${fromDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${toDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        </div>
                        ${e.location ? `
                        <div class="data-row">
                            <i class="fa-solid fa-location-dot data-icon text-accent"></i>
                            <div class="data-content">
                                <span class="data-label">Location:</span>
                                <span class="data-value">${escapeHtml(e.location)}</span>
                            </div>
                        </div>
                        ` : ""}
                    </div>

                    <div class="event-desc-sub mb-16 border-top pt-12">
                        ${escapeHtml(e.description || "University-wide scheduled activity.")}
                    </div>

                    <div class="card-footer-actions">
                        <a href="javascript:void(0)" class="gcal-btn" 
                           onclick="addToGoogleCalendar('${escapedTitle}', '${fromDate}', '${toDate}', '${escapedDesc}')">
                            <i class="fa-brands fa-google mr-4"></i> Add to Google Calendar
                        </a>
                    </div>
                </div>
            </div>`;
    })
    .join("");

  list.innerHTML = cardsHtml;
}

async function addToGoogleCalendar(title, fromDateStr, toDateStr, desc) {
  const fromDate = new Date(fromDateStr);
  const toDate = new Date(toDateStr);

  const fmtDateTime = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
  };

  const start = fmtDateTime(fromDate);
  const end = fmtDateTime(toDate);

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(desc)}`;

  if (await CustomDialog.confirm(`Add "${title}" to your Google Calendar?`, "Add to Calendar", "info")) {
    window.open(url, "_blank");
  }
}window.addToGoogleCalendar = addToGoogleCalendar;

async function loadCalendarAdmin() {
  const events = await loadAcademicCalendar();
  window.allAdminEvents = events || [];
  renderCalendarAdminTable(window.allAdminEvents);
}

function renderCalendarAdminTable(events) {
  const tbody = document.getElementById("calendar-admin-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (events.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align: center; padding: 20px;">No events posted.</td></tr>';
    return;
  }

  tbody.innerHTML = events
    .map((e) => {
      const fromDate = e.from_date || e.date || "";
      const toDate = e.to_date || e.date || "";

      const fromDateTime = new Date(fromDate);
      const toDateTime = new Date(toDate);

      if (isNaN(fromDateTime.getTime()) || isNaN(toDateTime.getTime())) {
        console.warn("Invalid date found in admin calendar event:", e);
        return ""; 
      }

      const fromDateOnly = fromDateTime.toISOString().split("T")[0];
      const toDateOnly = toDateTime.toISOString().split("T")[0];
      const isSingleDay = fromDateOnly === toDateOnly;

      const formatTime = (date) => {
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${hours}:${minutes}`;
      };

      let dateDisplay;
      if (isSingleDay) {
        const dateFormatted = fromDateTime.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const startTime = formatTime(fromDateTime);
        const endTime = formatTime(toDateTime);
        dateDisplay = `${dateFormatted} | ${startTime} - ${endTime}`;
      } else {
        const fromFormatted = fromDateTime.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const toFormatted = toDateTime.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const startTime = formatTime(fromDateTime);
        const endTime = formatTime(toDateTime);
        dateDisplay = `${fromFormatted} ${startTime} → ${toFormatted} ${endTime}`;
      }

      const escapedId = (e.id || "").replace(/'/g, "\\'");

      return `
        <tr>
            <td style="padding: 18px 16px; font-size: 13px; color: #64748b;" title="${dateDisplay}">${dateDisplay}</td>
            <td style="padding: 18px 16px;" title="${escapeHtml(e.title)}">
                <div style="font-weight: 700; color: #1e293b; font-size: 14.5px; letter-spacing: -0.01em;">${escapeHtml(e.title)}</div>
                ${e.location ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 5px; display: flex; align-items: center; gap: 5px;"><i class="fa-solid fa-thumbtack" style="font-size: 10px; opacity: 0.7;"></i> ${escapeHtml(e.location)}</div>` : ""}
            </td>
            <td style="padding: 18px 16px;" title="${escapeHtml(e.type || "Event")}"><span class="badge" style="background: rgba(0,0,0,0.04); color: #64748b; padding: 4px 12px; border-radius: 50px; font-size: 10px; font-weight: 600; text-transform: lowercase;">${escapeHtml(e.type || "Event")}</span></td>
            <td style="padding: 18px 16px; text-align: right;">
                <div style="display: flex; gap: 14px; justify-content: flex-end; align-items: center;">
                  <button class="icon-btn" onclick="editCalendarEvent('${escapedId}')" style="color: #6366f1;" title="Edit event">
                      <i class="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button class="icon-btn" onclick="deleteCalendarEvent('${escapedId}')" style="color: #ef4444;" title="Delete event">
                      <i class="fa-solid fa-trash-can"></i>
                  </button>
                </div>
            </td>
        </tr>
    `;
    })
    .join("");

}

let currentEditEventId = null;

function toggleCustomEventType() {
  const typeSelect = document.getElementById("calendar-event-type");
  const customContainer = document.getElementById(
    "custom-event-type-container",
  );
  const customInput = document.getElementById("custom-event-type-input");

  if (typeSelect.value === "Custom") {
    customContainer.style.display = "block";
    customInput.focus();
  } else {
    customContainer.style.display = "none";
    customInput.value = "";
  }
}
window.toggleCustomEventType = toggleCustomEventType;

function openCalendarModal(eventData = null) {
  const modal = document.getElementById("calendar-event-modal");

  if (eventData) {
    
    currentEditEventId = eventData.id;
    document.getElementById("event-title").value = eventData.title;
    document.getElementById("event-from-date").value = eventData.from_date;
    document.getElementById("event-to-date").value = eventData.to_date;

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const minDateTime = now.toISOString().slice(0, 16);

    document.getElementById("event-from-date").min = minDateTime;
    document.getElementById("event-to-date").min = minDateTime;

    const predefinedTypes = ["Event", "Exam", "Holiday"];
    if (predefinedTypes.includes(eventData.type)) {
      document.getElementById("calendar-event-type").value = eventData.type;
      document.getElementById("custom-event-type-container").style.display =
        "none";
    } else {
      document.getElementById("calendar-event-type").value = "Custom";
      document.getElementById("custom-event-type-input").value = eventData.type;
      document.getElementById("custom-event-type-container").style.display =
        "block";
    }

    document.getElementById("event-location").value = eventData.location || "";
    document.getElementById("event-desc").value = eventData.description || "";
  } else {
    
    currentEditEventId = null;
    document.getElementById("event-title").value = "";
    document.getElementById("event-from-date").value = "";
    document.getElementById("event-to-date").value = "";

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const minDateTime = now.toISOString().slice(0, 16);

    document.getElementById("event-from-date").min = minDateTime;
    document.getElementById("event-to-date").min = minDateTime;

    document.getElementById("calendar-event-type").value = "Event";
    document.getElementById("custom-event-type-container").style.display =
      "none";
    document.getElementById("custom-event-type-input").value = "";
    document.getElementById("event-location").value = "";
    document.getElementById("event-desc").value = "";
  }

  modal.classList.add("active");
}

function closeCalendarModal() {
  currentEditEventId = null;
  document.getElementById("calendar-event-modal").classList.remove("active");
}

async function saveCalendarEvent() {
  const title = document.getElementById("event-title").value;
  const fromDate = document.getElementById("event-from-date").value;
  const toDate = document.getElementById("event-to-date").value;
  let type = document.getElementById("calendar-event-type").value;
  const location = document.getElementById("event-location").value;
  const desc = document.getElementById("event-desc").value;

  if (type === "Custom") {
    const customType = document
      .getElementById("custom-event-type-input")
      .value.trim();
    if (!customType) {
      await CustomDialog.alert("Please enter a custom event type name.", "Validation Error", "warning");
      return;
    }
    type = customType;
  }

  if (!title || !fromDate || !toDate) {
    await CustomDialog.alert("Please provide title, from date (and) to date.", "Validation Error", "warning");
    return;
  }

  if (new Date(toDate) < new Date(fromDate)) {
    await CustomDialog.alert("To Date cannot be before From Date.", "Validation Error", "warning");
    return;
  }

  try {
    const isEdit = currentEditEventId !== null;
    const url = isEdit
      ? `${API_URL}/admin/calendar/${currentEditEventId}`
      : `${API_URL}/admin/calendar`;
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        title,
        from_date: fromDate,
        to_date: toDate,
        type,
        location,
        description: desc,
      }),
    });

    if (res.ok) {
      closeCalendarModal();
      loadAcademicCalendar();
      showStatusPopup(
        isEdit ? "Event updated successfully!" : "Event added successfully!",
      );
    } else {
      const data = await res.json();
      await CustomDialog.alert(`Failed to save event: ${data.detail || res.statusText}`, "Save Error", "error");
    }
  } catch (e) {
    console.error(e);
    await CustomDialog.alert("Error saving event", "System Error", "error");
  }
}

async function editCalendarEvent(eventId) {
  
  const event = window.allCalendarEvents.find((e) => e.id === eventId);
  if (event) {
    openCalendarModal(event);
  } else {
    await CustomDialog.alert("Event not found", "Error", "error");
  }
}
window.editCalendarEvent = editCalendarEvent;

async function loadCalendarAdmin() {
  
  await loadAcademicCalendar();
}

window.loadCalendarAdmin = loadCalendarAdmin;

async function loadAcademicCalendar() {
  const tableBody = document.getElementById("calendar-admin-table-body");
  if (!tableBody) return;

  tableBody.innerHTML =
    '<tr><td colspan="4" style="text-align: center; padding: 20px;">Loading events...</td></tr>';

  try {
    const res = await fetch(`${API_URL}/admin/calendar`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      const events = await res.json();
      window.allCalendarEvents = events;
      window.allAdminEvents = events; 
      renderCalendarAdminTable(events);
      return events; 
    } else {
      tableBody.innerHTML =
        '<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load events.</td></tr>';
    }
  } catch (e) {
    console.error(e);
    tableBody.innerHTML =
      '<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Connection error.</td></tr>';
  }
}
window.loadAcademicCalendar = loadAcademicCalendar;

function getEventTypeBadge(type) {
  const typeMap = {
    Exam: "error", 
    Holiday: "success", 
    Event: "info", 
  };
  return typeMap[type] || "info";
}

async function deleteCalendarEvent(eventId) {
  if (!(await CustomDialog.confirm("Are you sure you want to delete this event?", "Delete Event", "warning"))) return;

  try {
    const res = await fetch(`${API_URL}/admin/calendar/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("Event deleted successfully");
      loadAcademicCalendar(); 
      loadCalendar(); 
    } else {
      const data = await res.json();
      showStatusPopup(data.detail || "Failed to delete event", "error");
    }
  } catch (e) {
    console.error(e);
    showStatusPopup("Connection error", "error");
  }
}
window.deleteCalendarEvent = deleteCalendarEvent;
