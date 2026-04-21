#!/usr/bin/env node
// fetch-jobs.js — Fetches TPM jobs via Adzuna API (free, no scraping needed)

const https = require('https');
const fs = require('fs');
const path = require('path');

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
  console.error('ERROR: ADZUNA_APP_ID and ADZUNA_APP_KEY environment variables are required');
  process.exit(1);
}

// Single broad query — scoring handles TPM-relevance filtering
const SEARCH_QUERIES = [
  'Product Manager'
];

// Profile keywords for match scoring
const PROFILE_KEYWORDS = [
  'cloud', 'infrastructure', 'platform', 'developer tools', 'data platform',
  'api', 'gcp', 'aws', 'kubernetes', 'terraform', 'b2b', 'enterprise',
  'saas', 'technical product manager', 'developer experience', 'devops',
  'sre', 'reliability', 'fintech', 'financial services', 'microservices',
  'distributed systems', 'observability', 'iac', 'data fabric'
];

function httpsRequest(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchFromAdzuna(query, page = 1) {
  const encodedQuery = encodeURIComponent(query);
  const path = `/v1/api/jobs/us/search/${page}?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodedQuery}&category=it-jobs&max_days_old=7&sort_by=date&full_time=1`;

  const res = await httpsRequest({
    hostname: 'api.adzuna.com',
    path,
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  console.log(`  HTTP ${res.status}`);
  if (res.status !== 200) {
    console.error(`  Response body: ${JSON.stringify(res.body)}`);
    throw new Error(`Adzuna API error ${res.status}`);
  }
  const count = res.body.count || 0;
  const returned = (res.body.results || []).length;
  console.log(`  API reports ${count} total results, returned ${returned}`);
  return res.body;
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
  const link = raw.redirect_url || raw.id || '';
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

async function fetchJobsForQuery(query) {
  try {
    console.log(`\nSearching: "${query}"`);
    const data = await fetchFromAdzuna(query);
    const results = data.results || [];
    console.log(`  Found: ${results.length} jobs`);
    return results.map(normalizeJob);
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('=== Job Fetch Started (Adzuna) ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Load existing jobs to preserve statuses
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

  // Fetch from all queries
  let allFetched = [];
  for (const query of SEARCH_QUERIES) {
    const jobs = await fetchJobsForQuery(query);
    allFetched = allFetched.concat(jobs);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate by link
  const seen = new Set();
  const unique = allFetched.filter(j => {
    if (!j.link || seen.has(j.link)) return false;
    seen.add(j.link);
    return true;
  });
  console.log(`\nUnique jobs: ${unique.length}`);

  // Score and filter
  const scored = unique.map(j => ({ ...j, match_score: scoreJob(j) }));
  const zeroScore = scored.filter(j => j.match_score === 0).length;
  console.log(`Zero-score jobs filtered out: ${zeroScore}`);
  const matched = scored
    .filter(j => j.match_score >= 1)
    .sort((a, b) => b.match_score - a.match_score);
  console.log(`Matched jobs (score >= 1): ${matched.length}`);

  // Restore statuses and resume links
  const processed = matched.map(job => {
    const existing = existingByLink[job.link];
    if (existing) {
      return { ...job, application_status: existing.application_status, resume_link: existing.resume_link };
    }
    return job;
  });

  // Merge keeping max 200 jobs
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
