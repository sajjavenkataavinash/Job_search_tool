# Job Search Tracker — Venkata Avinash Sajja

A personal job search tracker that automatically fetches TPM roles from LinkedIn daily, scores them against my profile, and tracks application status — all in one dashboard.

**Live Dashboard:** [sajjavenkataavinash.github.io/Job_search_tool](https://sajjavenkataavinash.github.io/Job_search_tool)

---

## What It Does

- **Daily job fetch** — GitHub Actions runs every morning at 8 AM ET, pulls TPM job listings from LinkedIn via Apify (posted in last 24 hours, US only, senior level)
- **Profile matching** — Jobs are scored against keywords from my background (GCP, AWS, Kubernetes, Terraform, API, B2B, enterprise, data platform, etc.)
- **Application tracking** — Track status per job: Not Applied → Applied → In Interview → Rejected
- **Resume tracking** — Link tailored resumes stored in the `resumes/` folder to each job row

## How to Use

1. Open the dashboard
2. Click **Fetch New Jobs** to manually trigger a job fetch (or wait for the daily 8 AM ET run)
3. Browse matched jobs, click **View Job** to open the listing
4. Update **Application Status** per row using the dropdown — status is saved in your browser
5. When a tailored resume is ready, add the GitHub link to `jobs.json` under `resume_link` for that job

## Adding a Tailored Resume

1. Save the tailored RTF/PDF resume to the `resumes/` folder in this repo
2. Commit and push to GitHub
3. In `jobs.json`, find the job entry and set `resume_link` to the raw GitHub URL of the resume file
4. Commit and push — the dashboard will show the link automatically

## Setup

### Required GitHub Secret
Add your Apify API token as a repository secret:
- GitHub repo → Settings → Secrets and variables → Actions → New repository secret
- Name: `APIFY_API_TOKEN`
- Value: your Apify API token

### Enable GitHub Pages
- GitHub repo → Settings → Pages → Source: Deploy from branch → Branch: main → Folder: / (root)

## Stack
- Pure HTML/CSS/JS frontend (no framework)
- Node.js fetch script (`fetch-jobs.js`) for GitHub Actions
- Apify LinkedIn Jobs Scraper for job data
- GitHub Actions for daily automation
- GitHub Pages for hosting
- `jobs.json` as the data store

## Files
| File | Description |
|------|-------------|
| `index.html` | Dashboard UI |
| `style.css` | Styles |
| `main.js` | Dashboard logic |
| `fetch-jobs.js` | Job fetching script (runs in GitHub Actions) |
| `jobs.json` | Job data store (auto-updated daily) |
| `.github/workflows/fetch-jobs.yml` | GitHub Actions workflow |
| `resumes/` | Tailored resumes per job |
