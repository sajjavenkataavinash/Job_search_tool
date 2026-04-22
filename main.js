// main.js — Job Search Tracker Dashboard

const GITHUB_ACTIONS_URL = 'https://github.com/sajjavenkataavinash/Job_search_tool/actions/workflows/fetch-jobs.yml';

let allJobs = [];
let filteredJobs = [];

// ── Persist application statuses in localStorage ──
function loadStatuses() {
  try { return JSON.parse(localStorage.getItem('job_statuses') || '{}'); }
  catch { return {}; }
}

function saveStatus(jobLink, status) {
  const statuses = loadStatuses();
  statuses[jobLink] = status;
  localStorage.setItem('job_statuses', JSON.stringify(statuses));
}

// ── Status config ──
const STATUS_CONFIG = {
  'Not Applied': { color: '#475569', border: '#cbd5e1', bg: '#f1f5f9' },
  'Applied':     { color: '#1d4ed8', border: '#93c5fd', bg: '#dbeafe' },
  'In Interview':{ color: '#065f46', border: '#6ee7b7', bg: '#d1fae5' },
  'Rejected':    { color: '#991b1b', border: '#fca5a5', bg: '#fee2e2' }
};

// ── Helpers ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

function matchBadge(score) {
  if (score >= 6) return `<span class="badge badge-high">${score} ★★★</span>`;
  if (score >= 3) return `<span class="badge badge-med">${score} ★★</span>`;
  return `<span class="badge badge-low">${score} ★</span>`;
}

// ── Render table ──
function renderTable() {
  const tbody = document.getElementById('jobsTableBody');
  const emptyState = document.getElementById('emptyState');
  const statuses = loadStatuses();

  if (filteredJobs.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  tbody.innerHTML = filteredJobs.map((job) => {
    const status = statuses[job.link] || job.application_status || 'Not Applied';
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Not Applied'];
    const resumeLink = job.resume_link || '';

    return `
      <tr class="job-row">
        <td class="col-role">
          <div class="role-name">${escapeHtml(job.role)}</div>
          <div class="role-meta">${escapeHtml(job.source || 'LinkedIn')} · ${escapeHtml(job.location || 'US')}</div>
        </td>
        <td class="col-company">${escapeHtml(job.company)}</td>
        <td class="col-date">${formatDate(job.posted_date)}</td>
        <td class="col-match">${matchBadge(job.match_score || 0)}</td>
        <td class="col-active">
          <span class="active-badge ${job.active ? 'active-yes' : 'active-no'}">
            ${job.active ? 'Active' : 'Closed'}
          </span>
        </td>
        <td class="col-link">
          ${job.link
            ? `<a href="${escapeHtml(job.link)}" target="_blank" rel="noopener" class="job-link-btn">View Job →</a>`
            : '—'}
        </td>
        <td class="col-resume">
          ${resumeLink
            ? `<a href="${escapeHtml(resumeLink)}" target="_blank" rel="noopener" class="resume-link">View Resume</a>`
            : `<span class="resume-pending">—</span>`}
        </td>
        <td class="col-status">
          <select class="status-select"
            data-link="${escapeHtml(job.link)}"
            style="color:${cfg.color};border-color:${cfg.border};background:${cfg.bg}"
            onchange="updateStatus(this)">
            ${Object.keys(STATUS_CONFIG).map(s =>
              `<option value="${s}" ${s === status ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Update status ──
function updateStatus(select) {
  saveStatus(select.dataset.link, select.value);
  const cfg = STATUS_CONFIG[select.value] || STATUS_CONFIG['Not Applied'];
  select.style.color = cfg.color;
  select.style.borderColor = cfg.border;
  select.style.background = cfg.bg;
  updateStats();
}

// ── Update stats bar ──
function updateStats() {
  const statuses = loadStatuses();
  const getStatus = j => statuses[j.link] || j.application_status || 'Not Applied';

  const now = new Date();
  const todayCount = allJobs.filter(j => {
    if (!j.posted_date) return false;
    return (now - new Date(j.posted_date)) < 24 * 60 * 60 * 1000;
  }).length;

  document.getElementById('statTotal').textContent = allJobs.length;
  document.getElementById('statToday').textContent = todayCount;
  document.getElementById('statApplied').textContent = allJobs.filter(j => getStatus(j) === 'Applied').length;
  document.getElementById('statInterview').textContent = allJobs.filter(j => getStatus(j) === 'In Interview').length;
  document.getElementById('statRejected').textContent = allJobs.filter(j => getStatus(j) === 'Rejected').length;
}

// ── Apply filters ──
function applyFilters() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const statusFilter = document.getElementById('statusFilter').value;
  const sourceFilter = document.getElementById('sourceFilter').value;
  const matchFilter  = document.getElementById('matchFilter').value;
  const sortBy       = document.getElementById('sortBy').value;
  const statuses     = loadStatuses();

  filteredJobs = allJobs.filter(job => {
    const matchSearch = !search ||
      (job.role || '').toLowerCase().includes(search) ||
      (job.company || '').toLowerCase().includes(search) ||
      (job.location || '').toLowerCase().includes(search);

    const jobStatus = statuses[job.link] || job.application_status || 'Not Applied';
    const matchStatus  = !statusFilter || jobStatus === statusFilter;
    const matchSource  = !sourceFilter || (job.source || '') === sourceFilter;

    const score = job.match_score || 0;
    const matchScore =
      !matchFilter           ? true :
      matchFilter === 'high' ? score >= 6 :
      matchFilter === 'med'  ? score >= 3 && score < 6 :
      matchFilter === 'low'  ? score >= 1 && score < 3 : true;

    return matchSearch && matchStatus && matchSource && matchScore;
  });

  if (sortBy === 'date') {
    filteredJobs.sort((a, b) => new Date(b.posted_date) - new Date(a.posted_date));
  } else {
    filteredJobs.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
  }

  document.getElementById('resultCount').textContent = `${filteredJobs.length} job${filteredJobs.length !== 1 ? 's' : ''}`;
  renderTable();
}

// ── Load jobs from jobs.json ──
async function loadJobs() {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('errorMsg');

  loadingEl.style.display = 'block';
  errorEl.style.display = 'none';

  try {
    const res = await fetch(`jobs.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    allJobs = data.jobs || [];

    if (data.last_updated) {
      document.getElementById('lastUpdated').textContent =
        `Last updated: ${new Date(data.last_updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })}`;
    } else {
      document.getElementById('lastUpdated').textContent = 'No jobs fetched yet — run the workflow to start';
    }

    filteredJobs = [...allJobs];
    updateStats();
    applyFilters();

  } catch (err) {
    errorEl.textContent = 'Could not load jobs.json. Make sure GitHub Pages is enabled and the file exists.';
    errorEl.style.display = 'block';
    allJobs = [];
    filteredJobs = [];
    updateStats();
  } finally {
    loadingEl.style.display = 'none';
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadJobs();

  document.getElementById('searchInput').addEventListener('input', applyFilters);
  document.getElementById('statusFilter').addEventListener('change', applyFilters);
  document.getElementById('sourceFilter').addEventListener('change', applyFilters);
  document.getElementById('matchFilter').addEventListener('change', applyFilters);
  document.getElementById('sortBy').addEventListener('change', applyFilters);
  document.getElementById('refreshBtn').addEventListener('click', loadJobs);
  document.getElementById('fetchJobsBtn').addEventListener('click', () => {
    window.open(GITHUB_ACTIONS_URL, '_blank');
  });
});
