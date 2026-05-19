/**
 * Scheduled Report Service
 * Run weekly via node-cron. Generates a summary PDF and emails it.
 * Install: npm install node-cron nodemailer pdfkit
 */

const cron     = require('node-cron');
const PDFDoc   = require('pdfkit');
const nodemailer = require('nodemailer');
const Agency   = require('../models/Agency');
const User     = require('../models/User');
const Guard    = require('../models/Guard');
const WelfareCall = require('../models/WelfareCall');
const Incident = require('../models/Incident');
const SOSAlert = require('../models/SOSAlert');
const Shift    = require('../models/Shift');

const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ── Build PDF buffer ───────────────────────────────────────────────────────────
async function buildReportPDF(agency, stats, from, to) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc    = new PDFDoc({ margin: 50, size: 'A4' });

    doc.on('data',  (c) => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('Grantsman Weekly Report', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(agency.name, { align: 'center' });
    doc.text(`${from.toDateString()} — ${to.toDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // KPIs
    const kpis = [
      ['Total shifts completed', stats.shiftsCompleted],
      ['Welfare calls answered',  `${stats.welfareAnswered} / ${stats.welfareTotal}`],
      ['Response rate',            `${stats.responseRate}%`],
      ['Average alertness score',  `${stats.avgAlertnessScore}%`],
      ['Incidents reported',       stats.incidentCount],
      ['SOS alerts',               stats.sosCount],
    ];

    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.moveDown(0.5);
    kpis.forEach(([label, val]) => {
      doc.fontSize(11).font('Helvetica').text(`${label}:  `, { continued: true });
      doc.font('Helvetica-Bold').text(String(val));
    });

    doc.moveDown(1.5);

    // Guard performance table
    doc.fontSize(14).font('Helvetica-Bold').text('Guard Performance');
    doc.moveDown(0.5);
    const cols = [0, 200, 320, 420];
    const headers = ['Guard', 'Shifts', 'Welfare score', 'Incidents'];
    headers.forEach((h, i) => {
      doc.fontSize(10).font('Helvetica-Bold').text(h, cols[i] + 50, doc.y, { width: 140, continued: i < 3 });
    });
    doc.moveDown(0.3);

    stats.guardRows.forEach((r) => {
      const y = doc.y;
      doc.fontSize(10).font('Helvetica')
        .text(r.name,           cols[0] + 50, y, { width: 140 })
        .text(String(r.shifts), cols[1] + 50, y, { width: 80 })
        .text(`${r.score}%`,    cols[2] + 50, y, { width: 80 })
        .text(String(r.incidents), cols[3] + 50, y, { width: 60 });
      doc.moveDown(0.4);
    });

    doc.end();
  });
}

// ── Gather stats for one agency ───────────────────────────────────────────────
async function gatherStats(agencyId, from, to) {
  const [
    shiftsCompleted, welfareTotal, welfareAnswered,
    incidentCount, sosCount, guards,
  ] = await Promise.all([
    Shift.countDocuments({ agencyId, status: 'completed', clockInTime: { $gte: from, $lte: to } }),
    WelfareCall.countDocuments({ agencyId, scheduledAt: { $gte: from, $lte: to } }),
    WelfareCall.countDocuments({ agencyId, status: 'answered', scheduledAt: { $gte: from, $lte: to } }),
    Incident.countDocuments({ agencyId, reportedAt: { $gte: from, $lte: to } }),
    SOSAlert.countDocuments({ agencyId, triggeredAt: { $gte: from, $lte: to } }),
    Guard.find({ agencyId }),
  ]);

  const responseRate     = welfareTotal > 0 ? Math.round((welfareAnswered / welfareTotal) * 100) : 100;
  const avgAlertnessScore = guards.length
    ? Math.round(guards.reduce((s, g) => s + (g.alertnessScore || 0), 0) / guards.length)
    : 0;

  const guardRows = await Promise.all(
    guards.map(async (g) => {
      const [shifts, incidents] = await Promise.all([
        Shift.countDocuments({ guardId: g._id, status: 'completed', clockInTime: { $gte: from, $lte: to } }),
        Incident.countDocuments({ guardId: g._id, reportedAt: { $gte: from, $lte: to } }),
      ]);
      return { name: g.name, shifts, score: g.alertnessScore || 0, incidents };
    })
  );

  return { shiftsCompleted, welfareTotal, welfareAnswered, responseRate, avgAlertnessScore, incidentCount, sosCount, guardRows };
}

// ── Send report to agency admins ──────────────────────────────────────────────
async function sendReportForAgency(agency, from, to) {
  const admins = await User.find({ agencyId: agency._id, role: 'agency-admin', isActive: true });
  if (!admins.length) return;

  const stats  = await gatherStats(agency._id, from, to);
  const pdf    = await buildReportPDF(agency, stats, from, to);

  const emails = admins.map((a) => a.email).join(',');

  await mailer.sendMail({
    from:    `"Grantsman" <${process.env.SMTP_FROM || 'reports@grantsman.app'}>`,
    to:      emails,
    subject: `Weekly Security Report — ${agency.name}`,
    text:    `Your weekly report for ${from.toDateString()} to ${to.toDateString()} is attached.`,
    attachments: [{ filename: 'weekly-report.pdf', content: pdf, contentType: 'application/pdf' }],
  });

  console.log(`[Reports] Sent weekly report to ${emails} for agency ${agency.name}`);
}

// ── Scheduler: every Monday at 07:00 ──────────────────────────────────────────
function startReportScheduler() {
  cron.schedule('0 7 * * 1', async () => {
    console.log('[Reports] Generating weekly reports...');
    const now  = new Date();
    const to   = new Date(now); to.setDate(now.getDate() - 1); to.setHours(23, 59, 59, 999);
    const from = new Date(to);  from.setDate(to.getDate() - 6); from.setHours(0, 0, 0, 0);

    const agencies = await Agency.find({ status: 'active' });
    for (const agency of agencies) {
      try {
        await sendReportForAgency(agency, from, to);
      } catch (err) {
        console.error(`[Reports] Failed for ${agency.name}:`, err.message);
      }
    }
  });
  console.log('[Reports] Scheduled weekly report job registered (Mon 07:00)');
}

module.exports = { startReportScheduler, sendReportForAgency };