#!/usr/bin/env node
// generate-resume.js — Tailors resume using Claude Haiku
// Usage: node generate-resume.js --auto      (score>=7 jobs without resume)
//        node generate-resume.js <job_id>    (specific job)

const fs   = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const jobsPath    = path.join(__dirname, 'jobs.json');
const templatePath= path.join(__dirname, 'resume-template.html');
const resumesDir  = path.join(__dirname, 'resumes');

if (!fs.existsSync(resumesDir)) fs.mkdirSync(resumesDir, { recursive: true });

// ── Base resume content (for Claude context only) ──
const BASE_RESUME = `
SUMMARY
Technical Product Manager with 5+ years owning cloud infrastructure, internal developer platform, and enterprise data products at global scale. Proven track record driving measurable outcomes across both internal engineering platforms and external B2B customer-facing products, translating complex infrastructure constraints into scalable platform capabilities that protect revenue, accelerate delivery, and improve developer experience.

HIGHLIGHTS
- Redesigned Bigtable architecture to resolve a critical credit data API performance crisis, reducing latency 91% (5s → 450ms), protecting $100M+ in SLA exposure, and generating $5M in annual revenue across enterprise B2B customers.
- Conceived and shipped Admin Portal, a 0→1 self-service cloud infrastructure provisioning platform serving both internal engineering teams and external B2B enterprise customers globally, eliminating 95% of ServiceNow tickets and cutting customer onboarding time by 60% across 15+ teams.
- Led platform reliability strategy across 100+ internal teams, reducing MTTR 45% and increasing release velocity 80% via AI-automation without incident growth.

EXPERIENCE — Equifax, Technical Product Manager, Cloud Infrastructure & Data Platform (Feb 2020 – Nov 2025)
Owned product strategy and roadmap for the Equifax Data Fabric, a cloud-native enterprise data platform consolidating 250B+ records from 100+ previously siloed sources and serving 800M+ consumers across 24 global markets and 7 GCP regions. Delivered end-to-end product lifecycle across high-throughput data query APIs, self-service infrastructure tooling, and developer platforms for both internal engineering teams and external B2B enterprise customers.

API Performance & Revenue Protection:
- Eliminated a critical performance bottleneck in Equifax's highest-revenue credit data query API by redesigning Bigtable cluster architecture, reducing latency 91% from 5s to 450ms for millions of daily B2B enterprise queries.
- Protected $100M+ in SLA exposure by stabilizing API performance during a high-growth enterprise demand surge across financial institutions and lenders.
- Generated $5M in annual revenue by defining monetization strategy across upgraded enterprise Bigtable infrastructure tiers.
- Improved enterprise customer retention 40% by restoring SLA compliance and sustained 99.9% service availability on Google Cloud.

Self-Service Platform & Developer Productivity:
- Reduced infrastructure provisioning time 60% by owning 0→1 launch of self-service Admin Portal.
- Eliminated 95% of ServiceNow ticket volume and cut customer onboarding time by 60% by replacing manual provisioning workflows with a secure UI-based self-service platform.
- Improved delivery velocity 40% across 15+ engineering teams by defining reusable Kubernetes deployment standards and self-service infrastructure workflows.
- Reduced MTTR 45% by standardizing monitoring and on-call frameworks across 100+ engineering teams.
- Increased release velocity 80% without incident growth by leading cross-functional reliability readiness tradeoffs and introducing AI-assisted incident automation.
- Managed cloud infrastructure lifecycle across global platforms using Terraform (IaC), enabling consistent, auditable provisioning across GCP and AWS at scale.

EDUCATION: George Mason University · Master of Science, Computer Engineering

SKILLS
Product & Strategy: Platform & Infrastructure Products, 0→1 Product Builds, Roadmapping, OKRs & KPI Design, Go-to-Market Strategy, SLA Governance, Developer Experience (DX), B2B SaaS, Monetization Strategy
Cloud & Infrastructure: Google Cloud Platform (GCP), AWS, Kubernetes, Bigtable, BigQuery, API Design & Strategy, Observability & Monitoring, SLOs/SLIs, Infrastructure as Code (Terraform), Distributed Systems, Incident Management
Leadership & Execution: Cross-Functional Leadership, Stakeholder Alignment, Executive Communication, Release Planning, Tradeoff Management, Agile / Scrum
`;

