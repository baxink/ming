/**
 * 大明新闻季报 — 史料透明展示渲染引擎
 *
 * 设计原则：
 * - 保留既有报纸版式（报头、期号栏、栏线、印刷样式）
 * - 稀疏期次不再强排三栏空栏，按可用栏目数在 1–3 栏间自适应
 * - 每条标注内容类型、时间精度、核验状态与可定位出处
 * - 月份不详的年度记录以独立「年录」面板呈现
 * - 史料不足的期次如实说明，不以虚构内容填补版面
 */

const SECTION_ORDER = ['朝政要闻', '边关军事', '经济民生', '科举文教', '灾异志', '人事任免', '评论'];

const CONTENT_TYPE_LABELS = {
  historical_report: '史料报道',
  historical_digest: '史料辑要',
  historical_analysis: '史事分析',
  opinion: '评论',
};

const TIME_PRECISION_LABELS = {
  month: '月份可考',
  year: '年份可考',
  range: '跨月时段',
  unknown: '时间待考',
};

const SEVERITY_LABELS = {
  critical: '头条',
  major: '要闻',
};

const SOURCE_FALLBACK = '未提供可定位出处，待核验';
const VERIFIED_LABEL = '已核验';
const PENDING_VERIFICATION_LABEL = '待核验资料';

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function escapeHTML(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanArticleText(value) {
  return String(value || '').replace(/（《[^。！？]*$/g, '').trim();
}

function allowlistedLabel(map, raw) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  return hasOwn(map, key) ? map[key] : '';
}

function allowlistedKey(map, raw) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  return hasOwn(map, key) ? key : '';
}

function resolveVerification(raw) {
  if (raw === 'verified') {
    return { key: 'verified', label: VERIFIED_LABEL };
  }
  return { key: 'pending', label: PENDING_VERIFICATION_LABEL };
}

function sourceLabel(source) {
  if (typeof source === 'string') return source.trim();
  if (source && typeof source === 'object') {
    const candidate = source.label ?? source.title ?? source.name ?? source.id ?? '';
    return typeof candidate === 'string' ? candidate.trim() : '';
  }
  return '';
}

function articleTagsHTML(article) {
  const contentLabel = allowlistedLabel(CONTENT_TYPE_LABELS, article.content_type);
  const precisionLabel = allowlistedLabel(TIME_PRECISION_LABELS, article.time_precision);
  const verification = resolveVerification(article.verification_status);
  const tags = [];
  if (contentLabel) tags.push(`<span class="content-type-tag">${escapeHTML(contentLabel)}</span>`);
  if (precisionLabel) tags.push(`<span class="precision-tag">${escapeHTML(precisionLabel)}</span>`);
  tags.push(`<span class="verification-badge ${verification.key}">${escapeHTML(verification.label)}</span>`);
  return `<div class="article-tags">${tags.join('')}</div>`;
}

