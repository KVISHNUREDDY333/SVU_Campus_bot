async function loadCareerCenter() {
  
  const makerIds = [
    "maker-fullname", "maker-email", "maker-phone", "maker-linkedin",
    "maker-qualification", "maker-percentage", "maker-role",
    "maker-skills-tech", "maker-skills-coding", "maker-skills-soft"
  ];
  makerIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}
window.loadCareerCenter = loadCareerCenter;

function switchCareerTab(tab) {
  const checkerTab = document.getElementById("tab-resume-checker");
  const makerTab = document.getElementById("tab-resume-maker");
  const checkerView = document.getElementById("resume-checker-view");
  const makerView = document.getElementById("resume-maker-view");

  if (tab === "checker") {
    checkerTab.classList.add("active");
    makerTab.classList.remove("active");
    checkerView.classList.remove("hidden");
    checkerView.style.display = "block";
    makerView.classList.add("hidden");
    makerView.style.display = "none";
  } else {
    checkerTab.classList.remove("active");
    makerTab.classList.add("active");
    makerView.classList.remove("hidden");
    makerView.style.display = "block";
    checkerView.classList.add("hidden");
    checkerView.style.display = "none";
  }
}
window.switchCareerTab = switchCareerTab;

let currentGeneratedResume = "";
let currentAnalysisResult = "";

