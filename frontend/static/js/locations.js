let locationsData = [];

function renderLocations(data = locationsData) {
  const list = document.getElementById("locations-list");
  if (!list) return;

  list.innerHTML = "";
  const highlighter = document.createElement("div");
  highlighter.id = "locations-highlighter";
  highlighter.className = "locations-highlighter";
  list.appendChild(highlighter);

  const categories = [...new Set(data.map((item) => item.category))];
  categories.forEach((category) => {
    const header = document.createElement("h3");
    header.className = "locations-category-header";
    header.textContent = category;
    list.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "locations-category-grid";
    const categoryItems = data.filter((item) => item.category === category);
    categoryItems.forEach((loc, index) => {
      const item = document.createElement("div");
      item.className = "location-item";
      item.textContent = loc.name;
      item.style.animationDelay = `${index * 0.03}s`;
      item.onclick = (e) => {
        e.stopPropagation();
        window.open(`https://www.google.com/maps/search/?api=1&query=Sri+Venkateswara+University+${encodeURIComponent(loc.name)}`, "_blank");
      };
      item.onmouseenter = () => {
        const rect = item.getBoundingClientRect();
        highlighter.style.width = `${rect.width}px`;
        highlighter.style.height = `${rect.height}px`;
        highlighter.style.top = `${item.offsetTop}px`;
        highlighter.style.left = `${item.offsetLeft}px`;
        highlighter.style.opacity = "1";
      };
      grid.appendChild(item);
    });
    list.appendChild(grid);
  });
  list.onmouseleave = () => { highlighter.style.opacity = "0"; };
}

function filterLocations(query) {
  const term = query.toLowerCase();
  const filtered = term ? locationsData.filter(loc => loc.name.toLowerCase().includes(term) || loc.category.toLowerCase().includes(term)) : locationsData;
  renderLocations(filtered);
  if (term && filtered.length === 0) {
    const list = document.getElementById("locations-list");
    if (list) list.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No locations found for "${query}"</div>`;
  }
}

function askLocation(locationName) {
  showSection("chat");
  const input = document.getElementById("user-input");
  if (input) {
    input.value = `Where is ${locationName}?`;
    sendMessage();
  }
}

async function fetchLocations() {
  try {
    const res = await fetch(`${API_URL}/locations`, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    if (res.ok) {
      locationsData = await res.json();
      renderLocations();
      renderAdminLocationsTable();
    }
  } catch (e) {
    console.error("Fetch Locations Error", e);
  }
}

function renderAdminLocationsTable(data = locationsData) {
  const tbody = document.getElementById("locations-admin-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align: center; padding: 20px;">No locations found.</td></tr>';
    return;
  }

  data.forEach((loc) => {
    tbody.innerHTML += `
        <tr>
            <td style="padding: 16px; font-weight: 500;">${escapeHtml(loc.name)}</td>
            <td style="padding: 16px; font-weight: 800; font-size: 11px; color: #334155; text-transform: uppercase;">${escapeHtml(loc.category)}</td>
            <td style="padding: 16px; text-align: right;">
                <button class="icon-btn" onclick="openLocationModal('${loc.id}')" title="Edit" style="color: #64748b;">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="icon-btn" onclick="deleteLocation('${loc.id}')" style="color: #ef4444;" title="Delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
  });
}

function openLocationModal(locId = null) {
  const modal = document.getElementById("location-modal");
  const title = document.getElementById("location-modal-title");
  const nameInput = document.getElementById("location-name");
  const catSelect = document.getElementById("location-category");
  const descInput = document.getElementById("location-description");
  const idInput = document.getElementById("location-id");

  if (!modal) return;

  if (locId) {
    const loc = locationsData.find((l) => l.id === locId);
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

  modal.classList.add("active");
}

function closeLocationModal() {
  const modal = document.getElementById("location-modal");
  if (modal) modal.classList.remove("active");
}

async function saveLocation() {
  const id = document.getElementById("location-id").value;
  const name = document.getElementById("location-name").value.trim();
  const category = document.getElementById("location-category").value;
  const description = document
    .getElementById("location-description")
    .value.trim();

  if (!name || !category) {
    showStatusPopup("Please enter name and category", "warning");
    return;
  }

  const payload = { name, category, description };
  const method = id ? "PUT" : "POST";
  const url = id
    ? `${API_URL}/admin/locations/${id}`
    : `${API_URL}/admin/locations`;

  try {
    const res = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showStatusPopup(id ? "Location updated!" : "Location added!");
      closeLocationModal();
      fetchLocations();
    } else {
      const data = await res.json();
      showStatusPopup(data.detail || "Failed to save location", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

async function deleteLocation(id) {
  if (!(await CustomDialog.confirm("Delete this location?", "Delete Location", "warning"))) return;

  try {
    const res = await fetch(`${API_URL}/admin/locations/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (res.ok) {
      showStatusPopup("Location deleted");
      fetchLocations();
    } else {
      showStatusPopup("Failed to delete", "error");
    }
  } catch (e) {
    console.error(e);
  }
}

window.openLocationModal = openLocationModal;
window.closeLocationModal = closeLocationModal;
window.saveLocation = saveLocation;
window.deleteLocation = deleteLocation;

