let currentTicketContext = { userQuery: "", botResponse: "" };

function openTicketModal(userQuery, botResponse) {
  currentTicketContext = { userQuery, botResponse };
  let modal = document.getElementById("ticket-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "ticket-modal";
    modal.className = "modal";
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

  const context = `Context (Auto-generated):\nUser asked: "${userQuery || ""}"\nBot replied: "${botResponse ? botResponse.substring(0, 100) + "..." : ""}"\n\nMy Issue:\n`;

  setTimeout(() => {
    const subjectEl = document.getElementById("ticket-subject");
    const descEl = document.getElementById("ticket-desc");

    if (subjectEl)
      subjectEl.value = userQuery
        ? userQuery.substring(0, 60) + (userQuery.length > 60 ? "..." : "")
        : "";
    if (descEl) {
      descEl.value = context;
      descEl.focus();
    }
  }, 50);

  modal.classList.add("active");
}

function closeTicketModal() {
  const modal = document.getElementById("ticket-modal");
  if (modal) {
    modal.classList.remove("active");
  }
}

async function submitTicket() {
  const subject = document.getElementById("ticket-subject").value;
  const desc = document.getElementById("ticket-desc").value;
  const cat = document.getElementById("ticket-cat").value;

  if (!subject || !desc) {
    await CustomDialog.alert("Please fill all fields.", "Validation Error", "warning");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        subject: subject,
        description: desc,
        category: cat,
      }),
    });

    if (res.ok) {
      closeTicketModal();
      await CustomDialog.alert("Ticket raised successfully! Support team will contact you.", "Ticket Raised", "success");
    } else {
      await CustomDialog.alert("Failed to raise ticket.", "Ticket Error", "error");
    }
  } catch (e) {
    console.error(e);
    await CustomDialog.alert("Error raising ticket.", "System Error", "error");
  }
}