async function downloadAnalysis(format) {
  if (!currentAnalysisResult) {
    await CustomDialog.alert("Please analyze a resume first.", "Incomplete Action", "info");
    return;
  }

  const btn = document.getElementById(`btn-analysis-download-${format}`);
  const originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
  btn.disabled = true;

  try {
    const response = await fetch(`${API_URL}/career/download-resume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        resume_text: currentAnalysisResult,
        format: format,
      }),
    });

    if (!response.ok) throw new Error("Download failed");

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume_analysis.${format === "pdf" ? "pdf" : "docx"}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (e) {
    console.error("Download Error:", e);
    await CustomDialog.alert("Failed to download analysis. Please try again.", "Download Error", "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
window.downloadAnalysis = downloadAnalysis;

async function downloadResume(format) {
  if (!currentGeneratedResume) {
    await CustomDialog.alert("Please generate a resume first.", "Incomplete Action", "info");
    return;
  }

  const btn = document.getElementById(`btn-download-${format}`);
  const originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading...`;
  btn.disabled = true;

  try {
    const response = await fetch(`${API_URL}/career/download-resume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        resume_text: currentGeneratedResume,
        format: format,
      }),
    });

    if (!response.ok) throw new Error("Download failed");

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume.${format === "pdf" ? "pdf" : "docx"}`; 
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (e) {
    console.error("Download Error:", e);
    await CustomDialog.alert("Failed to download resume. Please try again.", "Download Error", "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
window.downloadResume = downloadResume;

async function generateResume() {
  
  const fullName = document.getElementById("maker-fullname").value.trim();
  const email = document.getElementById("maker-email").value.trim();
  const phone = document.getElementById("maker-phone").value.trim();
  const linkedin = document.getElementById("maker-linkedin").value.trim();
  const qualification = document
    .getElementById("maker-qualification")
    .value.trim();
  const percentage = document.getElementById("maker-percentage").value.trim();
  const role = document.getElementById("maker-role").value.trim();
  const level = document.getElementById("maker-level").value;
  const skillsTech = document.getElementById("maker-skills-tech").value.trim();
  const skillsCoding = document
    .getElementById("maker-skills-coding")
    .value.trim();
  const skillsSoft = document.getElementById("maker-skills-soft").value.trim();
  const research = document.getElementById("maker-research").value.trim();
  const experience = document.getElementById("maker-experience").value.trim();
  const projects = document.getElementById("maker-projects").value.trim();

  const feedbackEl = document.getElementById("resume-generation-feedback");

  if (!fullName || !email || !qualification || !role || !skillsTech) {
    await CustomDialog.alert("Please fill in all required fields (Name, Email, Qualification, Role, Technical Skills).", "Validation Error", "warning");
    return;
  }

  feedbackEl.classList.remove("hidden");
  feedbackEl.innerHTML =
    '<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Generating Professional Resume...</div>';

  try {
    const res = await fetch(`${API_URL}/career/generate-resume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
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
        industry_experience: experience,
        projects: projects,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Generation failed");
    }

    const data = await res.json();
    currentGeneratedResume = data.resume; 
    feedbackEl.innerHTML = `<div class="markdown-body">${marked.parse(data.resume)}</div>`;

    const actionsDiv = document.createElement("div");
    actionsDiv.style.marginTop = "20px";
    actionsDiv.style.display = "flex";
    actionsDiv.style.gap = "10px";
    actionsDiv.style.flexWrap = "wrap";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-secondary";
    copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Text';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(data.resume);
      showStatusPopup("Resume Copied to Clipboard!");
    };

    const pdfBtn = document.createElement("button");
    pdfBtn.id = "btn-download-pdf";
    pdfBtn.className = "btn-primary";
    pdfBtn.style.background = "#ef4444"; 
    pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
    pdfBtn.onclick = () => downloadResume("pdf");

    const docxBtn = document.createElement("button");
    docxBtn.id = "btn-download-docx";
    docxBtn.className = "btn-primary";
    docxBtn.style.background = "#2563eb"; 
    docxBtn.innerHTML = '<i class="fa-solid fa-file-word"></i> Download Word';
    docxBtn.onclick = () => downloadResume("docx");

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

let currentCheckerMode = "text"; 

function setCheckerMode(mode) {
  currentCheckerMode = mode;
  const textBtn = document.getElementById("mode-text-btn");
  const pdfBtn = document.getElementById("mode-pdf-btn");
  const textArea = document.getElementById("checker-text-area");
  const pdfArea = document.getElementById("checker-pdf-area");

  if (mode === "text") {
    textBtn?.classList.add("active");
    pdfBtn?.classList.remove("active");
    textArea?.classList.remove("hidden");
    pdfArea?.classList.add("hidden");
  } else {
    pdfBtn?.classList.add("active");
    textBtn?.classList.remove("active");
    pdfArea?.classList.remove("hidden");
    textArea?.classList.add("hidden");
  }
}
window.setCheckerMode = setCheckerMode;

function handleResumeFileChange(input) {
  const file = input.files[0];
  const nameEl = document.getElementById("selected-file-name");
  if (file) {
    nameEl.innerText = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    nameEl.classList.remove("hidden");
  } else {
    nameEl.classList.add("hidden");
  }
}
window.handleResumeFileChange = handleResumeFileChange;

async function checkResume() {
  const targetRole = document.getElementById("resume-target-role")?.value.trim();
  const feedbackEl = document.getElementById("resume-feedback");
  
  if (!ACCESS_TOKEN || !feedbackEl) return;

  let url = `${API_URL}/career/check-resume`;
  let body;
  let headers = {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  };

  if (currentCheckerMode === "text") {
    const textInput = document.getElementById("resume-text-input");
    const text = textInput ? textInput.value.trim() : "";
    if (!text) {
      await CustomDialog.alert("Please paste your resume text.", "Missing Input", "warning");
      return;
    }
    body = JSON.stringify({ resume_text: text, target_role: targetRole || null });
    headers["Content-Type"] = "application/json";
  } else {
    const fileInput = document.getElementById("resume-file-input");
    const file = fileInput ? fileInput.files[0] : null;
    if (!file) {
      await CustomDialog.alert("Please upload a PDF resume.", "Missing Input", "warning");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    if (targetRole) formData.append("target_role", targetRole);
    
    url = `${API_URL}/career/check-resume-file`;
    body = formData;
  }

  feedbackEl.innerHTML = `<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing Resume ${currentCheckerMode === "pdf" ? "(Extracted from PDF)" : ""}...</div>`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: body,
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Analysis failed");
    }

    const data = await response.json();
    currentAnalysisResult = data.analysis;
    feedbackEl.innerHTML = `<div class="markdown-body">${marked.parse(data.analysis)}</div>`;

    const actionsDiv = document.createElement("div");
    actionsDiv.style.marginTop = "20px";
    actionsDiv.style.display = "flex";
    actionsDiv.style.gap = "10px";
    actionsDiv.style.flexWrap = "wrap";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-secondary";
    copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Analysis';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(data.analysis);
      showStatusPopup("Analysis Copied to Clipboard!");
    };

    const pdfBtn = document.createElement("button");
    pdfBtn.id = "btn-analysis-download-pdf";
    pdfBtn.className = "btn-primary";
    pdfBtn.style.background = "#ef4444"; 
    pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
    pdfBtn.onclick = () => downloadAnalysis("pdf");

    const docxBtn = document.createElement("button");
    docxBtn.id = "btn-analysis-download-docx";
    docxBtn.className = "btn-primary";
    docxBtn.style.background = "#2563eb"; 
    docxBtn.innerHTML = '<i class="fa-solid fa-file-word"></i> Download Word';
    docxBtn.onclick = () => downloadAnalysis("docx");

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(pdfBtn);
    actionsDiv.appendChild(docxBtn);
    feedbackEl.appendChild(actionsDiv);

  } catch (err) {
    console.error("Analysis Error:", err);
    feedbackEl.innerHTML = `<p style="color: #ef4444;">Error: ${err.message}</p>`;
  }
}
window.checkResume = checkResume;