function sourceDetailsHTML(article) {
  const sources = (Array.isArray(article.sources) ? article.sources : [])
    .map(sourceLabel)
    .filter(Boolean);

  const listHTML = sources.length
    ? `<ul class="source-list">${sources.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
    : `<p class="source-fallback">${SOURCE_FALLBACK}</p>`;

  const excerptHTML = article.source_excerpt
    ? `<div class="source-sub"><div class="source-sub-title">原文摘录</div><p>${escapeHTML(article.source_excerpt)}</p></div>`
    : '';

  const editorialHTML = article.editorial_note
    ? `<div class="source-sub"><div class="source-sub-title">编者按</div><p>${escapeHTML(article.editorial_note)}</p></div>`
    : '';

  return `
    <details class="source-details">
      <summary>史料出处与核验</summary>
      <div class="source-panel">
        ${listHTML}
        ${excerptHTML}
        ${editorialHTML}
      </div>
    </details>`;
}

function contextBlockHTML(title, text) {
  if (!text) return '';
  return `<div class="context-block"><div class="context-title">${escapeHTML(title)}</div><div class="context-body">${escapeHTML(text)}</div></div>`;
}

function createArticleHTML(article, isLead = false) {
  const item = article || {};
  const severity = allowlistedKey(SEVERITY_LABELS, item.severity);
  const badgeHTML = severity
    ? `<span class="severity-badge ${severity}">${escapeHTML(SEVERITY_LABELS[severity])}</span>`
    : '';
  const sourceDate = item.source_date ? `<span class="source-date">${escapeHTML(item.source_date)}</span>` : '';
  const tags = articleTagsHTML(item);
  const background = contextBlockHTML('背景', item.background);
  const laterEffects = contextBlockHTML('后续影响', item.later_effects);
  const sourceDetails = sourceDetailsHTML(item);

  if (isLead) {
    return `
      <article class="lead-story" data-id="${escapeHTML(item.id)}">
        <div class="eyebrow">LEAD STORY</div>
        <h2 class="headline">${escapeHTML(item.headline)}${badgeHTML}</h2>
        ${item.subhead ? `<div class="subhead">${escapeHTML(item.subhead)}</div>` : ''}
        <div class="meta-row">
          <span class="dateline">${escapeHTML(item.dateline || '')}</span>
          ${item.byline ? `<span class="byline">${escapeHTML(item.byline)}</span>` : ''}
          ${sourceDate}
        </div>
        ${tags}
        <div class="body">${escapeHTML(cleanArticleText(item.body))}</div>
        ${background}
        ${laterEffects}
        ${sourceDetails}
      </article>`;
  }

  return `
    <article class="article" data-id="${escapeHTML(item.id)}">
      <h3 class="headline">${escapeHTML(item.headline)}${badgeHTML}</h3>
      ${item.subhead ? `<div class="subhead">${escapeHTML(item.subhead)}</div>` : ''}
      <div class="meta-row compact">
        <span class="dateline">${escapeHTML(item.dateline || '')}</span>
        ${sourceDate}
      </div>
      ${item.byline ? `<div class="byline">${escapeHTML(item.byline)}</div>` : ''}
      ${tags}
      ${item.body ? `<div class="body">${escapeHTML(cleanArticleText(item.body))}</div>` : ''}
      ${background}
      ${laterEffects}
      ${sourceDetails}
    </article>`;
}

function renderSection(name, articles, first = false) {
  if (!articles || articles.length === 0) return '';
  const items = articles.map(article => createArticleHTML(article, false)).join('');
  return `
    <section class="section-block">
      <div class="section-header ${first ? 'first' : ''}">${escapeHTML(name)}</div>
      ${items}
    </section>`;
}

function distributeSections(sectionEntries) {
  const entries = Array.isArray(sectionEntries) ? sectionEntries : [];
  if (entries.length === 0) return [];
  const columnCount = Math.min(3, entries.length);
  const columns = Array.from({ length: columnCount }, () => []);
  const counts = new Array(columnCount).fill(0);
  for (const entry of entries) {
    let target = 0;
    for (let i = 1; i < columnCount; i += 1) {
      if (counts[i] < counts[target]) target = i;
    }
    columns[target].push(entry);
    counts[target] += Array.isArray(entry.articles) ? entry.articles.length : 0;
  }
  return columns;
}

function renderAnnualPanel(annualEvents) {
  const events = (Array.isArray(annualEvents) ? annualEvents : [])
    .filter(event => event && typeof event === 'object');
  if (events.length === 0) return '';
  const items = events.map(event => createArticleHTML(event, false)).join('');
  return `
    <section class="annual-panel">
      <div class="annual-header">年录 · 月份不详</div>
      <p class="annual-caption">以下为仅可考见年份、无法系月的年度记录，与季度要闻分栏保存。</p>
      <div class="annual-list">${items}</div>
    </section>`;
}

function renderInsufficientMaterial(period) {
  const meta = period || {};
  return `
    <div class="empty-state insufficient">
      <div class="icon">📰</div>
      <div class="empty-title">本季度史料不足以刊行</div>
      <p>本季度暂无可供报道的史料记录，本报不以虚构内容填补版面。</p>
      <p class="empty-meta">
        当前期次：${escapeHTML(meta.label || '')}<br>
        时间范围：${escapeHTML(meta.start_label || '')}—${escapeHTML(meta.end_label || '')}
      </p>
    </div>`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderNewspaper(issue) {
  const content = document.getElementById('content');
  if (!content || !issue) return;

  const d = issue.date || {};
  const period = issue.period || {};

  setText('mingDate', `${d.ming_reign || ''}${d.ming_year || ''}年${d.ming_month || ''}月 · ${d.season || ''}季`);
  setText('emperorName', d.emperor || '');
  setText('realDate', d.real_date || '');
  setText('periodLabel', period.label || '');
  setText('periodRange', `${period.start_label || ''}—${period.end_label || ''}`);
  setText('issueNumber', period.issue_number ? `第 ${period.issue_number} 期` : '');
  document.title = `大明新闻季报 — ${period.label || `${d.ming_reign || ''}${d.ming_year || ''}年`}`;

  if (typeof issue.editorial_note === 'string' && issue.editorial_note) {
    setText('footerNote', issue.editorial_note);
  }

  const lead = issue.lead || null;
  const sections = issue.sections || {};
  const sectionEntries = SECTION_ORDER
    .filter(name => Array.isArray(sections[name]) && sections[name].length > 0)
    .map(name => ({ name, articles: sections[name] }));
  const annualEvents = Array.isArray(issue.annual_events) ? issue.annual_events : [];

  if (!lead && sectionEntries.length === 0 && annualEvents.length === 0) {
    content.innerHTML = renderInsufficientMaterial(period);
    return;
  }

  let html = '';
  if (lead) {
    html += `<section class="lead-wrap">${createArticleHTML(lead, true)}</section>`;
    html += '<hr class="section-rule">';
  }

  if (sectionEntries.length > 0) {
    const columns = distributeSections(sectionEntries);
    html += `<div class="news-grid cols-${columns.length}">`;
    columns.forEach((columnSections, index) => {
      if (index > 0) html += '<div class="col-divider"></div>';
      html += '<div class="news-col">';
      html += columnSections.map((entry, idx) => renderSection(entry.name, entry.articles, idx === 0)).join('');
      html += '</div>';
    });
    html += '</div>';
  }

  html += renderAnnualPanel(annualEvents);

  content.innerHTML = html;
}

function configuredIssueUrls() {
  const location = window.location || {};
  if (location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname)) {
    return ['data/issue.json'];
  }
  const config = window.MING_POST_CONFIG || {};
  const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/+$/, '');
  const urls = [];

  if (apiBaseUrl) {
    urls.push(`${apiBaseUrl}/api/issue/latest`);
    return urls;
  }

  urls.push('data/issue.json');
  return urls;
}

function fetchFirstAvailable(urls) {
  return urls.reduce((chain, url) => {
    return chain.catch(() => fetch(url).then(res => {
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    }));
  }, Promise.reject(new Error('No issue source configured')));
}

function loadIssue(urls) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p style="font-family: serif; color: #666;">正在排版本季度新闻…</p>
    </div>`;

  fetchFirstAvailable(urls)
    .then(issue => {
      renderNewspaper(issue);
    })
    .catch(err => {
      content.innerHTML = `
        <div class="empty-state">
          <div class="icon">📰</div>
          <p>报纸数据加载失败</p>
          <p style="font-size:12px;margin-top:8px;color:#999;">
            请检查数据源配置或本地预览数据<br>
            ${escapeHTML(err.message)}
          </p>
        </div>`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__MING_ISSUE__) {
    renderNewspaper(window.__MING_ISSUE__);
  } else {
    loadIssue(configuredIssueUrls());
  }
});
