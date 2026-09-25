// GET   /api/leads            — list recent demo leads (emails masked, no IPs)
// PATCH /api/leads?id=123     — move a lead to another pipeline stage
import { neon } from "@neondatabase/serverless";
import { maskEmail, SPACE_TYPES, TIMINGS } from "../assets/js/workflow.js";

const RETENTION_DAYS = 7;
const STATUSES = ["New", "Walkthrough booked", "Proposal sent"];

export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    return res.status(500).json({ error: "Server is not configured" });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === "PATCH") {
      const id = Number.parseInt(req.query.id, 10);
      const status = req.body?.status;
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid lead id" });
      if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

      const rows = await sql`UPDATE leads SET status = ${status} WHERE id = ${id} RETURNING id, status`;
      if (!rows.length) return res.status(404).json({ error: "Lead not found" });
      return res.status(200).json(rows[0]);
    }

    // GET
    await sql`DELETE FROM leads WHERE created_at < now() - make_interval(days => ${RETENTION_DAYS})`;
    const rows = await sql`
      SELECT id, created_at, full_name, email, company, space_type, timing, message,
             service, priority, tags, next_step, follow_up_subject, follow_up_body, status
      FROM leads
      ORDER BY created_at DESC
      LIMIT 50`;

    const leads = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      name: r.full_name,
      email: maskEmail(r.email),            // never expose full emails publicly
      company: r.company,
      spaceType: SPACE_TYPES[r.space_type] || r.space_type,
      timing: TIMINGS[r.timing] || r.timing,
      message: r.message,
      service: r.service,
      priority: r.priority,
      tags: r.tags,
      nextStep: r.next_step,
      followUp: { subject: r.follow_up_subject, body: r.follow_up_body },
      status: r.status,
    }));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ leads, retentionDays: RETENTION_DAYS });
  } catch (err) {
    console.error("Leads API error:", err);
    return res.status(500).json({ error: "Could not load leads" });
  }
}
