(() => {
  const STORAGE_KEY = "a4-resume-editor.feiwanyan.v3";
  const PHOTO_LIMIT = 3 * 1024 * 1024;
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

  let state = loadState();
  let saveTimer = null;
  let modalAction = null;
  let drag = null;
  let convertedDocument = null;

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return clone(window.INITIAL_RESUME);
      const parsed = JSON.parse(saved);
      return {
        ...clone(window.INITIAL_RESUME), ...parsed,
        appearance: { ...clone(window.INITIAL_RESUME.appearance), ...(parsed.appearance || {}), markers: { ...window.INITIAL_RESUME.appearance.markers, ...(parsed.appearance?.markers || {}) } },
        customSections: parsed.customSections || [], rich: parsed.rich || {}
      };
    } catch { return clone(window.INITIAL_RESUME); }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $("#saveState").innerHTML = "<i></i> 已保存到本机";
    } catch {
      $("#saveState").textContent = "本机存储空间不足";
    }
  }

  function scheduleSave() {
    $("#saveState").textContent = "正在保存…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 320);
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

  function listItem(text, path, index, markerStyle) {
    const content = state.rich?.[path] || richLead(text);
    return `<li><span class="list-marker" aria-hidden="true">${markerText(index, markerStyle)}</span><span class="edit-cell list-content" contenteditable="true" spellcheck="false" data-path="${path}">${content}</span></li>`;
  }

  function render() {
    const root = $("#resumeRoot");
    root.innerHTML = `
      <header class="resume-header" data-module="个人信息">
        ${editable(state.profile.name, "profile.name", "resume-name")}
        <div class="contact-line edit-cell" contenteditable="true" spellcheck="false" data-profile-line="contact">Tel:${escapeHtml(state.profile.phone)}｜邮箱：${escapeHtml(state.profile.email)}</div>
        ${editable(state.profile.homepage, "profile.homepage", "contact-line")}
        <div class="portrait" id="portrait" title="拖动调整照片位置">
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
    const appearance = { ...clone(window.INITIAL_RESUME.appearance), ...(state.appearance || {}), markers: { ...window.INITIAL_RESUME.appearance.markers, ...(state.appearance?.markers || {}) } };
    state.appearance = appearance;
    const root = $("#resumeRoot");
    root.style.setProperty("--resume-font", FONT_STACKS[appearance.font] || FONT_STACKS.kaiti);
    root.style.setProperty("--body-size", `${appearance.fontSize}pt`);
    root.style.setProperty("--body-line", appearance.lineHeight);
    root.style.setProperty("--rule-width", `${appearance.ruleWidth}pt`);
    if ($("#fontSelect")) $("#fontSelect").value = appearance.font;
    if ($("#fontQuickSelect")) $("#fontQuickSelect").value = appearance.font;
    syncNumberRange("fontSize", appearance.fontSize);
    if ($("#fontSizeQuickRange")) $("#fontSizeQuickRange").value = appearance.fontSize;
    if ($("#fontSizeQuickValue")) $("#fontSizeQuickValue").textContent = `${appearance.fontSize}pt`;
    if ($("#lineHeightRange")) $("#lineHeightRange").value = appearance.lineHeight;
    if ($("#lineHeightValue")) $("#lineHeightValue").textContent = Number(appearance.lineHeight).toFixed(2);
    syncNumberRange("ruleWidth", appearance.ruleWidth);
    if ($("#ruleWidthQuickRange")) $("#ruleWidthQuickRange").value = appearance.ruleWidth;
    if ($("#ruleWidthQuickValue")) $("#ruleWidthQuickValue").textContent = `${appearance.ruleWidth}pt`;
    if ($("#experienceMarker")) $("#experienceMarker").value = appearance.markers.experience;
    if ($("#projectMarker")) $("#projectMarker").value = appearance.markers.projects;
    if ($("#skillsMarker")) $("#skillsMarker").value = appearance.markers.skills;
    if ($("#markerQuickSelect")) {
      const target = $("#markerTargetSelect")?.value || "experience";
      $("#markerQuickSelect").value = appearance.markers[target];
    }
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
        scheduleSave();
        requestAnimationFrame(checkOverflow);
      });
    });
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
    if (!img) return;
    img.style.transform = `translate(calc(-50% + ${state.photo.x}px), calc(-50% + ${state.photo.y}px)) scale(${state.photo.scale})`;
    $("#photoScale").value = Math.round(state.photo.scale * 100);
    $("#scaleValue").textContent = `${Math.round(state.photo.scale * 100)}%`;
    if ($("#photoQuickRange")) $("#photoQuickRange").value = Math.round(state.photo.scale * 100);
    if ($("#photoQuickValue")) $("#photoQuickValue").textContent = `${Math.round(state.photo.scale * 100)}%`;
  }

  function bindPaperActions() {
    $$("[data-add-row]").forEach(button => button.addEventListener("click", () => addRow(button.dataset.addRow)));
    $$("[data-remove-section]").forEach(button => button.addEventListener("click", () => {
      const index = Number(button.dataset.removeSection);
      showModal("删除这个板块？", "板块标题和其中的全部内容都会从当前简历移除。", () => {
        state.customSections.splice(index, 1); state.rich = {}; render(); scheduleSave();
      });
    }));
  }

  function addRow(key) {
    if (key === "education") state.education.push({ school: "学校名称", major: "专业 / 学历", date: "起止时间", note: "" });
    else if (key === "experience" || key === "projects") state[key].push({ company: "机构 / 项目名称", team: "部门", role: "职位", date: "起止时间", summary: "", bullets: ["请填写职责或成果"] });
    else if (key === "skills") state.skills.push("请填写技能或优势");
    else if (key.startsWith("custom:")) state.customSections[Number(key.split(":")[1])].items.push("请填写内容");
    render(); scheduleSave();
  }

  function addSection() {
    state.customSections ||= [];
    state.customSections.push({ title: "新增板块", items: ["请填写内容"] });
    render(); scheduleSave();
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
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: state.photo.x, originY: state.photo.y };
      portrait.setPointerCapture(event.pointerId);
    });
    portrait.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      state.photo.x = drag.originX + event.clientX - drag.startX;
      state.photo.y = drag.originY + event.clientY - drag.startY;
      applyPhotoTransform(); scheduleSave();
    });
    portrait.addEventListener("pointerup", () => { drag = null; });
    portrait.addEventListener("pointercancel", () => { drag = null; });
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
    $("#pageDetail").textContent = hasOverflow ? `溢出位置：${overflowing?.dataset.module || "页面底部"}。请精简该模块内容。` : "内容未超出 A4 打印边界。";
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
    state = next;
    render(); persist();
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
      pdf.save(`${safeFilename(state.profile.name)}-简历.pdf`);
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
          const marker = markerText(j, state.appearance.markers[key]);
          children.push(new Paragraph({
            children: [new TextRun({ text: marker ? `${marker} ` : "", font, size: baseSize }), ...wordRuns(`${key}.${i}.bullets.${j}`, bullet, { autoLead: true })],
            indent: { left: 300, hanging: 250 }, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) }
          }));
        });
      });
    };
    addEntries("实习经历", state.experience, "experience");
    addEntries("项目经历", state.projects, "projects", true);
    (state.customSections || []).forEach((section, i) => {
      addHeading(section.title);
      section.items.forEach((item, j) => children.push(new Paragraph({ children: [new TextRun({ text: "➤ ", font, size: baseSize }), ...wordRuns(`customSections.${i}.items.${j}`, item, { autoLead: true })], indent: { left: 300, hanging: 250 }, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) } })));
    });
    addHeading("技能与优势");
    state.skills.forEach((item, i) => children.push(new Paragraph({ children: [new TextRun({ text: `${markerText(i, state.appearance.markers.skills)} `, font, size: baseSize }), ...wordRuns(`skills.${i}`, item, { autoLead: true })], indent: { left: 300, hanging: 250 }, spacing: { before: 0, after: 0, line: Math.round(Number(state.appearance.lineHeight) * 240) } })));
    return { document: new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 748, right: 828, bottom: 567, left: 828 } } }, children }] }), Packer };
  }

  async function exportWord() {
    const { document: wordDocument, Packer } = await buildWordDocument();
    const blob = await Packer.toBlob(wordDocument);
    downloadBlob(blob, `${safeFilename(state.profile.name)}-简历.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportBackup() {
    persist();
    const payload = { format: "a4-resume-editor", version: 1, savedAt: new Date().toISOString(), data: state };
    downloadBlob(JSON.stringify(payload, null, 2), `${state.profile.name}-简历.resume`, "application/json;charset=utf-8");
  }

  function importBackup(text) {
    try {
      const parsed = JSON.parse(text);
      const candidate = parsed.data || parsed;
      if (!candidate.profile || !Array.isArray(candidate.education) || !Array.isArray(candidate.experience)) throw new Error("invalid");
      showModal("恢复本地副本？", "当前浏览器中的内容、照片和样式将替换为副本中的版本。", () => {
        state = { ...clone(window.INITIAL_RESUME), ...candidate };
        state.appearance = { ...clone(window.INITIAL_RESUME.appearance), ...(candidate.appearance || {}), markers: { ...window.INITIAL_RESUME.appearance.markers, ...(candidate.appearance?.markers || {}) } };
        render(); persist();
      });
    } catch { showModal("副本无法读取", "请选择由本排版器导出的 .resume 或 JSON 文件。", null, false); }
  }

  function updateAppearance(key, rawValue) {
    const numeric = ["fontSize", "ruleWidth", "lineHeight"].includes(key);
    const value = numeric ? Number(rawValue) : rawValue;
    if (numeric && !Number.isFinite(value)) return;
    state.appearance[key] = value;
    applyAppearance(); scheduleSave();
  }

  function populateMarkerControls() {
    ["experienceMarker", "projectMarker", "skillsMarker", "markerQuickSelect"].forEach(id => {
      $("#" + id).innerHTML = MARKER_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    });
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
    $("#gridToggle").addEventListener("change", event => $("#paper").classList.toggle("show-grid", event.target.checked));
    $("#exportPdfBtn").addEventListener("click", () => runAfterOverflowCheck(() => withExportButton($("#exportPdfBtn"), "正在导出…", exportPdf)));
    $("#exportWordBtn").addEventListener("click", () => runAfterOverflowCheck(() => withExportButton($("#exportWordBtn"), "正在导出…", exportWord)));
    $("#downloadMdBtn").addEventListener("click", exportMarkdown);
    $("#addSectionBtn").addEventListener("click", addSection);
    $$('[data-command]').forEach(button => button.addEventListener("mousedown", event => event.preventDefault()));
    $$('[data-command]').forEach(button => button.addEventListener("click", () => applySelectionCommand(button.dataset.command)));
    $("#saveLocalBtn").addEventListener("click", exportBackup);
    $("#downloadBackupBtn").addEventListener("click", exportBackup);
    $("#backupInput").addEventListener("change", event => event.target.files[0] && readFile(event.target.files[0], importBackup));
    $("#fontSelect").addEventListener("change", event => updateAppearance("font", event.target.value));
    $("#fontQuickSelect").addEventListener("change", event => updateAppearance("font", event.target.value));
    ["fontSizeRange", "fontSizeNumber"].forEach(id => $("#" + id).addEventListener("input", event => updateAppearance("fontSize", event.target.value)));
    $("#fontSizeQuickRange").addEventListener("input", event => updateAppearance("fontSize", event.target.value));
    $("#lineHeightRange").addEventListener("input", event => updateAppearance("lineHeight", event.target.value));
    ["ruleWidthRange", "ruleWidthNumber"].forEach(id => $("#" + id).addEventListener("input", event => updateAppearance("ruleWidth", event.target.value)));
    $("#ruleWidthQuickRange").addEventListener("input", event => updateAppearance("ruleWidth", event.target.value));
    [["experienceMarker", "experience"], ["projectMarker", "projects"], ["skillsMarker", "skills"]].forEach(([id, key]) => $("#" + id).addEventListener("change", event => {
      state.appearance.markers[key] = event.target.value; render(); scheduleSave();
    }));
    $("#markerTargetSelect").addEventListener("change", event => { $("#markerQuickSelect").value = state.appearance.markers[event.target.value]; });
    $("#markerQuickSelect").addEventListener("change", event => { state.appearance.markers[$("#markerTargetSelect").value] = event.target.value; render(); scheduleSave(); });
    $("#resetStyleBtn").addEventListener("click", () => {
      state.appearance = clone(window.INITIAL_RESUME.appearance); render(); scheduleSave();
    });
    $("#resetBtn").addEventListener("click", () => showModal("恢复初始内容？", "这会清除当前浏览器中的文字修改和照片调整。", () => { state = clone(window.INITIAL_RESUME); localStorage.removeItem(STORAGE_KEY); render(); persist(); }));
    $("#photoResetBtn").addEventListener("click", () => { state.photo.scale = 1; state.photo.x = 0; state.photo.y = 0; applyPhotoTransform(); persist(); });
    $("#photoScale").addEventListener("input", event => { state.photo.scale = Number(event.target.value) / 100; applyPhotoTransform(); scheduleSave(); });
    $("#photoQuickRange").addEventListener("input", event => { state.photo.scale = Number(event.target.value) / 100; applyPhotoTransform(); scheduleSave(); });
    $("#photoInput").addEventListener("change", event => handlePhoto(event.target.files[0]));
    $("#markdownInput").addEventListener("change", event => event.target.files[0] && readFile(event.target.files[0], importMarkdown));
    $("#sourceResumeInput").addEventListener("change", event => convertSourceDocument(event.target.files[0]));
    $("#convertMdBtn").addEventListener("click", () => downloadConverted("md"));
    $("#convertJsonBtn").addEventListener("click", () => downloadConverted("json"));
    $("#modalCancel").addEventListener("click", () => closeModal(false));
    $("#modalConfirm").addEventListener("click", () => closeModal(true));
    $("#modal").addEventListener("click", event => { if (event.target.id === "modal") closeModal(false); });
    window.addEventListener("resize", checkOverflow);

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
    reader.onload = () => { state.photo = { src: reader.result, scale: 1, x: 0, y: 0 }; applyPhotoTransform(); $("#portraitImage").src = reader.result; persist(); };
    reader.readAsDataURL(file);
  }

  wireControls();
  render();
})();
