import { emit } from '../events.js';

export function initToolbar() {
  const toolbar = document.getElementById('toolbar');
  toolbar.innerHTML = `
    <div class="left">
      <div class="shape-menu" id="shapeMenu" aria-expanded="false">
        <button id="shapeMenuBtn" class="btn">ابزارها</button>
        <div class="shape-pop" id="shapePop">
          <button class="iconbtn" data-tool="select" title="انتخاب">S</button>
          <button class="iconbtn" data-tool="move" title="جابجایی">M</button>
          <button class="iconbtn" data-tool="line" title="خط">L</button>
          <button class="iconbtn" data-tool="quadratic" title="منحنی">Q</button>
          <button class="iconbtn" data-tool="rect" title="مستطیل">R</button>
          <button class="iconbtn" data-tool="ellipse" title="بیضی">E</button>
        </div>
      </div>
      <div class="seg">
        <button id="groupBtn" class="btn" title="گروه (Ctrl+G)">گروه</button>
        <button id="ungroupBtn" class="btn" title="لغو گروه (Ctrl+Shift+G)">لغو گروه</button>
      </div>
      <div class="seg">
        <label>چرخش° <input id="rotDeg" type="number" min="-360" max="360" step="1" class="btn" style="width:80px"></label>
      </div>
    </div>
    <div class="center">
      <label>ضخامت <input id="strokeWidth" class="btn" type="number" min="1" max="24" value="3" style="width:70px"></label>
      <span class="color"><label>رنگ خط</label><input id="strokeColor" type="color" value="#ffffff"/></span>
      <span class="color"><label>پرشدن</label>
        <select id="fillMode" class="btn">
          <option value="hollow">توخالی</option>
          <option value="solid" selected>توپر</option>
          <option value="fill">بدون خط</option>
        </select>
        <input id="fillColor" type="color" value="#66ccff"/>
      </span>
      <button id="undo" class="btn" title="واگرد (Ctrl+Z)">واگرد</button>
      <button id="redo" class="btn" title="از نو (Ctrl+Shift+Z)">از نو</button>
      <button id="apply" class="btn" title="ثبت (Enter)">اعمال</button>
    </div>
    <div class="right">
      <input id="fileInput" type="file" accept=".json" class="btn" title="بارگذاری JSON"/>
      <button id="saveJSON" class="btn primary" title="ذخیره LinePack+Anim">ذخیره JSON</button>
      <button id="saveJSONMin" class="btn" title="ذخیره کمینه">ذخیره کمینه</button>
      <button id="exportPNG" class="btn" title="PNG">PNG</button>
      <button id="clear" class="btn danger" title="پاک کردن همه">پاک کردن</button>
      <button id="helpBtn" class="help-btn" title="راهنما (H)">?</button>
    </div>
  `;

  const menu = document.getElementById('shapeMenu');

  // رخدادها
  toolbar.addEventListener('click', e => {
    const btn = e.target.closest('[data-tool]');
    if (btn) {
      emit('tool:change', btn.dataset.tool);
      menu.setAttribute('aria-expanded', 'false');
    }
  });
  document.getElementById('shapeMenuBtn').addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') === 'true';
    menu.setAttribute('aria-expanded', String(!open));
  });
}