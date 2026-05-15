/**
 * 大明新闻月报 — 华盛顿邮报风格渲染引擎
 */

const SECTION_ORDER = ['朝政要闻', '边关军事', '经济民生', '科举文教', '灾异志', '人事任免'];

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createArticleHTML(article, isLead = false) {
  const severityClass = article.severity || '';
  const badgeHTML = severityClass
    ? `<span class="severity-badge ${severityClass}">${severityClass === 'critical' ? '头条' : '要闻'}</span>`
    : '';
  const sourceDate = article.source_date ? `<span class="source-date">${escapeHTML(article.source_date)}</span>` : '';

  if (isLead) {
    return `
      <article class="lead-story" data-id="${escapeHTML(article.id)}">
        <div class="eyebrow">LEAD STORY</div>
        <h2 class="headline">${escapeHTML(article.headline)}${badgeHTML}</h2>
        ${article.subhead ? `<div class="subhead">${escapeHTML(article.subhead)}</div>` : ''}
        <div class="meta-row">
          <span class="dateline">${escapeHTML(article.dateline || '')}</span>
          ${article.byline ? `<span class="byline">${escapeHTML(article.byline)}</span>` : ''}
          ${sourceDate}
        </div>
        <div class="body">${escapeHTML(article.body || '')}</div>
      </article>`;
  }

  return `
    <article class="article" data-id="${escapeHTML(article.id)}">
      <h3 class="headline">${escapeHTML(article.headline)}${badgeHTML}</h3>
      ${article.subhead ? `<div class="subhead">${escapeHTML(article.subhead)}</div>` : ''}
      <div class="meta-row compact">
        <span class="dateline">${escapeHTML(article.dateline || '')}</span>
        ${sourceDate}
      </div>
      ${article.byline ? `<div class="byline">${escapeHTML(article.byline)}</div>` : ''}
      ${article.body ? `<div class="body">${escapeHTML(article.body)}</div>` : ''}
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
  const columns = [[], [], []];
  const counts = [0, 0, 0];
  for (const entry of sectionEntries) {
    let target = 0;
    if (counts[1] < counts[target]) target = 1;
    if (counts[2] < counts[target]) target = 2;
    columns[target].push(entry);
    counts[target] += entry.articles.length;
  }
  return columns;
}

function renderNewspaper(issue) {
  const content = document.getElementById('content');
  if (!content) return;

  const d = issue.date || {};
  const period = issue.period || {};

  document.getElementById('mingDate').textContent = `${d.ming_reign || ''}${d.ming_year || ''}年${d.ming_month || ''}月 · ${d.season || ''}季`;
  document.getElementById('emperorName').textContent = d.emperor || '';
  document.getElementById('realDate').textContent = d.real_date || '';
  document.getElementById('periodLabel').textContent = period.label || '';
  document.getElementById('periodRange').textContent = `${period.start_label || ''}—${period.end_label || ''}`;
  document.getElementById('issueNumber').textContent = period.issue_number ? `第 ${period.issue_number} 期` : '';
  document.title = `大明新闻月报 — ${period.label || `${d.ming_reign || ''}${d.ming_year || ''}年`}`;

  if (issue.editorial_note) {
    document.getElementById('footerNote').textContent = issue.editorial_note;
  }

  const lead = issue.lead || null;
  const sections = issue.sections || {};
  const sectionEntries = SECTION_ORDER
    .filter(name => Array.isArray(sections[name]) && sections[name].length > 0)
    .map(name => ({ name, articles: sections[name] }));

  if (!lead && sectionEntries.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">📰</div>
        <p>本季度暂无可编排的历史记录</p>
        <p style="font-size:12px;margin-top:8px;color:#999;">
          当前期次：${escapeHTML(period.label || '')}<br>
          时间范围：${escapeHTML(period.start_label || '')}—${escapeHTML(period.end_label || '')}
        </p>
      </div>`;
    return;
  }

  let html = '';
  if (lead) {
    html += `<section class="lead-wrap">${createArticleHTML(lead, true)}</section>`;
    html += '<hr class="section-rule">';
  }

  const columns = distributeSections(sectionEntries);
  html += '<div class="news-grid">';
  columns.forEach((columnSections, index) => {
    if (index > 0) html += '<div class="col-divider"></div>';
    html += '<div class="news-col">';
    if (columnSections.length === 0) {
      html += '<div class="article article-empty">（本栏无文章）</div>';
    } else {
      html += columnSections.map((entry, idx) => renderSection(entry.name, entry.articles, idx === 0)).join('');
    }
    html += '</div>';
  });
  html += '</div>';

  content.innerHTML = html;
}

function configuredIssueUrls() {
  const config = window.MING_POST_CONFIG || {};
  const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/+$/, '');
  const urls = [];

  if (apiBaseUrl) {
    urls.push(`${apiBaseUrl}/api/issue/latest`);
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
            请先运行 <code>python generate_news.py</code> 生成今日报纸<br>
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
