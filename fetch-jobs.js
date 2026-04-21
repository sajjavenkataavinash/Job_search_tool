#!/usr/bin/env node
// fetch-jobs.js — Fetches TPM jobs via Adzuna API (Node.js 20 native fetch)

const fs = require('fs');
const path = require('path');

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
  console.error('ERROR: ADZUNA_APP_ID and ADZUNA_APP_KEY environment variables are required');
  process.exit(1);
}

const SEARCH_QUERY = 'Product Manager';

const PROFILE_KEYWORDS = [
  'cloud', 'infrastructure', 'platform', 'developer tools', 'data platform',
  'api', 'gcp', 'aws', 'kubernetes', 'terraform', 'b2b', 'enterprise',
  'saas', 'technical product manager', 'developer experience', 'devops',
  'sre', 'reliability', 'fintech', 'financial services', 'microservices',
  'distributed systems', 'observability', 'iac', 'data fabric'
];

async function fetchFromAdzuna() {
  const encodedQuery = encodeURIComponent(SEARCH_QUERY);
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1` +
    `?app_id=${ADZUNA_APP_ID}` +
    `&app_key=${ADZUNA_APP_KEY}` +
    `&results_per_page=50` +
    `&title_only=${encodedQuery}` +
    `&category=it-jobs` +
    `&max_days_old=7` +
    `&sort_by=date` +
    `&full_time=1`;

  console.log(`Fetching: ${url.replace(ADZUNA_APP_KEY, '***')}`);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  console.log(`HTTP status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error(`API error response: ${text.substring(0, 300)}`);
    throw new Error(`Adzuna API returned ${res.status}`);
  }

  const data = await res.json();
  console.log(`API total count: ${data.count || 0}, returned: ${(data.results || []).length}`);
  return data.results || [];
}

function scoreJob(job) {
  const text = [
    job.title || '',
    job.description || '',
    (job.category && job.category.label) || '',
    (job.company && job.company.display_name) || ''
  ].join(' ').toLowerCase();

  return PROFILE_KEYWORDS.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

function normalizeJob(raw) {
  const company = raw.company?.display_name || 'Unknown Company';
  const location = raw.location?.display_name || 'United States';
  const link = raw.redirect_url || String(raw.id) || '';
  const postedDate = raw.created ? raw.created.split('T')[0] : new Date().toISOString().split('T')[0];

  return {
    id: `adzuna_${raw.id || Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    role: raw.title || 'Unknown Role',
    company,
    link,
    posted_date: postedDate,
    location,
    active: true,
    resume_link: '',
    application_status: 'Not Applied',
    match_score: 0,
    source: 'Adzuna',
    description_snippet: (raw.description || '').substring(0, 400)
  };
}

async function main() {
  console.log('=== Job Fetch Started (Adzuna) ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const jobsPath = path.join(__dirname, 'jobs.json');
  let existingData = { last_updated: '', jobs: [] };
  if (fs.existsSync(jobsPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
      console.log(`Loaded ${existingData.jobs.length} existing jobs`);
    } catch (e) {
      console.error('Could not load existing jobs.json:', e.message);
    }
  }

  const existingByLink = {};
  existingData.jobs.forEach(j => { if (j.link) existingByLink[j.link] = j; });

  const rawResults = await fetchFromAdzuna();

  // Score on raw data (field names differ after normalization)
  const scored = rawResults.map(raw => ({ raw, score: scoreJob(raw) }));
  const zeroCount = scored.filter(s => s.score === 0).length;
  console.log(`Zero-score (filtered out): ${zeroCount}`);

  const matched = scored
    .filter(s => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .map(s => ({ ...normalizeJob(s.raw), match_score: s.score }));
  console.log(`Matched (score >= 1): ${matched.length}`);

  if (matched.length > 0) {
    console.log('Top 3 matches:');
    matched.slice(0, 3).forEach(j => console.log(`  [${j.match_score}] ${j.role} @ ${j.company}`));
  }

  const processed = matched.map(job => {
    const existing = existingByLink[job.link];
    if (existing) {
      return { ...job, application_status: existing.application_status, resume_link: existing.resume_link };
    }
    return job;
  });

  const newLinks = new Set(processed.map(j => j.link));
  const oldToKeep = existingData.jobs
    .filter(j => !newLinks.has(j.link))
    .slice(0, 200 - processed.length);

  const finalJobs = [...processed, ...oldToKeep];

  const output = {
    last_updated: new Date().toISOString(),
    total_fetched_today: matched.length,
    jobs: finalJobs
  };

  fs.writeFileSync(jobsPath, JSON.stringify(output, null, 2));
  console.log(`Saved ${finalJobs.length} total jobs`);
  console.log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