// ── Call Claude Haiku ──
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

// ── Build final HTML by injecting tailored content into template ──
function buildHtml(tailored) {
  let html = fs.readFileSync(templatePath, 'utf8');

  // Strip any <li>/<\/li> Claude may have included before wrapping
  const stripLi = b => b.replace(/^\s*<li>/i, '').replace(/<\/li>\s*$/i, '').trim();
  const liItems = arr => arr.map(b => `          <li>${stripLi(b)}</li>`).join('\n');

  html = html.replace('{{SUMMARY_TEXT}}',    tailored.summary_text);
  html = html.replace('{{HIGHLIGHTS_ITEMS}}', liItems(tailored.highlights_items));
  html = html.replace('{{JOB_DESC}}',         tailored.job_desc);
  html = html.replace('{{GROUP1_TITLE}}',     tailored.group1_title);
  html = html.replace('{{GROUP1_BULLETS}}',   liItems(tailored.group1_bullets));
  html = html.replace('{{GROUP2_TITLE}}',     tailored.group2_title);
  html = html.replace('{{GROUP2_BULLETS}}',   liItems(tailored.group2_bullets));

  return html;
}

// ── Generate resume for one job ──
async function generateResume(job) {
  console.log(`  Generating: ${job.role} @ ${job.company}`);

  const jd = job.description_snippet || '(no description available)';

  const prompt = `You are helping tailor a resume for a specific job application. Your job is to lightly adjust specific sections so the resume better matches the job description — while keeping everything sounding natural and authentic, written in first person, not AI-generated.

STRICT RULES:
- Do NOT invent new achievements, skills, or experiences not in the base resume
- Keep ALL metrics exactly as-is (91%, $100M+, $5M, 60%, 95%, 45%, 80%, 40%)
- Only reorder bullets, subtly rephrase, or swap emphasis to match JD priorities
- Use <strong> tags only where the original resume uses them — do not over-bold
- Tone must sound like a real person wrote it, not an AI
- The job_desc field describes what I (Avinash) owned and delivered at Equifax — it is NOT about the target job. Write it in first person past tense ("Owned...", "Led...", "Delivered..."), based only on the base resume content. Lightly shift emphasis toward aspects of my Equifax experience that are most relevant to this JD, but it must always read as my actual experience at Equifax, never as a description of the job I am applying for
- highlights_items: pick the 3 most relevant highlights from the base resume for this JD
- group1 and group2: reorganize the existing bullets into two logical groups that fit this JD best

BASE RESUME:
${BASE_RESUME}

JOB TITLE: ${job.role}
COMPANY: ${job.company}
JOB DESCRIPTION EXCERPT:
${jd}

Return ONLY valid JSON, no markdown, no explanation. Array items must be plain text strings (no <li> tags — those are added automatically):
{
  "match_percentage": <integer 0-100>,
  "summary_text": "<p content — can use <strong> tags, 2-3 sentences>",
  "highlights_items": [
    "plain text bullet content, optional <strong> tags allowed",
    "plain text bullet content",
    "plain text bullet content"
  ],
  "job_desc": "<2-3 sentences in first person past tense describing what I owned/delivered at Equifax, NOT what the target job wants>",
  "group1_title": "<group title text>",
  "group1_bullets": ["plain text bullet content", "..."],
  "group2_title": "<group title text>",
  "group2_bullets": ["plain text bullet content", "..."]
}`;

  const raw = await callClaude(prompt);

  let tailored;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    tailored = JSON.parse(jsonMatch[0]);
    const required = ['summary_text','highlights_items','job_desc','group1_title','group1_bullets','group2_title','group2_bullets'];
    for (const f of required) {
      if (!tailored[f]) throw new Error(`Missing field: ${f}`);
    }
  } catch (e) {
    throw new Error(`Parse error: ${e.message}\nRaw: ${raw.substring(0, 300)}`);
  }

  const filename = `resume_${job.id}.html`;
  fs.writeFileSync(path.join(resumesDir, filename), buildHtml(tailored));

  console.log(`  Saved: resumes/${filename} (Match: ${tailored.match_percentage}%)`);
  return {
    resume_link:        `resumes/${filename}`,
    resume_match_score: tailored.match_percentage
  };
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
    console.log(`Auto mode: ${targets.length} job(s) queued (score >= 7, no resume yet)`);

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
