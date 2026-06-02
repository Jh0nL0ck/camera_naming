const state = {
  sessionId: null,
  cameras: [],
  selected: new Set(),
  preview: new Map(),
  validation: new Map(),
  validationLevel: ""
};

const els = {
  form: document.querySelector("#connectForm"),
  probeButton: document.querySelector("#probeButton"),
  status: document.querySelector("#status"),
  routeInfo: document.querySelector("#routeInfo"),
  loadCameras: document.querySelector("#loadCameras"),
  cameraRows: document.querySelector("#cameraRows"),
  filter: document.querySelector("#filter"),
  pattern: document.querySelector("#pattern"),
  prefix: document.querySelector("#prefix"),
  startIndex: document.querySelector("#startIndex"),
  selectVisible: document.querySelector("#selectVisible"),
  clearSelection: document.querySelector("#clearSelection"),
  preview: document.querySelector("#preview"),
  confirmApply: document.querySelector("#confirmApply"),
  apply: document.querySelector("#apply"),
  selectionCount: document.querySelector("#selectionCount"),
  widePattern: document.querySelector("#widePattern"),
  widePreview: document.querySelector("#widePreview"),
  helpButton: document.querySelector("#helpButton"),
  helpBox: document.querySelector("#helpBox"),
  sampleOldName: document.querySelector("#sampleOldName"),
  sampleId: document.querySelector("#sampleId"),
  sampleCount: document.querySelector("#sampleCount"),
  preset: document.querySelector("#preset"),
  separator: document.querySelector("#separator"),
  validationSummary: document.querySelector("#validationSummary"),
  site: document.querySelector("#site"),
  building: document.querySelector("#building"),
  floor: document.querySelector("#floor"),
  zone: document.querySelector("#zone")
};

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`.trim();
}

function setRouteInfo(info) {
  els.routeInfo.textContent = info || "";
}

function formPayload() {
  const data = new FormData(els.form);
  return {
    server: data.get("server"),
    username: data.get("username"),
    password: data.get("password"),
    clientId: data.get("clientId") || "GrantValidatorClient",
    authMode: data.get("authMode") || "password",
    allowInsecure: Boolean(data.get("allowInsecure"))
  };
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {})
  };
  if (state.sessionId) {
    headers["x-session-id"] = state.sessionId;
  }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.details = data;
    throw error;
  }
  return data;
}

function showError(error) {
  setStatus(error.message, "bad");
  if (error.details) {
    const details = [];
    if (error.details.status) details.push(`HTTP ${error.details.status}`);
    if (error.details.authMode) details.push(`Auth: ${error.details.authMode}`);
    if (error.details.tokenEndpoint) details.push(`IDP: ${error.details.tokenEndpoint}`);
    if (error.details.response) details.push(`Response: ${JSON.stringify(error.details.response)}`);
    if (error.details.raw && !error.details.response) details.push(`Response: ${error.details.raw}`);
    setRouteInfo(details.join(" | "));
  }
}

function summarizeProbe(data) {
  const ok = data.ok ? "OK" : "Not found";
  const routes = [data.tokenEndpoint, data.apiRoot].filter(Boolean).join(" | ");
  const attempts = Array.isArray(data.results) ? `${data.results.length} checks` : "";
  return `${ok}. ${routes} ${attempts}`.trim();
}

els.probeButton.addEventListener("click", async () => {
  try {
    setStatus("Detecting Gateway routes...");
    const payload = formPayload();
    const data = await api("/api/probe", {
      method: "POST",
      body: JSON.stringify({ server: payload.server, allowInsecure: payload.allowInsecure })
    });
    setStatus(data.message || "Route detection completed.", data.ok ? "ok" : "bad");
    setRouteInfo(summarizeProbe(data));
  } catch (error) {
    showError(error);
  }
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("Connecting and requesting token...");
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(formPayload())
    });
    state.sessionId = data.sessionId;
    setStatus(`Connected. Token valid for ${data.expiresIn || "?"} seconds.`, "ok");
    setRouteInfo(`IDP: ${data.tokenEndpoint} | API: ${data.apiRoot}`);
  } catch (error) {
    showError(error);
  }
});

els.loadCameras.addEventListener("click", async () => {
  try {
    setStatus("Reading cameras...");
    const data = await api("/api/cameras");
    state.cameras = data.cameras || [];
    state.selected.clear();
    state.preview.clear();
    render();
    setStatus(`${state.cameras.length} cameras loaded.`, "ok");
  } catch (error) {
    showError(error);
  }
});

els.filter.addEventListener("input", render);
els.pattern.addEventListener("input", () => {
  if (els.widePattern.value !== els.pattern.value) {
    els.widePattern.value = els.pattern.value;
  }
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.widePattern.addEventListener("input", () => {
  if (els.pattern.value !== els.widePattern.value) {
    els.pattern.value = els.widePattern.value;
  }
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.prefix.addEventListener("input", () => {
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.startIndex.addEventListener("input", () => {
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.sampleOldName.addEventListener("input", renderWidePreview);
els.sampleId.addEventListener("input", renderWidePreview);
els.sampleCount.addEventListener("input", renderWidePreview);
els.site.addEventListener("input", () => {
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.building.addEventListener("input", () => {
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.floor.addEventListener("input", () => {
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.zone.addEventListener("input", () => {
  invalidateGeneratedPreview();
  renderWidePreview();
});
els.preset.addEventListener("change", () => {
  if (!els.preset.value) return;
  setPattern(els.preset.value);
});
els.separator.addEventListener("change", () => {
  const next = replaceSeparators(els.widePattern.value, els.separator.value);
  setPattern(next);
});
document.querySelectorAll("[data-token]").forEach((button) => {
  button.addEventListener("click", () => insertToken(button.dataset.token));
});
els.helpButton.addEventListener("click", () => {
  els.helpBox.hidden = !els.helpBox.hidden;
});

els.selectVisible.addEventListener("click", () => {
  visibleCameras().forEach((camera) => state.selected.add(camera.id));
  updateSelection();
  render();
});

els.clearSelection.addEventListener("click", () => {
  state.selected.clear();
  state.preview.clear();
  state.validation.clear();
  els.confirmApply.checked = false;
  updateSelection();
  render();
});

els.preview.addEventListener("click", () => {
  state.preview.clear();
  state.validation.clear();
  const start = Number(els.startIndex.value || 0);
  let offset = 0;
  state.cameras.forEach((camera) => {
    if (!state.selected.has(camera.id)) return;
    const nextName = renderPattern(camera, start + offset);
    state.preview.set(camera.id, nextName);
    offset += 1;
  });
  validatePreview();
  els.confirmApply.checked = false;
  updateSelection();
  render();
});

els.confirmApply.addEventListener("change", updateSelection);

els.apply.addEventListener("click", async () => {
  const changes = state.cameras
    .filter((camera) => state.selected.has(camera.id) && state.preview.has(camera.id))
    .map((camera) => ({
      ...camera,
      oldName: camera.name,
      newName: state.preview.get(camera.id)
    }));

  if (!changes.length) {
    setStatus("There are no previewed changes.", "bad");
    return;
  }
  validatePreview();
  if (state.validationLevel === "bad") {
    setStatus("Fix naming validation errors before applying changes.", "bad");
    updateSelection();
    render();
    return;
  }

  try {
    setStatus(`Applying ${changes.length} changes...`);
    const data = await api("/api/rename", {
      method: "POST",
      body: JSON.stringify({ changes })
    });
    const failed = (data.results || []).filter((item) => !item.ok);
    if (failed.length) {
      setStatus(`${failed.length} changes failed. Check permissions and the Gateway response.`, "bad");
    } else {
      setStatus(`${changes.length} cameras renamed.`, "ok");
      await els.loadCameras.click();
    }
  } catch (error) {
    showError(error);
  }
});

function renderPattern(camera, index) {
  const pattern = els.pattern.value || "{prefix}-{index:000}";
  return renderPatternText(pattern, camera, index);
}

function renderPatternText(pattern, camera, index) {
  return pattern.replace(/\{([^}:]+)(?::([^}]+))?\}/g, (_, key, format) => {
    const values = {
      site: els.site.value || "",
      building: els.building.value || "",
      floor: els.floor.value || "",
      zone: els.zone.value || "",
      prefix: els.prefix.value || "",
      index,
      oldName: camera.name || "",
      id: camera.id || ""
    };
    const value = values[key] ?? "";
    if (key === "index" && /^0+$/.test(format || "")) {
      return String(value).padStart(format.length, "0");
    }
    return String(value);
  });
}

function setPattern(value) {
  els.pattern.value = value;
  els.widePattern.value = value;
  els.preset.value = "";
  invalidateGeneratedPreview();
  renderWidePreview();
  render();
}

function invalidateGeneratedPreview() {
  state.preview.clear();
  state.validation.clear();
  state.validationLevel = "";
  els.confirmApply.checked = false;
  els.validationSummary.textContent = "Pattern changed. Generate a new preview before applying changes.";
  els.validationSummary.className = "validation-summary warn";
  updateSelection();
}

function replaceSeparators(pattern, separator) {
  return pattern.replace(/[-_ ]+(?=\{)/g, separator).replace(/(\})([-_ ]+)(?=\{)/g, `$1${separator}`);
}

function insertToken(token) {
  const textarea = els.widePattern;
  const current = textarea.value;
  const separator = els.separator.value;
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const needsLeftSeparator = before && !/[-_ \n]$/.test(before);
  const needsRightSeparator = after && !/^[-_ \n]/.test(after);
  const insertion = `${needsLeftSeparator ? separator : ""}${token}${needsRightSeparator ? separator : ""}`;
  setPattern(`${before}${insertion}${after}`);
  const nextPosition = before.length + insertion.length;
  textarea.focus();
  textarea.setSelectionRange(nextPosition, nextPosition);
}

function renderWidePreview() {
  const count = Math.max(1, Math.min(12, Number(els.sampleCount.value || 1)));
  const start = Number(els.startIndex.value || 0);
  const sample = {
    name: els.sampleOldName.value || "Camera",
    id: els.sampleId.value || "camera-id"
  };

  els.widePreview.innerHTML = Array.from({ length: count }, (_, offset) => {
    const value = renderPatternText(els.widePattern.value || "{prefix}-{index:000}", sample, start + offset);
    return `<div class="preview-chip">${escapeHtml(value)}</div>`;
  }).join("");
}

function validatePreview() {
  state.validation.clear();
  const selectedChanges = state.cameras
    .filter((camera) => state.selected.has(camera.id) && state.preview.has(camera.id))
    .map((camera) => ({
      id: camera.id,
      currentName: camera.name || "",
      newName: state.preview.get(camera.id) || ""
    }));

  if (!selectedChanges.length) {
    state.validationLevel = "";
    els.validationSummary.textContent = "No previewed changes yet.";
    els.validationSummary.className = "validation-summary";
    return;
  }

  const messages = [];
  const byName = new Map();
  selectedChanges.forEach((change) => {
    const normalized = normalizeName(change.newName);
    if (!normalized) {
      addValidation(change.id, "error", "Empty name");
      messages.push("One or more generated names are empty.");
      return;
    }
    if (!byName.has(normalized)) byName.set(normalized, []);
    byName.get(normalized).push(change.id);
  });

  byName.forEach((ids, name) => {
    if (ids.length > 1) {
      ids.forEach((id) => addValidation(id, "error", "Duplicate in selection"));
      messages.push(`Duplicate generated name: "${name}" (${ids.length} cameras).`);
    }
  });

  const selectedIds = new Set(selectedChanges.map((change) => change.id));
  const existingNames = new Map();
  state.cameras.forEach((camera) => {
    if (selectedIds.has(camera.id)) return;
    const normalized = normalizeName(camera.name);
    if (normalized) existingNames.set(normalized, camera.name);
  });

  selectedChanges.forEach((change) => {
    const normalized = normalizeName(change.newName);
    if (normalized && existingNames.has(normalized)) {
      addValidation(change.id, "warning", "Matches an existing camera name");
      messages.push(`Generated name already exists outside selection: "${existingNames.get(normalized)}".`);
    }
    if (change.newName.length > 80) {
      addValidation(change.id, "warning", "Long name");
      messages.push(`One or more generated names are longer than 80 characters.`);
    }
  });

  const hasErrors = [...state.validation.values()].some((item) => item.level === "error");
  const hasWarnings = [...state.validation.values()].some((item) => item.level === "warning");
  state.validationLevel = hasErrors ? "bad" : hasWarnings ? "warn" : "ok";

  if (state.validationLevel === "ok") {
    els.validationSummary.textContent = `${selectedChanges.length} generated names look valid. No duplicates found.`;
  } else {
    const uniqueMessages = [...new Set(messages)];
    els.validationSummary.textContent = uniqueMessages.join(" ");
  }
  els.validationSummary.className = `validation-summary ${state.validationLevel}`;
}

function addValidation(id, level, message) {
  const current = state.validation.get(id);
  if (!current || current.level !== "error") {
    state.validation.set(id, { level, messages: [] });
  }
  state.validation.get(id).messages.push(message);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function visibleCameras() {
  const term = els.filter.value.trim().toLowerCase();
  if (!term) return state.cameras;
  return state.cameras.filter((camera) => {
    return `${camera.name} ${camera.id}`.toLowerCase().includes(term);
  });
}

function render() {
  const rows = visibleCameras();
  if (!rows.length) {
    els.cameraRows.innerHTML = `<tr><td class="empty" colspan="5">No cameras to display.</td></tr>`;
    updateSelection();
    return;
  }

  els.cameraRows.innerHTML = rows
    .map((camera) => {
      const checked = state.selected.has(camera.id) ? "checked" : "";
      const newName = state.preview.get(camera.id) || "";
      const enabled = camera.enabled === null ? "?" : camera.enabled ? "Enabled" : "Disabled";
      const validation = state.validation.get(camera.id);
      const rowClass = validation?.level === "error" ? "row-error" : validation?.level === "warning" ? "row-warning" : "";
      const title = validation ? ` title="${escapeHtml(validation.messages.join(", "))}"` : "";
      return `
        <tr class="${rowClass}"${title}>
          <td><input type="checkbox" data-id="${escapeHtml(camera.id)}" ${checked}></td>
          <td>${escapeHtml(camera.name || "(unnamed)")}</td>
          <td class="new-name">${escapeHtml(newName)}</td>
          <td class="id">${escapeHtml(camera.id)}</td>
          <td>${escapeHtml(enabled)}</td>
        </tr>
      `;
    })
    .join("");

  els.cameraRows.querySelectorAll("input[type='checkbox']").forEach((box) => {
    box.addEventListener("change", () => {
      if (box.checked) state.selected.add(box.dataset.id);
      else {
        state.selected.delete(box.dataset.id);
        state.preview.delete(box.dataset.id);
        state.validation.delete(box.dataset.id);
      }
      validatePreview();
      updateSelection();
      render();
    });
  });
  updateSelection();
}

function updateSelection() {
  const selected = state.selected.size;
  const ready = [...state.selected].filter((id) => state.preview.has(id)).length;
  els.selectionCount.textContent = `${selected} selected, ${ready} previewed`;
  els.apply.disabled = !(ready > 0 && els.confirmApply.checked && state.validationLevel !== "bad");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

render();
renderWidePreview();
