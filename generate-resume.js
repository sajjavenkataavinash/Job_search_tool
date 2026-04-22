#!/usr/bin/env node
// generate-resume.js — Generates tailored resumes using Claude Haiku
// Usage: node generate-resume.js --auto          (for all score>=7 jobs without a resume)
//        node generate-resume.js <job_id>        (for a specific job)

const fs   = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const jobsPath   = path.join(__dirname, 'jobs.json');
const basePath   = path.join(__dirname, 'resume-base.txt');
const resumesDir = path.join(__dirname, 'resumes');

if (!fs.existsSync(resumesDir)) fs.mkdirSync(resumesDir, { recursive: true });

// ── Parse header from resume-base.txt (first two lines = name, contact) ──
function parseBaseHeader(baseText) {
  const lines = baseText.split('\n').map(l => l.trim()).filter(Boolean);
  return {
    name:    lines[0] || '',
    contact: lines[1] || ''
  };
}

// ── Claude API call ──
async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ── Build HTML resume ──
function buildHtml(job, tailored, header) {
  const esc = s => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const bullets = (tailored.bullets || [])
    .map(b => `    <li>${esc(b)}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Resume — ${esc(job.role)} @ ${esc(job.company)}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Calibri',Arial,sans-serif;font-size:10.5pt;color:#1a1a1a;
         padding:0.25in 0.4in 0.2in 0.45in;max-width:8.5in}
    h1{font-size:18pt;font-weight:700}
    .contact{font-size:9.5pt;color:#444;margin-top:3px}
    hr{border:none;border-top:1.5px solid #1a6ea8;margin:7px 0}
    h2{font-size:10.5pt;font-weight:700;color:#1a6ea8;text-transform:uppercase;
       letter-spacing:.5px;margin-top:9px;margin-bottom:3px}
    .row{display:flex;justify-content:space-between;align-items:baseline;margin-top:5px}
    .bold{font-weight:700;font-size:10.5pt}
    .meta{font-size:9.5pt;color:#555}
    .sub{font-size:9.5pt;color:#555;margin-top:1px}
    p.summary{font-size:10pt;color:#222;line-height:1.45}
    ul{margin-left:15px;margin-top:4px}
    li{margin-bottom:3px;line-height:1.35;font-size:10pt;color:#222}
    .sgrid{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:9.5pt;margin-top:3px}
    .slabel{font-weight:700;white-space:nowrap}
    .note{font-size:8pt;color:#999;text-align:right;margin-top:6px}
  </style>
</head>
<body>

<h1>${esc(header.name)}</h1>
<div class="contact">${esc(header.contact)}</div>
<hr />

<h2>Professional Summary</h2>
<p class="summary">${esc(tailored.summary)}</p>

<h2>Experience</h2>
<div class="row">
  <span class="bold">Equifax &nbsp;|&nbsp; Senior Technical Product Manager</span>
  <span class="meta">Atlanta Metropolitan Area &nbsp;|&nbsp; Feb 2022 – Present</span>
</div>
<div class="sub">Contractor → Full-time · Feb 2022</div>
<ul>
${bullets}
</ul>

<h2>Education</h2>
<div class="row">
  <span class="bold">George Mason University</span>
  <span class="meta">Bachelor's Degree</span>
</div>

<h2>Skills</h2>
<div class="sgrid">
  <span class="slabel">Cloud &amp; Infra:</span>
  <span>GCP, AWS, Kubernetes, Terraform, IaC, Microservices, Distributed Systems</span>
  <span class="slabel">Product:</span>
  <span>Technical Product Management, Roadmap, OKRs, Agile/Scrum, API Design, B2B SaaS, Enterprise</span>
  <span class="slabel">Data &amp; Ops:</span>
  <span>Data Platform, Observability, Datadog, SRE, FinTech, Financial Services, Developer Experience</span>
</div>

<div class="note">Tailored for: ${esc(job.role)} @ ${esc(job.company)} &nbsp;|&nbsp; Resume Match: ${tailored.match_percentage}%</div>
</body>
</html>`;
}

// ── Generate resume for one job ──
async function generateResume(job) {
  console.log(`  Generating: ${job.role} @ ${job.company}`);

  const baseResume = fs.readFileSync(basePath, 'utf8');
  const header     = parseBaseHeader(baseResume);
  const jdSnippet  = job.description_snippet || '(no description available)';

  const prompt = `You are a professional resume tailor. Tailor this resume for a specific job application.

BASE RESUME:
${baseResume}

JOB TITLE: ${job.role}
COMPANY: ${job.company}
JOB DESCRIPTION EXCERPT:
${jdSnippet}

Instructions:
1. Write a tailored 2-3 sentence professional summary that mirrors the JD language and priorities.
2. Select and rewrite 7-9 bullet points from the base resume most relevant to this role.
   - Lead with the most impactful, relevant bullets first.
   - Naturally incorporate keywords from the JD where they fit.
   - Keep all metrics and specifics (91%, $100M+, 60%, etc.) intact.
3. Score the resume match percentage (0-100%) against the JD requirements.

Return ONLY valid JSON with no markdown or extra text:
{
  "match_percentage": <number 0-100>,
  "summary": "<tailored 2-3 sentence summary>",
  "bullets": ["<bullet 1>", "<bullet 2>", ...]
}`;

  const raw = await callClaude(prompt);

  let tailored;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    tailored = JSON.parse(jsonMatch[0]);
    if (!tailored.summary || !tailored.bullets) throw new Error('Missing required fields');
  } catch (e) {
    throw new Error(`Parse error: ${e.message}`);
  }

  const filename = `resume_${job.id}.html`;
  fs.writeFileSync(path.join(resumesDir, filename), buildHtml(job, tailored, header));

  console.log(`  Saved: resumes/${filename} (Match: ${tailored.match_percentage}%)`);
  return { resume_link: `resumes/${filename}`, resume_match_score: tailored.match_percentage };
}

// ── Main ──
async function main() {
  const args   = process.argv.slice(2);
  const isAuto = args.includes('--auto');
  const jobId  = args.find(a => !a.startsWith('--'));

  console.log('=== Resume Generator ===');

  const data = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const jobs = data.jobs || [];
  let generated = 0;

  if (isAuto) {
    const targets = jobs.filter(j => (j.match_score || 0) >= 7 && !j.resume_link);
    console.log(`Auto mode: ${targets.length} job(s) need resumes (score >= 7, no resume yet)`);

    for (const job of targets) {
      try {
        const result = await generateResume(job);
        const idx = jobs.findIndex(j => j.id === job.id);
        if (idx !== -1) {
          jobs[idx].resume_link        = result.resume_link;
          jobs[idx].resume_match_score = result.resume_match_score;
        }
        generated++;
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`  SKIP ${job.role}: ${err.message}`);
      }
    }

  } else if (jobId) {
    const job = jobs.find(j => j.id === jobId);
    if (!job) { console.error(`Job not found: ${jobId}`); process.exit(1); }

    try {
      const result = await generateResume(job);
      const idx = jobs.findIndex(j => j.id === jobId);
      jobs[idx].resume_link        = result.resume_link;
      jobs[idx].resume_match_score = result.resume_match_score;
      generated++;
    } catch (err) {
      console.error(`Error: ${err.message}`); process.exit(1);
    }

  } else {
    console.error('Usage: node generate-resume.js --auto  OR  node generate-resume.js <job_id>');
    process.exit(1);
  }

  if (generated > 0) {
    fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
    console.log(`\nUpdated jobs.json — ${generated} resume(s) generated`);
  }
  console.log('=== Done ===');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
