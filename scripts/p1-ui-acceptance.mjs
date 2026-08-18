// P1 UI acceptance (live Electron): Projects page, LeftRail badge, Mission
// Control project tasks, Live Work panel, and the orb runtime state.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');

// Create a project via the backend, select it.
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const stamp = Date.now().toString(36).slice(-5);
const created = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `UI Proj ${stamp}` }) });
const projId = created.body?.id;
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: projId }) });

// Navigate to Projects page.
await app.evaluate(() => { location.hash = '#/projects'; });
await sleep(8000);
const projectsUI = await app.evaluate(() => ({
  hasPage: !!document.body.innerText.includes('Projects'),
  hasProjectName: document.body.innerText.includes('UI Proj'),
  hasNewProjectBtn: !!document.body.innerText.includes('New Project'),
  activeCard: [...document.querySelectorAll('*')].some((el) => el.textContent === 'ACTIVE'),
}));
console.log('PROJECTS_UI ' + JSON.stringify(projectsUI));

// Navigate to Jarvis — check LeftRail shows the active project.
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);
const rail = await app.evaluate(() => {
  const nav = document.querySelector('[data-testid="nav-projects"]');
  const railText = document.body.innerText;
  return {
    hasProjectsNav: !!nav,
    navLabel: nav ? nav.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null,
    activeLabel: railText.includes('ACTIVE: UI Proj'),
  };
});
console.log('LEFTRAIL ' + JSON.stringify(rail));

// Navigate to Mission Control — check project badge + tasks section.
await app.evaluate(() => { location.hash = '#/mission-control'; });
await sleep(8000);
const mc = await app.evaluate(() => ({
  badge: !!document.querySelector('[data-testid="mission-active-project-badge"]'),
  badgeText: document.querySelector('[data-testid="mission-active-project-badge"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40) || null,
  projectTasksSection: !!document.querySelector('[data-testid="mission-project-tasks"]'),
  projectTasksText: document.querySelector('[data-testid="mission-project-tasks"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
  liveWork: !!document.querySelector('[data-testid="mission-live-work"]'),
}));
console.log('MISSION_CONTROL ' + JSON.stringify(mc));

// Cleanup.
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + projId, { method: 'DELETE' });
await browser.disconnect();
