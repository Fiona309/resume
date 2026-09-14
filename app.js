(() => {
  const LEGACY_STORAGE_KEY = "a4-resume-editor.feiwanyan.v3";
  const STORAGE_KEY = "a4-resume-editor.workspace.v1";
  const PHOTO_LIMIT = 3 * 1024 * 1024;
  const HISTORY_LIMIT = 30;
  const HISTORY_COALESCE_MS = 12000;
  const DISPLAY_TIME_ZONE = "Asia/Shanghai";
  const FONT_STACKS = {
    kaiti: '"Kaiti SC", STKaiti, KaiTi, "Songti SC", serif',
    songti: '"Songti SC", STSong, SimSun, serif',
    fangsong: 'FangSong, STFangsong, "Songti SC", serif',
    heiti: '"Heiti SC", STHeiti, SimHei, sans-serif',
    pingfang: '"PingFang SC", "Hiragino Sans GB", sans-serif'
  };
  const WORD_FONTS = { kaiti: "KaiTi", songti: "SimSun", fangsong: "FangSong", heiti: "SimHei", pingfang: "Microsoft YaHei" };
  const MARKER_OPTIONS = [
    ["decimal", "1. 2. 3."], ["circled", "① ② ③"], ["arrow", "➤ 小箭头"],
    ["triangle", "➢ 空心箭头"], ["bullet", "• 圆点"], ["check", "✓ 对勾"], ["none", "无符号"]
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[ch]);

  let workspace = loadWorkspace();
  let state = activeVersion().data;
  let saveTimer = null;
  let pendingHistoryLabel = "内容编辑";
  let modalAction = null;
  let drag = null;
  let photoDragMode = "frame";
  let selectedListPath = null;
  let convertedDocument = null;

  function normalizeResume(candidate) {
    const source = candidate || {};
    return {
      ...clone(window.INITIAL_RESUME), ...source,
      appearance: {
        ...clone(window.INITIAL_RESUME.appearance), ...(source.appearance || {}),
        markers: { ...window.INITIAL_RESUME.appearance.markers, ...(source.appearance?.markers || {}) },
        itemMarkers: { ...(source.appearance?.itemMarkers || {}) }
      },
      customSections: source.customSections || [], rich: source.rich || {}
    };
  }

  function normalizeVersion(item) {
    return { ...item, history: Array.isArray(item.history) ? item.history.slice(0, HISTORY_LIMIT) : [], data: normalizeResume(item.data) };
  }

  function loadWorkspace() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const versions = (parsed.versions || []).map(normalizeVersion);
        if (versions.length) return { ...parsed, activeId: versions.some(item => item.id === parsed.activeId) ? parsed.activeId : versions[0].id, versions };
      }
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      const data = legacy ? normalizeResume(JSON.parse(legacy)) : normalizeResume(window.INITIAL_RESUME);
      return { activeId: "master", versions: [{ id: "master", name: "母版简历", company: "", role: "", jd: "", isMaster: true, createdAt: new Date().toISOString(), history: [], data }] };
    } catch {
      return { activeId: "master", versions: [{ id: "master", name: "母版简历", company: "", role: "", jd: "", isMaster: true, createdAt: new Date().toISOString(), history: [], data: normalizeResume(window.INITIAL_RESUME) }] };
    }
  }

  function activeVersion() {
    return workspace.versions.find(item => item.id === workspace.activeId) || workspace.versions[0];
  }

  function setActiveState(nextState) {
    state = normalizeResume(nextState);
    activeVersion().data = state;
  }

  function historyPayload() {
    const data = clone(state);
    if (data.photo) data.photo.src = "";
    const current = activeVersion();
    return { data, name: current.name, company: current.company, role: current.role, jd: current.jd };
  }

  function recordHistory(label) {
    const current = activeVersion();
    current.history ||= [];
    const payload = historyPayload();
    const fingerprint = JSON.stringify(payload);
    const latest = current.history[0];
    if (latest?.fingerprint === fingerprint) return;
    const now = new Date();
    const entry = { id: `snapshot-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`, savedAt: now.toISOString(), label, fingerprint, ...payload };
    if (latest && latest.label === label && now - new Date(latest.savedAt) < HISTORY_COALESCE_MS) current.history[0] = entry;
    else current.history.unshift(entry);
    current.history = current.history.slice(0, HISTORY_LIMIT);
  }

  function persist(options = {}) {
    try {
      activeVersion().data = state;
      activeVersion().updatedAt = new Date().toISOString();
      if (options.recordHistory) recordHistory(options.label || pendingHistoryLabel);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
      $("#saveState").innerHTML = "<i></i> 已保存到本机";
      renderHistoryUI();
    } catch {
      $("#saveState").textContent = "本机存储空间不足";
    }
  }

  function scheduleSave(label = "内容编辑") {
    pendingHistoryLabel = label;
    $("#saveState").textContent = "正在保存…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist({ recordHistory: true, label: pendingHistoryLabel }), 420);
  }

  function editable(text, path, className = "") {
    const content = state.rich?.[path] || escapeHtml(text);
    return `<span class="edit-cell ${className}" contenteditable="true" spellcheck="false" data-path="${path}">${content}</span>`;
  }

  function richLead(text) {
    const value = String(text ?? "");
    const splitAt = value.indexOf("：");
    if (splitAt < 1 || splitAt > 18) return escapeHtml(value);
    return `<strong>${escapeHtml(value.slice(0, splitAt + 1))}</strong>${escapeHtml(value.slice(splitAt + 1))}`;
  }

  function markerText(index, style) {
    const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
    return ({ decimal: `${index + 1}.`, circled: circled[index] || `${index + 1}.`, arrow: "➤", triangle: "➢", bullet: "•", check: "✓", none: "" })[style] ?? `${index + 1}.`;
  }

  function markerStyleFor(path, fallback) {
    return state.appearance?.itemMarkers?.[path] || fallback;
  }

  function listItem(text, path, index, markerStyle) {
    const content = state.rich?.[path] || richLead(text);
    const resolved = markerStyleFor(path, markerStyle);
    return `<li data-list-path="${path}"><span class="list-marker" aria-hidden="true">${markerText(index, resolved)}</span><span class="edit-cell list-content" contenteditable="true" spellcheck="false" data-path="${path}">${content}</span><button class="row-delete" type="button" data-delete-row="${path}" title="删除整行" aria-label="删除这一整行">×</button></li>`;
  }

  function renderVersionUI() {
    const current = activeVersion();
    $("#currentVersionTitle").textContent = current.name || "未命名版本";
    $("#versionKind").textContent = current.isMaster ? "母版" : "岗位版";
    $("#versionKind").classList.toggle("job", !current.isMaster);
    $("#versionNameInput").value = current.name || "";
    $("#companyInput").value = current.company || "";
    $("#roleInput").value = current.role || "";
    $("#jdInput").value = current.jd || "";
    $("#jdCount").textContent = `${(current.jd || "").length} 字`;
    $("#deleteVersionBtn").disabled = Boolean(current.isMaster);
    $("#versionList").innerHTML = workspace.versions.map(item => {
      const meta = item.isMaster ? "完整经历库" : [item.company, item.role].filter(Boolean).join(" · ") || "待填写公司与岗位";
      return `<button class="version-item ${item.id === current.id ? "active" : ""}" type="button" data-version-id="${escapeHtml(item.id)}">
        <span class="version-symbol">${item.isMaster ? "母" : String(workspace.versions.filter(version => !version.isMaster).indexOf(item) + 1).padStart(2, "0")}</span>
        <span><strong>${escapeHtml(item.name || "未命名版本")}</strong><small>${escapeHtml(meta)}</small></span>
      </button>`;
    }).join("");
    $$('[data-version-id]').forEach(button => button.addEventListener("click", () => switchVersion(button.dataset.versionId)));
    renderHistoryUI();
  }

  function formatHistoryTime(value) {
    const date = new Date(value);
    const today = new Date();
    const dateLabel = date.toLocaleDateString("zh-CN", { timeZone: DISPLAY_TIME_ZONE, month: "numeric", day: "numeric" });
    const todayLabel = today.toLocaleDateString("zh-CN", { timeZone: DISPLAY_TIME_ZONE, month: "numeric", day: "numeric" });
    const timeLabel = date.toLocaleTimeString("zh-CN", { timeZone: DISPLAY_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    return `${dateLabel === todayLabel ? "今天" : dateLabel} ${timeLabel}`;
  }

  function renderHistoryUI() {
    const list = $("#historyList");
    if (!list) return;
    const history = activeVersion().history || [];
    $("#historyCount").textContent = history.length;
    list.innerHTML = history.length ? history.map((entry, index) => `<button class="history-item" type="button" data-history-id="${escapeHtml(entry.id)}">
      <strong>${escapeHtml(entry.label || "自动保存")}</strong><time datetime="${escapeHtml(entry.savedAt)}">${formatHistoryTime(entry.savedAt)}</time>
      <small>${index === 0 ? "最近保存" : `恢复后将替换当前版本内容 · 第 ${index + 1} 个快照`}</small>
    </button>`).join("") : `<div class="history-empty">还没有历史快照。开始编辑后会自动按时间保存。</div>`;
    $$('[data-history-id]', list).forEach(button => button.addEventListener("click", () => restoreHistory(button.dataset.historyId)));
  }

  function restoreHistory(id) {
    const current = activeVersion();
    const snapshot = (current.history || []).find(item => item.id === id);
    if (!snapshot) return;
    showModal("恢复这个历史版本？", `${formatHistoryTime(snapshot.savedAt)} · ${snapshot.label}。当前状态会先自动保留为一个快照。`, () => {
      recordHistory("恢复前状态");
      const photoSrc = state.photo?.src || window.INITIAL_RESUME.photo.src;
      state = normalizeResume(snapshot.data);
      state.photo.src = photoSrc;
      current.data = state;
      current.name = snapshot.name ?? current.name;
      current.company = snapshot.company ?? current.company;
      current.role = snapshot.role ?? current.role;
      current.jd = snapshot.jd ?? current.jd;
      selectedListPath = null;
      render();
      persist({ recordHistory: true, label: `已恢复 · ${formatHistoryTime(snapshot.savedAt)}` });
      setHistoryOpen(false);
    });
  }

  function setHistoryOpen(open) {
    $("#historyPopover").hidden = !open;
    $("#historyBtn").setAttribute("aria-expanded", String(open));
    if (open) renderHistoryUI();
  }

  function switchVersion(id) {
    if (id === workspace.activeId) return;
    activeVersion().data = state;
    workspace.activeId = id;
    state = activeVersion().data;
    render();
    persist();
    $(".stage").scrollTop = 0;
  }

  function createVersion(source = workspace.versions.find(item => item.isMaster)?.data || state, label = "新岗位版本") {
    const number = workspace.versions.filter(item => !item.isMaster).length + 1;
    const version = { id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${label} ${number}`, company: "", role: "", jd: "", isMaster: false, createdAt: new Date().toISOString(), history: [], data: clone(source) };
    activeVersion().data = state;
    workspace.versions.push(version);
    workspace.activeId = version.id;
    state = version.data;
    recordHistory("创建版本");
    render();
    persist();
    $("#versionNameInput").select();
  }

  function duplicateVersion() {
    const current = activeVersion();
    const version = { ...clone(current), id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${current.name} 副本`, isMaster: false, createdAt: new Date().toISOString(), history: [] };
    workspace.versions.push(version);
    workspace.activeId = version.id;
    state = version.data;
    recordHistory("复制版本");
    render();
    persist();
  }

  function deleteVersion() {
    const current = activeVersion();
    if (current.isMaster) return;
    showModal("删除这个岗位版本？", `“${current.name}”以及其中保存的 JD 和简历修改都会被删除。`, () => {
      workspace.versions = workspace.versions.filter(item => item.id !== current.id);
      workspace.activeId = workspace.versions.find(item => item.isMaster)?.id || workspace.versions[0].id;
      state = activeVersion().data;
      render();
      persist();
    });
  }

  function updateVersionMeta(key, value) {
    activeVersion()[key] = value;
    if (key === "jd") $("#jdCount").textContent = `${value.length} 字`;
    if (key === "name") {
      $("#currentVersionTitle").textContent = value || "未命名版本";
      $(".version-item.active strong").textContent = value || "未命名版本";
    }
    if (key === "company" || key === "role") {
      const current = activeVersion();
      $(".version-item.active small").textContent = [current.company, current.role].filter(Boolean).join(" · ") || "待填写公司与岗位";
    }
    scheduleSave(key === "jd" ? "编辑职位 JD" : "编辑版本信息");
  }

  function render() {
    renderVersionUI();
    const root = $("#resumeRoot");
    root.innerHTML = `
      <header class="resume-header" data-module="个人信息">
        ${editable(state.profile.name, "profile.name", "resume-name")}
        <div class="contact-line edit-cell" contenteditable="true" spellcheck="false" data-profile-line="contact">Tel:${escapeHtml(state.profile.phone)}｜邮箱：${escapeHtml(state.profile.email)}</div>
        ${editable(state.profile.homepage, "profile.homepage", "contact-line")}
        <div class="portrait" id="portrait" data-drag-mode="${photoDragMode}" title="${photoDragMode === "frame" ? "拖动整个照片框" : "拖动框内照片调整构图"}">
          <img id="portraitImage" src="${escapeHtml(state.photo.src)}" alt="证件照" />
          <span class="portrait-hint">拖动调整</span>
        </div>
      </header>
      ${section("教育经历", educationHtml(), "教育经历")}
      ${section("实习经历", entriesHtml(state.experience, "experience"), "实习经历")}
      ${section("项目经历", entriesHtml(state.projects, "projects", true), "项目经历")}
      ${(state.customSections || []).map((item, i) => customSectionHtml(item, i)).join("")}
      ${section("技能与优势", skillsHtml(), "技能与优势")}
    `;
    applyAppearance();
    applyPhotoTransform();
    bindEditableEvents();
    bindPortraitDrag();
    bindPaperActions();
    syncMarkerTargetUI();
    requestAnimationFrame(checkOverflow);
  }

  function section(title, content, module) {
    const addKey = ({ "教育经历":"education", "实习经历":"experience", "项目经历":"projects", "技能与优势":"skills" })[module];
    return `<section class="resume-section" data-module="${module}">${addKey ? `<button class="paper-add" type="button" data-add-row="${addKey}" title="在此模块新增一项">＋</button>` : ""}<div class="section-heading edit-cell">${title}</div>${content}</section>`;
  }

  function customSectionHtml(item, index) {
    const path = `customSections.${index}.title`;
    return `<section class="resume-section custom-section" data-module="${escapeHtml(item.title)}">
      <button class="paper-add" type="button" data-add-row="custom:${index}" title="新增一项">＋</button>
      <button class="paper-remove" type="button" data-remove-section="${index}" title="删除此板块">×</button>
      <div class="section-heading edit-cell" contenteditable="true" spellcheck="false" data-path="${path}">${state.rich?.[path] || escapeHtml(item.title)}</div>
      <ol class="entry-list custom-list">${item.items.map((text, i) => listItem(text, `customSections.${index}.items.${i}`, i, "arrow")).join("")}</ol>
    </section>`;
  }

  function educationHtml() {
    return `<div class="education-list">${state.education.map((item, i) => `
      <div class="education-item">
        ${editable(item.school, `education.${i}.school`, "school")}
        ${editable(item.major, `education.${i}.major`, "major")}
        ${editable(item.date, `education.${i}.date`, "date")}
        ${item.note ? editable(item.note, `education.${i}.note`, "education-note") : ""}
      </div>`).join("")}</div>`;
  }

  function entriesHtml(items, key, projects = false) {
    return items.map((item, i) => `
      <article class="entry ${projects ? "project-entry" : ""}">
        <div class="entry-header">
          ${editable(item.company, `${key}.${i}.company`, "company")}
          ${editable(item.team, `${key}.${i}.team`, "team")}
          ${editable(item.role, `${key}.${i}.role`, "role")}
          ${editable(item.date, `${key}.${i}.date`, "date")}
        </div>
        ${editable(item.summary, `${key}.${i}.summary`, "entry-summary")}
        <ol class="entry-list">${item.bullets.map((bullet, j) => listItem(bullet, `${key}.${i}.bullets.${j}`, j, state.appearance.markers[key])).join("")}</ol>
      </article>`).join("");
  }

  function skillsHtml() {
    return `<ol class="skills-list">${state.skills.map((item, i) => listItem(item, `skills.${i}`, i, state.appearance.markers.skills)).join("")}</ol>`;
  }

  function applyAppearance() {
    const appearance = {
      ...clone(window.INITIAL_RESUME.appearance), ...(state.appearance || {}),
      markers: { ...window.INITIAL_RESUME.appearance.markers, ...(state.appearance?.markers || {}) },
      itemMarkers: { ...(state.appearance?.itemMarkers || {}) }
    };
    state.appearance = appearance;
    const root = $("#resumeRoot");
    root.style.setProperty("--resume-font", FONT_STACKS[appearance.font] || FONT_STACKS.kaiti);
    root.style.setProperty("--body-size", `${appearance.fontSize}pt`);
    root.style.setProperty("--body-line", appearance.lineHeight);
    root.style.setProperty("--rule-width", `${appearance.ruleWidth}pt`);
    if ($("#fontSelect")) $("#fontSelect").value = appearance.font;
    syncNumberRange("fontSize", appearance.fontSize);
    if ($("#lineHeightRange")) $("#lineHeightRange").value = appearance.lineHeight;
    if ($("#lineHeightValue")) $("#lineHeightValue").textContent = Number(appearance.lineHeight).toFixed(2);
    syncNumberRange("ruleWidth", appearance.ruleWidth);
    if ($("#experienceMarker")) $("#experienceMarker").value = appearance.markers.experience;
    if ($("#projectMarker")) $("#projectMarker").value = appearance.markers.projects;
    if ($("#skillsMarker")) $("#skillsMarker").value = appearance.markers.skills;
    requestAnimationFrame(checkOverflow);
  }

  function syncNumberRange(prefix, value) {
    const range = $(`#${prefix}Range`);
    const number = $(`#${prefix}Number`);
    if (range) range.value = value;
    if (number) number.value = value;
  }

  function bindEditableEvents() {
    $$('[contenteditable="true"]').forEach(el => {
      el.addEventListener("focus", () => {
        if (el.classList.contains("list-content")) selectListParagraph(el.dataset.path);
      });
      el.addEventListener("click", () => {
        if (el.classList.contains("list-content")) selectListParagraph(el.dataset.path);
      });
      el.addEventListener("paste", event => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      });
      el.addEventListener("input", () => {
        if (el.dataset.profileLine === "contact") {
          const text = el.innerText.replace(/\n/g, " ");
          const match = text.match(/Tel[:：]\s*([^｜|]+)[｜|]\s*邮箱[:：]\s*(.*)/i);
          if (match) { state.profile.phone = match[1].trim(); state.profile.email = match[2].trim(); }
        } else if (el.dataset.path) {
          setByPath(state, el.dataset.path, el.innerText.replace(/\n+/g, " ").trim());
          state.rich ||= {};
          state.rich[el.dataset.path] = cleanRich(el.innerHTML);
        }
        const module = el.closest("[data-module]")?.dataset.module || "简历内容";
        scheduleSave(`编辑 · ${module}`);
        requestAnimationFrame(checkOverflow);
      });
    });
  }

  function moduleMarkerForPath(path) {
    if (path?.startsWith("experience.")) return state.appearance.markers.experience;
    if (path?.startsWith("projects.")) return state.appearance.markers.projects;
    if (path?.startsWith("skills.")) return state.appearance.markers.skills;
    return "arrow";
  }

  function selectListParagraph(path) {
    selectedListPath = path;
    syncMarkerTargetUI();
  }

  function syncMarkerTargetUI() {
    $$('[data-list-path]').forEach(item => item.classList.toggle("marker-target", item.dataset.listPath === selectedListPath));
    const control = $("#itemMarker");
    const deleteButton = $("#deleteSelectedRowBtn");
    const hint = $("#markerTargetHint");
    if (!control || !deleteButton || !hint) return;
    const target = selectedListPath && $(`[data-list-path="${CSS.escape(selectedListPath)}"]`);
    control.disabled = !target;
    deleteButton.disabled = !target;
    if (!target) {
      control.value = "inherit";
      hint.textContent = "先点击简历里带序号的段落";
      return;
    }
    const text = target.querySelector(".list-content")?.innerText.trim() || "当前段落";
    hint.textContent = `正在修改：${text.slice(0, 18)}${text.length > 18 ? "…" : ""}`;
    control.value = state.appearance.itemMarkers?.[selectedListPath] || "inherit";
  }

  function cleanRich(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("script,style,img,a,iframe,object").forEach(node => node.remove());
    template.content.querySelectorAll("*").forEach(node => {
      if (!["STRONG", "B", "EM", "I", "SPAN", "BR"].includes(node.tagName)) {
        node.replaceWith(...node.childNodes); return;
      }
      [...node.attributes].forEach(attr => {
        if (attr.name !== "style" || !/^font-size:\s*[\d.]+em;?$/.test(attr.value)) node.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function setByPath(object, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const parent = keys.reduce((obj, key) => obj[key], object);
    parent[last] = value;
  }

  function applyPhotoTransform() {
    const img = $("#portraitImage");
    const portrait = $("#portrait");
    if (!img || !portrait) return;
    state.photo.frameX = Number(state.photo.frameX || 0);
    state.photo.frameY = Number(state.photo.frameY || 0);
    portrait.style.setProperty("--photo-frame-x", `${state.photo.frameX}px`);
    portrait.style.setProperty("--photo-frame-y", `${state.photo.frameY}px`);
    portrait.dataset.dragMode = photoDragMode;
    portrait.title = photoDragMode === "frame" ? "拖动整个照片框" : "拖动框内照片调整构图";
    img.style.transform = `translate(calc(-50% + ${state.photo.x}px), calc(-50% + ${state.photo.y}px)) scale(${state.photo.scale})`;
    $("#photoScale").value = Math.round(state.photo.scale * 100);
    $("#scaleValue").textContent = `${Math.round(state.photo.scale * 100)}%`;
  }

  function bindPaperActions() {
    $$("[data-add-row]").forEach(button => button.addEventListener("click", () => addRow(button.dataset.addRow)));
    $$("[data-delete-row]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      deleteListRow(button.dataset.deleteRow);
    }));
    $$("[data-remove-section]").forEach(button => button.addEventListener("click", () => {
      const index = Number(button.dataset.removeSection);
      showModal("删除这个板块？", "板块标题和其中的全部内容都会从当前简历移除。", () => {
        state.customSections.splice(index, 1); state.rich = {}; render(); scheduleSave("删除自定义板块");
      });
    }));
  }

  function remapIndexedRecord(record, parentPath, deletedIndex) {
    const result = {};
    const prefix = `${parentPath}.`;
    Object.entries(record || {}).forEach(([key, value]) => {
      if (!key.startsWith(prefix)) { result[key] = value; return; }
      const remainder = key.slice(prefix.length);
      const match = remainder.match(/^(\d+)(.*)$/);
      if (!match) { result[key] = value; return; }
      const index = Number(match[1]);
      if (index === deletedIndex) return;
      const nextIndex = index > deletedIndex ? index - 1 : index;
      result[`${prefix}${nextIndex}${match[2]}`] = value;
    });
    return result;
  }

  function deleteListRow(path) {
    const parts = String(path || "").split(".");
    const index = Number(parts.pop());
    if (!Number.isInteger(index)) return;
    const parentPath = parts.join(".");
    const list = parts.reduce((value, key) => value?.[key], state);
    if (!Array.isArray(list) || index < 0 || index >= list.length) return;
    const preview = String(list[index] || "").trim();
    const remove = () => {
      list.splice(index, 1);
      state.rich = remapIndexedRecord(state.rich, parentPath, index);
      state.appearance.itemMarkers = remapIndexedRecord(state.appearance.itemMarkers, parentPath, index);
      selectedListPath = null;
      render();
      scheduleSave("删除整行");
    };
    if (!preview) remove();
    else showModal("删除这一整行？", `${preview.slice(0, 42)}${preview.length > 42 ? "…" : ""}。删除后，下方内容会自动上移并重新编号。`, remove);
  }

  function addRow(key) {
    if (key === "education") state.education.push({ school: "学校名称", major: "专业 / 学历", date: "起止时间", note: "" });
    else if (key === "experience" || key === "projects") state[key].push({ company: "机构 / 项目名称", team: "部门", role: "职位", date: "起止时间", summary: "", bullets: ["请填写职责或成果"] });
    else if (key === "skills") state.skills.push("请填写技能或优势");
    else if (key.startsWith("custom:")) state.customSections[Number(key.split(":")[1])].items.push("请填写内容");
    render(); scheduleSave("新增简历内容");
  }

  function addSection() {
    state.customSections ||= [];
    state.customSections.push({ title: "新增板块", items: ["请填写内容"] });
    render(); scheduleSave("新增自定义板块");
    const sections = $$(".custom-section");
    sections.at(-1)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function activeEditableFromSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const node = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode;
    return node?.closest?.('[contenteditable="true"]');
  }

  function dispatchEditableInput(editable) {
    editable?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatBackColor" }));
  }

  function adjustSelectionSize(factor) {
    const selection = window.getSelection();
    const editable = activeEditableFromSelection();
    if (!editable || !selection?.rangeCount || selection.isCollapsed) return showModal("请先选择文字", "拖动选中简历中的文字后，再使用字号增减按钮。", null, false);
    const range = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = `${factor}em`;
    try { range.surroundContents(span); }
    catch { document.execCommand("fontSize", false, factor > 1 ? "4" : "2"); }
    dispatchEditableInput(editable);
  }

  function applySelectionCommand(command) {
    const editable = activeEditableFromSelection();
    if (command === "undo") { document.execCommand("undo"); dispatchEditableInput(activeEditableFromSelection()); return; }
    if (!editable) return showModal("请先选择文字", "先在 A4 纸面中选中文字或放置光标，再使用选区工具。", null, false);
    if (command === "bold" || command === "italic") document.execCommand(command);
    else if (command === "arrow") document.execCommand("insertText", false, "➤ ");
    else if (command === "larger") return adjustSelectionSize(1.1);
    else if (command === "smaller") return adjustSelectionSize(.9);
    dispatchEditableInput(editable);
  }

  function bindPortraitDrag() {
    const portrait = $("#portrait");
    portrait.addEventListener("pointerdown", event => {
      const frame = photoDragMode === "frame";
      const portraitRect = portrait.getBoundingClientRect();
      const paperRect = $("#paper").getBoundingClientRect();
      const originX = frame ? Number(state.photo.frameX || 0) : Number(state.photo.x || 0);
      const originY = frame ? Number(state.photo.frameY || 0) : Number(state.photo.y || 0);
      drag = {
        pointerId: event.pointerId, mode: photoDragMode, startX: event.clientX, startY: event.clientY,
        originX, originY,
        minX: originX + paperRect.left - portraitRect.left,
        maxX: originX + paperRect.right - portraitRect.right,
        minY: originY + paperRect.top - portraitRect.top,
        maxY: originY + paperRect.bottom - portraitRect.bottom
      };
      portrait.classList.add("is-dragging");
      portrait.setPointerCapture(event.pointerId);
    });
    portrait.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === "frame") {
        state.photo.frameX = Math.min(drag.maxX, Math.max(drag.minX, drag.originX + dx));
        state.photo.frameY = Math.min(drag.maxY, Math.max(drag.minY, drag.originY + dy));
      } else {
        state.photo.x = drag.originX + dx;
        state.photo.y = drag.originY + dy;
      }
      applyPhotoTransform(); scheduleSave(drag.mode === "frame" ? "移动照片框" : "调整照片构图");
    });
    const stop = () => { portrait.classList.remove("is-dragging"); drag = null; };
    portrait.addEventListener("pointerup", stop);
    portrait.addEventListener("pointercancel", stop);
  }

  function checkOverflow() {
    const paper = $("#paper");
    const root = $("#resumeRoot");
    const printableBottom = paper.getBoundingClientRect().bottom - (10 * 96 / 25.4);
    const overflowing = $$("[data-module]", root).find(el => el.getBoundingClientRect().bottom > printableBottom + .5);
    const hasOverflow = Boolean(overflowing || root.scrollHeight > root.clientHeight);
    paper.classList.toggle("has-overflow", hasOverflow);
    $("#pageBadge").className = `page-badge ${hasOverflow ? "bad" : "ok"}`;
    $("#pageBadge").innerHTML = `<i></i><strong>${hasOverflow ? "内容已溢出" : "单页范围内"}</strong>`;
    $("#pageDetail").textContent = hasOverflow ? `溢出位置：${overflowing?.dataset.module || "页面底部"}。请精简该模块内容。` : "内容未超出 A4 单页导出边界。";
    const toast = $("#overflowToast");
    toast.textContent = hasOverflow ? `⚠ ${overflowing?.dataset.module || "页面底部"} 超出 A4 单页边界` : "";
    toast.classList.toggle("visible", hasOverflow);
    return { hasOverflow, module: overflowing?.dataset.module || "页面底部" };
  }

  function readFile(file, callback) {
    const reader = new FileReader();
    reader.onload = () => callback(reader.result);
    reader.onerror = () => showModal("读取失败", "无法读取这个文件，请重试。", null, false);
    reader.readAsText(file, "UTF-8");
  }

  async function convertSourceDocument(file) {
    if (!file) return;
    $("#sourceResumeName").textContent = `正在读取 ${file.name}…`;
    $("#convertMdBtn").disabled = true;
    $("#convertJsonBtn").disabled = true;
    try {
      const buffer = await file.arrayBuffer();
      let paragraphs = [];
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const pdfjs = await import("./vendor/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          let line = "";
          content.items.forEach(item => {
            line += item.str;
            if (item.hasEOL) { if (line.trim()) paragraphs.push(line.trim()); line = ""; }
            else line += " ";
          });
          if (line.trim()) paragraphs.push(line.trim());
        }
      } else if (/\.docx$/i.test(file.name)) {
        if (!window.JSZip) throw new Error("DOCX parser unavailable");
        const zip = await window.JSZip.loadAsync(buffer);
        const xml = await zip.file("word/document.xml")?.async("string");
        if (!xml) throw new Error("Invalid DOCX");
        const documentXml = new DOMParser().parseFromString(xml, "application/xml");
        paragraphs = [...documentXml.getElementsByTagNameNS("*", "p")].map(paragraph =>
          [...paragraph.getElementsByTagNameNS("*", "t")].map(node => node.textContent).join("").trim()
        ).filter(Boolean);
      } else throw new Error("Unsupported file");
      convertedDocument = { name: file.name.replace(/\.(pdf|docx)$/i, ""), type: file.name.split(".").pop().toLowerCase(), paragraphs };
      $("#sourceResumeName").textContent = `${file.name} · ${paragraphs.length} 个文本段落`;
      $("#convertMdBtn").disabled = false;
      $("#convertJsonBtn").disabled = false;
    } catch (error) {
      convertedDocument = null;
      $("#sourceResumeName").textContent = "读取失败";
      showModal("文档转换失败", "这个文件可能是扫描版、加密文件或格式不完整。扫描版 PDF 需要先进行 OCR。", null, false);
    }
  }

  function downloadConverted(format) {
    if (!convertedDocument) return;
    if (format === "md") {
      const mode = $("#convertMode").value;
      const faithful = convertedDocument.paragraphs.join("\n\n");
      const structured = convertedDocument.paragraphs.map(line => (/^(教育|实习|项目|技能|自我)/.test(line) ? `## ${line}` : line)).join("\n\n");
      const prompt = `请将以下简历原文整理为本排版器约定的 Markdown 格式。要求：不得编造经历或数字；保留所有量化成果；使用“教育经历、实习经历、项目经历、技能与优势”四个二级标题；每段经历用“### 机构｜部门｜职位｜时间”，职责用短横线列表。\n\n---\n\n${faithful}`;
      const body = mode === "faithful" ? faithful : mode === "prompt" ? prompt : structured;
      const suffix = mode === "prompt" ? "-转换提示词" : "";
      downloadBlob(`# ${convertedDocument.name}\n\n${body}`, `${convertedDocument.name}${suffix}.md`, "text/markdown;charset=utf-8");
    } else {
      downloadBlob(JSON.stringify(convertedDocument, null, 2), `${convertedDocument.name}.json`, "application/json;charset=utf-8");
    }
  }

  function importMarkdown(text) {
    const next = parseMarkdown(text);
    if (!next) return;
    next.photo = state.photo;
    next.appearance = state.appearance;
    setActiveState(next);
    render(); persist({ recordHistory: true, label: "导入 Markdown" });
    showModal("导入完成", "简历内容已替换，排版、字号、网格和照片位置保持不变。", null, false);
  }

  function parseMarkdown(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    const data = clone(window.INITIAL_RESUME);
    const title = lines.find(line => /^#\s+/.test(line));
    if (!title) { showModal("格式不符合约定", "未找到一级标题姓名。请下载示例 Markdown 后按相同结构填写。", null, false); return null; }
    data.profile.name = title.replace(/^#\s+/, "").trim();
    const getMeta = key => (lines.find(line => line.startsWith(`- ${key}：`)) || "").split("：").slice(1).join("：").trim();
    data.profile.phone = getMeta("手机") || data.profile.phone;
    data.profile.email = getMeta("邮箱") || data.profile.email;
    data.profile.homepage = getMeta("主页/微信") || data.profile.homepage;

    const sections = {};
    let current = null;
    lines.forEach(line => {
      const heading = line.match(/^##\s+(.+)/);
      if (heading) { current = heading[1].trim(); sections[current] = []; }
      else if (current) sections[current].push(line);
    });

    const parseTable = block => block.filter(line => /^\|/.test(line) && !/^\|[\s:-]+\|/.test(line)).slice(1).map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
    const eduRows = parseTable(sections["教育经历"] || []);
    if (eduRows.length) data.education = eduRows.map(row => ({ school: row[0] || "", major: row[1] || "", date: row[2] || "", note: row[3] || "" }));

    data.experience = parseEntries(sections["实习经历"] || []);
    data.projects = parseEntries(sections["项目经历"] || []);
    const skillLines = (sections["技能与优势"] || []).filter(line => /^\s*\d+\.\s+/.test(line));
    if (skillLines.length) data.skills = skillLines.map(line => line.replace(/^\s*\d+\.\s+/, "").trim());
    return data;
  }

  function parseEntries(lines) {
    const items = [];
    let entry = null;
    lines.forEach(line => {
      const head = line.match(/^###\s+(.+)/);
      if (head) {
        const parts = head[1].split("｜").map(part => part.trim());
        entry = { company: parts[0] || "", team: parts[1] || "", role: parts[2] || "", date: parts[3] || "", summary: "", bullets: [] };
        items.push(entry);
      } else if (entry && /^>\s*/.test(line)) entry.summary = line.replace(/^>\s*/, "").trim();
      else if (entry && /^[-*]\s+/.test(line)) entry.bullets.push(line.replace(/^[-*]\s+/, "").trim());
    });
    return items;
  }

  function exportMarkdown() {
    const entryText = items => items.map(item => `### ${item.company}｜${item.team}｜${item.role}｜${item.date}\n${item.summary ? `> ${item.summary}\n` : ""}${item.bullets.map(b => `- ${b}`).join("\n")}`).join("\n\n");
    const markdown = `# ${state.profile.name}\n\n- 手机：${state.profile.phone}\n- 邮箱：${state.profile.email}\n- 主页/微信：${state.profile.homepage}\n\n## 教育经历\n\n| 学校 | 专业/学历 | 时间 | 备注 |\n| --- | --- | --- | --- |\n${state.education.map(item => `| ${item.school} | ${item.major} | ${item.date} | ${item.note || ""} |`).join("\n")}\n\n## 实习经历\n\n${entryText(state.experience)}\n\n## 项目经历\n\n${entryText(state.projects)}\n\n## 技能与优势\n\n${state.skills.map((item, i) => `${i + 1}. ${item}`).join("\n")}`;
    downloadBlob(markdown, `${state.profile.name}-简历.md`, "text/markdown;charset=utf-8");
  }

  function safeFilename(name) {
    return String(name || "简历").replace(/[\\/:*?"<>|]/g, "-").trim() || "简历";
  }

  function exportStem() {
    const current = activeVersion();
    const context = current.isMaster ? "母版" : [current.company, current.role].filter(Boolean).join("-") || current.name;
    return safeFilename(`${state.profile.name}-${context}-简历`);
  }

  async function withExportButton(button, busyText, task) {
    const original = button.textContent;
    button.disabled = true;
    button.classList.add("is-exporting");
    button.textContent = busyText;
    try { await task(); }
    catch (error) {
      console.error(error);
      showModal("导出失败", "文件没有生成，请刷新页面后重试。若仍失败，请使用最新版 Chrome 或 Edge。", null, false);
    } finally {
      button.disabled = false;
      button.classList.remove("is-exporting");
      button.textContent = original;
    }
  }

  function runAfterOverflowCheck(task) {
    const result = checkOverflow();
    if (!result.hasOverflow) return task();
    showModal("内容超出 A4 单页", `溢出位置：${result.module}。继续导出会裁切到一张 A4 页面，建议先精简内容。`, task);
  }

  async function exportPdf() {
    if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error("PDF exporter unavailable");
    const paper = $("#paper");
    const active = document.activeElement;
    active?.blur?.();
    paper.classList.add("is-exporting");
    await document.fonts?.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const canvas = await window.html2canvas(paper, {
        scale: 3,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: false,
        width: paper.offsetWidth,
        height: paper.offsetHeight,
        windowWidth: paper.offsetWidth,
        windowHeight: paper.offsetHeight
      });
      const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      pdf.setProperties({ title: `${state.profile.name} 简历`, subject: "A4 简历", creator: "A4 简历排版器" });
      pdf.addImage(canvas.toDataURL("image/jpeg", .96), "JPEG", 0, 0, 210, 297, undefined, "FAST");
      pdf.save(`${exportStem()}.pdf`);
    } finally {
      paper.classList.remove("is-exporting");
    }
  }

  function wordRuns(path, text, options = {}) {
    const { TextRun } = window.docx;
    const baseSize = Math.round(Number(state.appearance.fontSize) * 2);
    const eastAsia = WORD_FONTS[state.appearance.font] || "KaiTi";
    const { autoLead, ...runOptions } = options;
    const base = { size: baseSize, color: "000000", ...runOptions };
    const pushText = (value, style = {}) => {
      String(value).split(/([\u2e80-\u9fff\uf900-\ufaff]+)/).filter(Boolean).forEach(part => {
        const isCjk = /[\u2e80-\u9fff\uf900-\ufaff]/.test(part);
        const font = isCjk ? eastAsia : "Times New Roman";
        runs.push(new TextRun({ ...base, ...style, font, text: part }));
      });
    };
    let html = state.rich?.[path];
    if (!html && autoLead) html = richLead(text);
    const runs = [];
    if (!html) { pushText(text || ""); return runs; }
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const walk = (node, style = {}) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) pushText(node.textContent, style);
        return;
      }
      if (node.nodeName === "BR") { runs.push(new TextRun({ ...base, ...style, break: 1 })); return; }
      const next = { ...style };
      if (["STRONG", "B"].includes(node.nodeName)) next.bold = true;
      if (["EM", "I"].includes(node.nodeName)) next.italics = true;
      const em = Number.parseFloat(node.style?.fontSize || "");
      if (Number.isFinite(em)) next.size = Math.round(baseSize * em);
      node.childNodes.forEach(child => walk(child, next));
    };
    holder.childNodes.forEach(node => walk(node));
    if (!runs.length) pushText(text || "");
    return runs;
  }

  function paragraph(path, text, options = {}) {
    const { Paragraph } = window.docx;
    const { autoLead, ...paragraphOptions } = options;
    return new Paragraph({
      children: wordRuns(path, text, { autoLead }),
      spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) },
      ...paragraphOptions
    });
  }

  function emptyWordBorders() {
    const border = { style: window.docx.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    return { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  }

  function wordCell(children, width, alignment) {
    const { TableCell, WidthType, VerticalAlign } = window.docx;
    return new TableCell({
      children,
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 0, bottom: 0, left: 25, right: 25 },
      ...(alignment ? { } : {})
    });
  }

  async function croppedPhotoData() {
    const img = $("#portraitImage");
    if (!img?.complete) await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const width = 142, height = 199;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
    const fit = Math.max(width / img.naturalWidth, height / img.naturalHeight) * Number(state.photo.scale || 1);
    const drawWidth = img.naturalWidth * fit, drawHeight = img.naturalHeight * fit;
    context.drawImage(img, (width - drawWidth) / 2 + Number(state.photo.x || 0) * 2, (height - drawHeight) / 2 + Number(state.photo.y || 0) * 2, drawWidth, drawHeight);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return blob.arrayBuffer();
  }

  async function buildWordDocument() {
    if (!window.docx?.Document) throw new Error("Word exporter unavailable");
    const {
      AlignmentType, BorderStyle, Document, ImageRun, Packer, PageOrientation,
      Paragraph, Table, TableLayoutType, TableRow, TextRun, WidthType
    } = window.docx;
    const contentWidth = 10250;
    const baseSize = Math.round(Number(state.appearance.fontSize) * 2);
    const font = WORD_FONTS[state.appearance.font] || "KaiTi";
    const noBorders = emptyWordBorders();
    const table = (cells, widths) => new Table({
      width: { size: contentWidth, type: WidthType.DXA }, layout: TableLayoutType.FIXED, borders: noBorders,
      rows: [new TableRow({ children: cells.map((children, index) => wordCell(children, widths[index])) })]
    });
    const plain = (text, opts = {}) => new Paragraph({
      children: wordRuns("", text, { size: baseSize, color: "000000", ...opts.run }),
      spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240), ...opts.spacing },
      alignment: opts.alignment,
      keepNext: opts.keepNext
    });
    const headerCenter = [
      new Paragraph({ children: wordRuns("profile.name", state.profile.name, { size: Math.round(baseSize * 1.93), bold: true, characterSpacing: 90 }), alignment: AlignmentType.CENTER, spacing: { before: 50, after: 130 } }),
      plain(`Tel:${state.profile.phone}｜邮箱：${state.profile.email}`, { alignment: AlignmentType.CENTER, spacing: { after: 35 } }),
      plain(state.profile.homepage, { alignment: AlignmentType.CENTER })
    ];
    const photo = await croppedPhotoData();
    const children = [table([[plain("")], headerCenter, [new Paragraph({ children: [new ImageRun({ data: photo, transformation: { width: 71, height: 100 }, type: "png" })], alignment: AlignmentType.RIGHT })]], [1920, 6410, 1920])];
    const heading = title => new Paragraph({
      children: wordRuns("", title, { size: Math.round(baseSize * 1.17), bold: true, characterSpacing: 45 }),
      border: { bottom: { style: BorderStyle.SINGLE, size: Math.max(4, Math.round(Number(state.appearance.ruleWidth) * 8)), color: "000000", space: 0 } },
      spacing: { before: 70, after: 35 }, keepNext: true
    });
    const addHeading = title => children.push(heading(title));
    addHeading("教育经历");
    state.education.forEach((item, i) => {
      children.push(table([
        [paragraph(`education.${i}.school`, item.school, { keepNext: true })],
        [new Paragraph({ children: wordRuns(`education.${i}.major`, item.major), alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) } })],
        [new Paragraph({ children: wordRuns(`education.${i}.date`, item.date), alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) } })]
      ], [3280, 3480, 3490]));
      if (item.note) children.push(paragraph(`education.${i}.note`, item.note));
    });
    const addEntries = (title, items, key, project = false) => {
      addHeading(title);
      items.forEach((item, i) => {
        children.push(table([
          [paragraph(`${key}.${i}.company`, item.company, { keepNext: true })],
          [new Paragraph({ children: wordRuns(`${key}.${i}.team`, item.team), alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })],
          [new Paragraph({ children: wordRuns(`${key}.${i}.role`, item.role), alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })],
          [new Paragraph({ children: wordRuns(`${key}.${i}.date`, item.date), alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0 } })]
        ], project ? [5320, 1220, 1720, 1990] : [3280, 2460, 2550, 1960]));
        if (item.summary) children.push(paragraph(`${key}.${i}.summary`, item.summary, { keepNext: true }));
        item.bullets.forEach((bullet, j) => {
          const path = `${key}.${i}.bullets.${j}`;
          const marker = markerText(j, markerStyleFor(path, state.appearance.markers[key]));
          children.push(new Paragraph({
            children: [new TextRun({ text: marker ? `${marker} ` : "", font, size: baseSize }), ...wordRuns(path, bullet, { autoLead: true })],
            indent: { left: 300, hanging: 250 }, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) }
          }));
        });
      });
    };
    addEntries("实习经历", state.experience, "experience");
    addEntries("项目经历", state.projects, "projects", true);
    (state.customSections || []).forEach((section, i) => {
      addHeading(section.title);
      section.items.forEach((item, j) => {
        const path = `customSections.${i}.items.${j}`;
        const marker = markerText(j, markerStyleFor(path, "arrow"));
        children.push(new Paragraph({ children: [new TextRun({ text: marker ? `${marker} ` : "", font, size: baseSize }), ...wordRuns(path, item, { autoLead: true })], indent: { left: 300, hanging: 250 }, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) } }));
      });
    });
    addHeading("技能与优势");
    state.skills.forEach((item, i) => {
      const path = `skills.${i}`;
      const marker = markerText(i, markerStyleFor(path, state.appearance.markers.skills));
      children.push(new Paragraph({ children: [new TextRun({ text: marker ? `${marker} ` : "", font, size: baseSize }), ...wordRuns(path, item, { autoLead: true })], indent: { left: 300, hanging: 250 }, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) } }));
    });
    return { document: new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 748, right: 828, bottom: 567, left: 828 } } }, children }] }), Packer };
  }

  async function exportWord() {
    const { document: wordDocument, Packer } = await buildWordDocument();
    const blob = await Packer.toBlob(wordDocument);
    downloadBlob(blob, `${exportStem()}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportBackup() {
    persist();
    const payload = { format: "a4-resume-editor-workspace", version: 2, savedAt: new Date().toISOString(), workspace };
    downloadBlob(JSON.stringify(payload, null, 2), `${state.profile.name}-简历版本库.resume`, "application/json;charset=utf-8");
  }

  function importBackup(text) {
    try {
      const parsed = JSON.parse(text);
      const incomingWorkspace = parsed.workspace;
      const candidate = parsed.data || (!incomingWorkspace ? parsed : null);
      if (incomingWorkspace?.versions?.length) {
        showModal("恢复完整版本库？", "当前母版、岗位版本和 JD 都会被备份文件替换。", () => {
          workspace = { ...incomingWorkspace, versions: incomingWorkspace.versions.map(normalizeVersion) };
          workspace.activeId = workspace.versions.some(item => item.id === workspace.activeId) ? workspace.activeId : workspace.versions[0].id;
          state = activeVersion().data;
          render(); persist();
        });
      } else {
        if (!candidate?.profile || !Array.isArray(candidate.education) || !Array.isArray(candidate.experience)) throw new Error("invalid");
        showModal("恢复到当前版本？", "备份中的文字、照片和样式将替换当前简历版本。", () => { setActiveState(candidate); render(); persist(); });
      }
    } catch { showModal("副本无法读取", "请选择由本排版器导出的 .resume 或 JSON 文件。", null, false); }
  }

  function updateAppearance(key, rawValue) {
    const numeric = ["fontSize", "ruleWidth", "lineHeight"].includes(key);
    const value = numeric ? Number(rawValue) : rawValue;
    if (numeric && !Number.isFinite(value)) return;
    state.appearance[key] = value;
    applyAppearance(); scheduleSave(`调整${({ font: "字体", fontSize: "字号", ruleWidth: "横线", lineHeight: "行距" })[key] || "排版"}`);
  }

  function populateMarkerControls() {
    ["experienceMarker", "projectMarker", "skillsMarker"].forEach(id => {
      $("#" + id).innerHTML = MARKER_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    });
    $("#itemMarker").innerHTML = `<option value="inherit">跟随模块默认</option>${MARKER_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}`;
  }

  function showModal(title, message, action, showCancel = true) {
    $("#modalTitle").textContent = title;
    $("#modalMessage").textContent = message;
    $("#modalCancel").hidden = !showCancel;
    $("#modalConfirm").textContent = action ? "确认" : "知道了";
    modalAction = action;
    $("#modal").hidden = false;
  }

  function closeModal(confirm = false) {
    $("#modal").hidden = true;
    if (confirm && modalAction) modalAction();
    modalAction = null;
  }

  function wireControls() {
    populateMarkerControls();
    $("#historyBtn").addEventListener("click", event => { event.stopPropagation(); setHistoryOpen($("#historyPopover").hidden); });
    $("#closeHistoryBtn").addEventListener("click", () => setHistoryOpen(false));
    $("#historyPopover").addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", () => setHistoryOpen(false));
    $("#createVersionBtn").addEventListener("click", () => createVersion());
    $("#duplicateVersionBtn").addEventListener("click", duplicateVersion);
    $("#deleteVersionBtn").addEventListener("click", deleteVersion);
    [["versionNameInput", "name"], ["companyInput", "company"], ["roleInput", "role"], ["jdInput", "jd"]].forEach(([id, key]) => {
      $("#" + id).addEventListener("input", event => updateVersionMeta(key, event.target.value));
    });
    $("#gridToggle").addEventListener("change", event => $("#paper").classList.toggle("show-grid", event.target.checked));
    $("#exportPdfBtn").addEventListener("click", () => runAfterOverflowCheck(() => withExportButton($("#exportPdfBtn"), "正在导出…", exportPdf)));
    $("#exportWordBtn").addEventListener("click", () => runAfterOverflowCheck(() => withExportButton($("#exportWordBtn"), "正在导出…", exportWord)));
    $("#downloadMdBtn").addEventListener("click", exportMarkdown);
    $("#addSectionBtn").addEventListener("click", addSection);
    $$('[data-command]').forEach(button => button.addEventListener("mousedown", event => event.preventDefault()));
    $$('[data-command]').forEach(button => button.addEventListener("click", () => applySelectionCommand(button.dataset.command)));
    $("#downloadBackupBtn").addEventListener("click", exportBackup);
    $("#backupInput").addEventListener("change", event => event.target.files[0] && readFile(event.target.files[0], importBackup));
    $("#fontSelect").addEventListener("change", event => updateAppearance("font", event.target.value));
    ["fontSizeRange", "fontSizeNumber"].forEach(id => $("#" + id).addEventListener("input", event => updateAppearance("fontSize", event.target.value)));
    $("#lineHeightRange").addEventListener("input", event => updateAppearance("lineHeight", event.target.value));
    ["ruleWidthRange", "ruleWidthNumber"].forEach(id => $("#" + id).addEventListener("input", event => updateAppearance("ruleWidth", event.target.value)));
    [["experienceMarker", "experience"], ["projectMarker", "projects"], ["skillsMarker", "skills"]].forEach(([id, key]) => $("#" + id).addEventListener("change", event => {
      state.appearance.markers[key] = event.target.value; render(); scheduleSave(`修改${key === "experience" ? "实习" : key === "projects" ? "项目" : "技能"}模块默认序号`);
    }));
    $("#itemMarker").addEventListener("change", event => {
      if (!selectedListPath) return;
      state.appearance.itemMarkers ||= {};
      if (event.target.value === "inherit") delete state.appearance.itemMarkers[selectedListPath];
      else state.appearance.itemMarkers[selectedListPath] = event.target.value;
      render();
      scheduleSave("修改当前段落序号");
    });
    $("#deleteSelectedRowBtn").addEventListener("click", () => {
      if (selectedListPath) deleteListRow(selectedListPath);
    });
    $("#resetStyleBtn").addEventListener("click", () => {
      state.appearance = clone(window.INITIAL_RESUME.appearance); selectedListPath = null; render(); scheduleSave("恢复模板样式");
    });
    $("#resetBtn").addEventListener("click", () => {
      const current = activeVersion();
      const source = current.isMaster ? window.INITIAL_RESUME : workspace.versions.find(item => item.isMaster)?.data || window.INITIAL_RESUME;
      showModal("恢复当前版本？", current.isMaster ? "母版内容将恢复为首次打开时的状态。其他岗位版本不会受影响。" : "当前岗位版本将重新复制母版内容，已填写的公司、岗位和 JD 会保留。", () => { setActiveState(clone(source)); render(); persist(); });
    });
    $$('[data-photo-mode]').forEach(button => button.addEventListener("click", () => {
      photoDragMode = button.dataset.photoMode;
      $$('[data-photo-mode]').forEach(item => item.classList.toggle("active", item === button));
      applyPhotoTransform();
      $(".photo-tools .hint-inline").textContent = photoDragMode === "frame" ? "直接拖动相框" : "拖动框内照片";
    }));
    $("#photoResetBtn").addEventListener("click", () => {
      Object.assign(state.photo, { scale: 1, x: 0, y: 0, frameX: 0, frameY: 0 });
      applyPhotoTransform(); persist({ recordHistory: true, label: "还原照片位置" });
    });
    $("#photoScale").addEventListener("input", event => { state.photo.scale = Number(event.target.value) / 100; applyPhotoTransform(); scheduleSave("缩放照片"); });
    $("#photoInput").addEventListener("change", event => handlePhoto(event.target.files[0]));
    $("#markdownInput").addEventListener("change", event => event.target.files[0] && readFile(event.target.files[0], importMarkdown));
    $("#sourceResumeInput").addEventListener("change", event => convertSourceDocument(event.target.files[0]));
    $("#convertMdBtn").addEventListener("click", () => downloadConverted("md"));
    $("#convertJsonBtn").addEventListener("click", () => downloadConverted("json"));
    $("#modalCancel").addEventListener("click", () => closeModal(false));
    $("#modalConfirm").addEventListener("click", () => closeModal(true));
    $("#modal").addEventListener("click", event => { if (event.target.id === "modal") closeModal(false); });
    window.addEventListener("resize", checkOverflow);
    window.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); clearTimeout(saveTimer); persist({ recordHistory: true, label: "手动保存" });
      }
      if (event.key === "Escape") setHistoryOpen(false);
    });

    const dz = $("#markdownDropzone");
    ["dragenter", "dragover"].forEach(type => dz.addEventListener(type, event => { event.preventDefault(); dz.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach(type => dz.addEventListener(type, event => { event.preventDefault(); dz.classList.remove("dragover"); }));
    dz.addEventListener("drop", event => { const file = event.dataTransfer.files[0]; if (file) readFile(file, importMarkdown); });
  }

  function handlePhoto(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showModal("图片格式不支持", "请选择 JPG、PNG 或 WebP 文件。", null, false); return; }
    if (file.size > PHOTO_LIMIT) { showModal("图片过大", "请选择 3 MB 以内的照片，以免浏览器本地存储空间不足。", null, false); return; }
    const reader = new FileReader();
    reader.onload = () => { state.photo = { src: reader.result, scale: 1, x: 0, y: 0, frameX: 0, frameY: 0 }; applyPhotoTransform(); $("#portraitImage").src = reader.result; persist({ recordHistory: true, label: "更换照片" }); };
    reader.readAsDataURL(file);
  }

  if (!(activeVersion().history || []).length) recordHistory("打开时状态");
  wireControls();
  render();
  persist();
})();
