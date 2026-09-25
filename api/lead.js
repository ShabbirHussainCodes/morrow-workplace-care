// POST /api/lead — validate, save, tag and draft a follow-up for a new enquiry.
// Runs as a Vercel Serverless Function. DATABASE_URL stays on the server.
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { validateLead, processLead } from "../assets/js/workflow.js";

const RETENTION_DAYS = 7;        // demo leads are deleted after this many days
const RATE_LIMIT = 5;            // max enquiries per IP ...
const RATE_WINDOW_MIN = 10;      // ... within this many minutes

function hashIp(req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  return createHash("sha256").update(`${process.env.IP_SALT || "morrow"}:${ip}`).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const input = typeof req.body === "object" && req.body ? req.body : {};

  // Honeypot: bots fill the hidden "website" field. Pretend success, save nothing.
  if (input.website) return res.status(200).json({ ok: true });

  const { data, errors } = validateLead(input);
  if (errors) return res.status(422).json({ errors });

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    return res.status(500).json({ error: "Server is not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const ipHash = hashIp(req);

    // Housekeeping: remove demo leads older than the retention window
    await sql`DELETE FROM leads WHERE created_at < now() - make_interval(days => ${RETENTION_DAYS})`;

    // Basic rate limit per hashed IP
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM leads
      WHERE ip_hash = ${ipHash}
        AND created_at > now() - make_interval(mins => ${RATE_WINDOW_MIN})`;
    if (count >= RATE_LIMIT) {
      return res.status(429).json({ error: "Too many enquiries. Please try again in a few minutes." });
    }

    const outcome = processLead(data);

    const [row] = await sql`
      INSERT INTO leads (
        full_name, email, company, space_type, timing, message,
        service, priority, tags, next_step, follow_up_subject, follow_up_body, status, ip_hash
      ) VALUES (
        ${data.fullName}, ${data.email}, ${data.company}, ${data.spaceType}, ${data.timing}, ${data.message},
        ${outcome.service}, ${outcome.priority}, ${JSON.stringify(outcome.tags)}::jsonb,
        ${outcome.nextStep}, ${outcome.followUp.subject}, ${outcome.followUp.body}, ${outcome.status}, ${ipHash}
      )
      RETURNING id`;

    return res.status(201).json({ id: row.id, ...outcome });
  } catch (err) {
    console.error("Failed to save lead:", err);
    return res.status(500).json({ error: "Could not save the enquiry" });
  }
}
