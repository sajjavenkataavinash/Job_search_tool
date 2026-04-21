#!/usr/bin/env node
// fetch-jobs.js — Called by GitHub Actions daily to fetch TPM jobs via Apify

const https = require('https');
const fs = require('fs');
const path = require('path');

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const LINKEDIN_ACTOR_ID = 'bebity~linkedin-jobs-scraper';

if (!APIFY_TOKEN) {
  console.error('ERROR: APIFY_API_TOKEN environment variable is required');
  process.exit(1);
}

// Search queries tailored for Avinash's TPM profile
const SEARCH_QUERIES = [
  'Technical Product Manager cloud infrastructure',
  'Platform Product Manager developer tools',
  'Senior Product Manager data platform',
  'Technical Product Manager API platform enterprise'
];

// Profile keywords for match scoring
const PROFILE_KEYWORDS = [
  'cloud', 'infrastructure', 'platform', 'developer tools', 'data platform',
  'api', 'gcp', 'aws', 'kubernetes', 'terraform', 'b2b', 'enterprise',
  'saas', 'technical product manager', 'developer experience', 'devops',
  'sre', 'reliability', 'fintech', 'financial services', 'data fabric',
  'microservices', 'distributed systems', 'observability', 'iac'
];

function httpsRequest(options, body = null) {
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
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function startApifyRun(actorId, input) {
  const inputStr = JSON.stringify(input);
  const res = await httpsRequest({
    hostname: 'api.apify.com',
    path: `/v2/acts/${actorId}/runs?token=${APIFY_TOKEN}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(inputStr)
    }
  }, inputStr);
  if (res.status !== 201) throw new Error(`Failed to start actor: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function waitForRun(runId, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 8000));
    const res = await httpsRequest({
      hostname: 'api.apify.com',
      path: `/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`,
      method: 'GET'
    });
    const status = res.body.data?.status;
    console.log(`  Run status: ${status}`);
    if (status === 'SUCCEEDED') return res.body.data;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) throw new Error(`Run ended with status: ${status}`);
  }
  throw new Error('Run timed out waiting for completion');
}

async function getDatasetItems(datasetId) {
  const res = await httpsRequest({
    hostname: 'api.apify.com',
    path: `/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&limit=100`,
    method: 'GET'
  });
  return Array.isArray(res.body) ? res.body : [];
}

function buildLinkedInUrl(query) {
  const encoded = encodeURIComponent(query);
  // f_TPR=r86400 = last 24 hours, f_E=4 = Senior level, sortBy=DD = date descending
  return `https://www.linkedin.com/jobs/search/?keywords=${encoded}&location=United%20States&f_TPR=r86400&f_E=4&sortBy=DD`;
}

function scoreJob(job) {
  const text = `${job.title || ''} ${job.description || ''} ${job.company || ''}`.toLowerCase();
  return PROFILE_KEYWORDS.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

function normalizeJob(raw) {
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role: raw.title || raw.position || raw.jobTitle || 'Unknown Role',
    company: raw.companyName || raw.company || raw.employer || 'Unknown Company',
    link: raw.jobUrl || raw.url || raw.applyUrl || '',
    posted_date: raw.postedAt || raw.publishedAt || raw.datePosted || new Date().toISOString().split('T')[0],
    location: raw.location || raw.jobLocation || 'United States',
    active: true,
    resume_link: '',
    application_status: 'Not Applied',
    match_score: 0,
    source: 'LinkedIn',
    description_snippet: (raw.description || '').substring(0, 400)
  };
}

async function fetchForQuery(query) {
  try {
    console.log(`\nSearching: "${query}"`);
    const run = await startApifyRun(LINKEDIN_ACTOR_ID, {
      searchUrl: buildLinkedInUrl(query),
      maxJobs: 25
    });
    console.log(`  Run ID: ${run.id}`);
    const completed = await waitForRun(run.id);
    const items = await getDatasetItems(completed.defaultDatasetId);
    console.log(`  Retrieved: ${items.length} jobs`);
    return items.map(normalizeJob);
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('=== Job Fetch Started ===');
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

  // Preserve user's application statuses and resume links by job link
  const existingByLink = {};
  existingData.jobs.forEach(j => { if (j.link) existingByLink[j.link] = j; });

  // Fetch from all queries
  let allFetched = [];
  for (const query of SEARCH_QUERIES) {
    const jobs = await fetchForQuery(query);
    allFetched = allFetched.concat(jobs);
    await new Promise(r => setTimeout(r, 2000)); // Small delay between runs
  }

  // Deduplicate by link
  const seen = new Set();
  const unique = allFetched.filter(j => {
    if (!j.link || seen.has(j.link)) return false;
    seen.add(j.link);
    return true;
  });
  console.log(`\nUnique jobs fetched: ${unique.length}`);

  // Score and filter — only keep well-matched jobs (score >= 2)
  const matched = unique
    .map(j => ({ ...j, match_score: scoreJob(j) }))
    .filter(j => j.match_score >= 2)
    .sort((a, b) => b.match_score - a.match_score);
  console.log(`Matched jobs (score >= 2): ${matched.length}`);

  // Restore statuses and resume links from existing data
  const processed = matched.map(job => {
    const existing = existingByLink[job.link];
    if (existing) {
      return {
        ...job,
        application_status: existing.application_status,
        resume_link: existing.resume_link
      };
    }
    return job;
  });

  // Merge: new jobs first, keep old ones up to 200 total
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
  console.log(`\nSaved ${finalJobs.length} total jobs`);
  console.log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