async function loadAllTickets() {
  if (!ACCESS_TOKEN) return;
  try {
    const res = await fetch(`${API_URL}/admin/tickets?limit=50`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (!res.ok) return;
    const tickets = await res.json();
    
    window.allTickets = tickets;
    renderTicketsTable(tickets);
  } catch (e) {
    console.error("Load Tickets Error", e);
  }
}

function renderTicketsTable(tickets) {
  const tbody = document.getElementById("tickets-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (tickets.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align: center; padding: 20px;">No support tickets found.</td></tr>';
    return;
  }

  tickets.forEach((t) => {
    const badgeClass = t.status === "open" ? "warning" : "success";

    let deleteBtn = "";
    
    const currentRole = sessionStorage.getItem("user_role");
    if (t.status.toLowerCase() === "closed" && currentRole === "admin") {
      deleteBtn = `
                <button class="icon-btn" title="Delete Ticket" onclick="deleteTicket('${t.id}')" style="color: #ef4444;">
                    <i class="fa-solid fa-trash"></i>
                </button>
             `;
    }

    tbody.innerHTML += `
        <tr>
            <td class="no-ellipsis" style="padding: 16px; color: #64748b; font-size: 13px;">#${t.id.substring(t.id.length - 6)}</td>
            <td style="padding: 16px;" title="${escapeHtml(t.subject)}">${escapeHtml(t.subject)}</td>
            <td style="padding: 16px;" title="${escapeHtml(t.category)}">${escapeHtml(t.category)}</td>
            <td style="padding: 16px; font-weight: 600;" title="${escapeHtml(t.created_by)}">${escapeHtml(t.created_by)}</td>
            <td style="padding: 16px;"><span class="badge ${badgeClass}" style="cursor:pointer;" onclick="toggleTicketStatus('${t.id}', '${t.status}')">${t.status.toUpperCase()}</span></td>
            <td style="padding: 16px;">
                <div style="display: flex; gap: 12px; justify-content: flex-end; align-items: center;">
                  <button class="icon-btn" title="Reply / Resolve" onclick="openTicketResponseModal('${t.id}', '${escapeHtml(t.subject)}')" style="color: #6366f1;">
                      <i class="fa-solid fa-reply"></i>
                  </button>
                  <button class="icon-btn" title="View Details" onclick="viewTicketDetails('${t.id}')" style="color: #64748b;">
                      <i class="fa-solid fa-eye"></i>
                  </button>
                  ${deleteBtn}
                </div>
            </td>
        </tr>`;
  });

}

async function toggleTicketStatus(id, currentStatus) {
  const newStatus = currentStatus === "open" ? "closed" : "open";
  if (!(await CustomDialog.confirm(`Mark ticket as ${newStatus.toUpperCase()}?`, "Update Status", "info"))) return;

  try {
    const res = await fetch(`${API_URL}/admin/tickets/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        status: newStatus,
        resolution: "Status updated by Admin",
      }),
    });
    if (res.ok) loadAllTickets();
  } catch (e) {
    console.error(e);
  }
}

async function deleteTicket(id) {
  if (!(await CustomDialog.confirm("Are you sure you want to delete this ticket permanently?", "Delete Ticket", "error")))
    return;

  try {
    const res = await fetch(`${API_URL}/tickets/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("Ticket deleted.");
      loadAllTickets();
    } else {
      const data = await res.json();
      await CustomDialog.alert(data.detail || "Failed to delete ticket.", "Delete Failed", "error");
    }
  } catch (e) {
    console.error(e);
    await CustomDialog.alert("Error deleting ticket.", "System Error", "error");
  }
}

async function deleteAllClosedTickets() {
  if (
    !(await CustomDialog.confirm(
      "Are you sure you want to delete ALL closed tickets permanently? This action cannot be undone.",
      "Bulk Delete Tickets",
      "error",
    ))
  )
    return;

  try {
    const res = await fetch(`${API_URL}/admin/tickets/delete/closed`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const data = await res.json();
    if (res.ok) {
      showStatusPopup(data.message || "All closed tickets deleted.");
      loadAllTickets();
    } else {
      await CustomDialog.alert(data.detail || "Failed to delete closed tickets.", "Action Failed", "error");
    }
  } catch (e) {
    console.error(e);
    await CustomDialog.alert("Error during bulk deletion.", "System Error", "error");
  }
}

function viewTicketDetails(id) {
  const modal = document.getElementById("ticket-view-modal");
  if (!modal) return;

  const ticket = window.allTickets
    ? window.allTickets.find((t) => t.id === id)
    : null;
  if (!ticket) {
    console.error("Ticket not found in memory:", id);
    return;
  }

  document.getElementById("view-ticket-id").textContent =
    "#" + ticket.id.substring(ticket.id.length - 6);
  document.getElementById("view-ticket-subject").textContent = ticket.subject;
  document.getElementById("view-ticket-desc").textContent = ticket.description;

  const resEl = document.getElementById("view-ticket-resolution");
  resEl.textContent = ticket.resolution || "Pending Review";
  resEl.style.background = ticket.resolution
    ? "rgba(16, 185, 129, 0.1)"
    : "var(--bg-secondary)";

  const statusEl = document.getElementById("view-ticket-status");
  statusEl.textContent = ticket.status.toUpperCase();
  statusEl.className = `badge ${ticket.status === "open" ? "warning" : "success"}`;

  modal.classList.add("active");
}

function closeTicketViewModal() {
  const modal = document.getElementById("ticket-view-modal");
  if (modal) modal.classList.remove("active");
}

function openTicketResponseModal(id, subject) {
  document.getElementById("ticket-response-modal").classList.add("active");
  document.getElementById("resp-ticket-id").value = id;
  document.getElementById("resp-ticket-subject").value = subject;
  document.getElementById("resp-ticket-answer").value = "";
}

function closeTicketResponseModal() {
  document.getElementById("ticket-response-modal").classList.remove("active");
}

async function submitTicketResponse() {
  const id = document.getElementById("resp-ticket-id").value;
  const resolution = document.getElementById("resp-ticket-answer").value.trim();
  const saveFaq = document.getElementById("resp-save-faq").checked;

  if (!resolution) {
    await CustomDialog.alert("Please provide a response.", "Feedback Required", "warning");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/tickets/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        status: "closed",
        resolution: resolution,
        save_as_faq: saveFaq,
      }),
    });

    if (res.ok) {
      closeTicketResponseModal();
      loadAllTickets();
      showStatusPopup("Response sent & Ticket closed!");
      if (saveFaq) {
        refreshAdminData(); 
      }
    } else {
      await CustomDialog.alert("Failed to submit response", "Submit Error", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

