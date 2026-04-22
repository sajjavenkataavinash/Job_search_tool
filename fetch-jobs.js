#!/usr/bin/env node
// fetch-jobs.js — Fetches TPM jobs via JSearch API (LinkedIn, Indeed, Glassdoor, ZipRecruiter)

const fs   = require('fs');
const path = require('path');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

if (!RAPIDAPI_KEY) {
  console.error('ERROR: RAPIDAPI_KEY environment variable is required');
  process.exit(1);
}

const PROFILE_KEYWORDS = [
  'cloud', 'infrastructure', 'platform', 'developer tools', 'data platform',
  'api', 'gcp', 'aws', 'kubernetes', 'terraform', 'b2b', 'enterprise',
  'saas', 'technical product manager', 'developer experience', 'devops',
  'sre', 'reliability', 'fintech', 'financial services', 'microservices',
  'distributed systems', 'observability', 'iac', 'data fabric'
];

async function fetchPage(page) {
  const url = new URL('https://jsearch.p.rapidapi.com/search');
  url.searchParams.set('query',           'Product Manager United States');
  url.searchParams.set('page',            String(page));
  url.searchParams.set('num_pages',       '1');
  url.searchParams.set('date_posted',     'week');
  url.searchParams.set('employment_types','FULLTIME');

  console.log(`Fetching page ${page}...`);
  const res = await fetch(url.toString(), {
    headers: {
      'X-RapidAPI-Key':  RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
    }
  });

  console.log(`  HTTP ${res.status}`);
  if (!res.ok) {
    const text = await res.text();
    console.error(`  Error response: ${text.substring(0, 300)}`);
    throw new Error(`JSearch API returned ${res.status}`);
  }

  const data = await res.json();
  const results = data.data || [];
  console.log(`  Page ${page}: ${results.length} jobs`);
  return results;
}

async function fetchAllJobs() {
  let all = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const results = await fetchPage(page);
      all = all.concat(results);
      if (results.length < 10) break; // no more pages
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  Skipping page ${page}: ${err.message}`);
      break;
    }
  }
  console.log(`Total raw results: ${all.length}`);
  return all;
}

function scoreJob(raw) {
  const text = [
    raw.job_title        || '',
    raw.job_description  || '',
    raw.employer_name    || '',
    raw.job_city         || '',
    raw.job_state        || ''
  ].join(' ').toLowerCase();

  return PROFILE_KEYWORDS.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

function normalizeJob(raw) {
  const city    = raw.job_city  || '';
  const state   = raw.job_state || '';
  const location = raw.job_is_remote
    ? 'Remote'
    : [city, state].filter(Boolean).join(', ') || 'United States';

  const postedDate = raw.job_posted_at_datetime_utc
    ? raw.job_posted_at_datetime_utc.split('T')[0]
    : new Date().toISOString().split('T')[0];

  return {
    id:                 `jsearch_${raw.job_id || Date.now()}`,
    role:               raw.job_title    || 'Unknown Role',
    company:            raw.employer_name || 'Unknown Company',
    link:               raw.job_apply_link || '',
    posted_date:        postedDate,
    location,
    active:             true,
    resume_link:        '',
    application_status: 'Not Applied',
    match_score:        0,
    source:             raw.job_publisher || 'JSearch',
    description_snippet:(raw.job_description || '').substring(0, 400)
  };
}

async function main() {
  console.log('=== Job Fetch Started (JSearch) ===');
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

  const rawResults = await fetchAllJobs();

  // Filter to PM titles only, exclude senior leadership levels
  const EXCLUDE_LEVELS = ['director', 'vice president', ' vp ', 'vp,', 'chief ', ' cpo', ' cto', 'head of', 'group manager'];
  const pmOnly = rawResults.filter(r => {
    const title = (r.job_title || '').toLowerCase();
    const isPM = title.includes('product manager') || title.includes('product owner');
    const isTooSenior = EXCLUDE_LEVELS.some(lvl => title.includes(lvl));
    return isPM && !isTooSenior;
  });
  console.log(`PM-title filtered: ${pmOnly.length}`);

  // Score on raw data, then normalize
  const scored = pmOnly.map(raw => ({ raw, score: scoreJob(raw) }));
  const zeroCount = scored.filter(s => s.score === 0).length;
  console.log(`Zero-score (filtered out): ${zeroCount}`);

  const matched = scored
    .filter(s => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .map(s => ({ ...normalizeJob(s.raw), match_score: s.score }));
  console.log(`Matched (score >= 1): ${matched.length}`);

  if (matched.length > 0) {
    console.log('Top 3 matches:');
    matched.slice(0, 3).forEach(j =>
      console.log(`  [${j.match_score}] ${j.role} @ ${j.company} (${j.source})`)
    );
  }

  // Deduplicate by link
  const seen = new Set();
  const unique = matched.filter(j => {
    if (!j.link || seen.has(j.link)) return false;
    seen.add(j.link);
    return true;
  });

  // Restore existing statuses and resume links
  const processed = unique.map(job => {
    const existing = existingByLink[job.link];
    return existing
      ? { ...job, application_status: existing.application_status, resume_link: existing.resume_link }
      : job;
  });

  // Merge with old jobs (keep up to 200 total), re-apply seniority filter to old entries too
  const isTooSenior = role => {
    const t = (role || '').toLowerCase();
    return ['director', 'vice president', ' vp ', 'vp,', 'chief ', ' cpo', ' cto', 'head of', 'group manager']
      .some(lvl => t.includes(lvl));
  };
  const newLinks  = new Set(processed.map(j => j.link));
  const oldToKeep = existingData.jobs
    .filter(j => !newLinks.has(j.link) && !isTooSenior(j.role))
    .slice(0, 200 - processed.length);

  const finalJobs = [...processed, ...oldToKeep];

  fs.writeFileSync(jobsPath, JSON.stringify({
    last_updated:       new Date().toISOString(),
    total_fetched_today: processed.length,
    jobs:               finalJobs
  }, null, 2));

  console.log(`Saved ${finalJobs.length} total jobs`);
  console.log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
