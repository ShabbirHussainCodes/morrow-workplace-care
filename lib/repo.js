// All SQL lives here. Every query is a tagged template over an injected `sql` function, so
// each interpolated value is sent as a bound parameter and never becomes part of the SQL
// text. Handlers receive a repo, which is how tests run them without a database.
//
// Public and admin reads are separate queries: the public one never selects a personal
// column, so personal data cannot reach a public response even by mistake.

const toOutcome = (row) => ({
  id: row.public_id,
  tags: row.tags,
  priority: row.priority,
  service: row.service,
  nextStep: row.next_step,
  followUp: { subject: row.follow_up_subject, body: row.follow_up_body },
  status: row.status,
});

export function createRepo(sql) {
  return {
    /**
     * Count one hit in the current fixed window for a bucket and return the new count.
     * One INSERT ... ON CONFLICT DO UPDATE statement, so concurrent requests cannot both
     * read the same old number (the old count-then-insert check could be raced).
     */
    async hitRateLimit(bucket, windowSeconds) {
      const rows = await sql`
        INSERT INTO rate_limits (bucket, window_start, count)
        VALUES (
          ${bucket},
          to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}),
          1
        )
        ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
        RETURNING count`;
      return rows[0].count;
    },

    /**
     * Save a lead. The unique submission_id makes a repeated submit land on the same lead:
     * the loser of a race inserts nothing and reads the winner's row instead (so a repeat can
     * never overwrite the attribution that was stored first).
     * `attribution` must already be sanitized; a missing value is stored as NULL.
     * Returns { created, outcome }.
     */
    async insertLead({ submissionId, data, outcome, attribution = {} }) {
      const inserted = await sql`
        INSERT INTO leads (
          submission_id, full_name, email, company, space_type, timing, message,
          service, priority, tags, next_step, follow_up_subject, follow_up_body, status,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, landing_page
        ) VALUES (
          ${submissionId}, ${data.fullName}, ${data.email}, ${data.company}, ${data.spaceType},
          ${data.timing}, ${data.message}, ${outcome.service}, ${outcome.priority},
          ${JSON.stringify(outcome.tags)}::jsonb, ${outcome.nextStep},
          ${outcome.followUp.subject}, ${outcome.followUp.body}, ${outcome.status},
          ${attribution.utm_source ?? null}, ${attribution.utm_medium ?? null},
          ${attribution.utm_campaign ?? null}, ${attribution.utm_term ?? null},
          ${attribution.utm_content ?? null}, ${attribution.referrer ?? null},
          ${attribution.landing_page ?? null}
        )
        ON CONFLICT (submission_id) DO NOTHING
        RETURNING public_id, tags, priority, service, next_step, follow_up_subject, follow_up_body, status`;
      if (inserted.length) return { created: true, outcome: toOutcome(inserted[0]) };

      const existing = await sql`
        SELECT public_id, tags, priority, service, next_step, follow_up_subject, follow_up_body, status
        FROM leads
        WHERE submission_id = ${submissionId}`;
      if (!existing.length) throw new Error("The lead for this submission is gone");
      return { created: false, outcome: toOutcome(existing[0]) };
    },

    /** Recent leads for the public monitor. No name, email, company, message or draft. */
    async listPublicLeads({ retentionDays, limit }) {
      const rows = await sql`
        SELECT public_id, created_at, priority, service, space_type, timing, status
        FROM leads
        WHERE created_at > now() - make_interval(days => ${retentionDays})
        ORDER BY created_at DESC
        LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.public_id, createdAt: r.created_at, priority: r.priority, service: r.service,
        spaceType: r.space_type, timing: r.timing, status: r.status,
      }));
    },

    /** Recent leads with full detail, for a signed-in admin only. */
    async listAdminLeads({ retentionDays, limit }) {
      const rows = await sql`
        SELECT public_id, created_at, full_name, email, company, space_type, timing, message,
               service, priority, tags, next_step, follow_up_subject, follow_up_body, status
        FROM leads
        WHERE created_at > now() - make_interval(days => ${retentionDays})
        ORDER BY created_at DESC
        LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.public_id, createdAt: r.created_at, name: r.full_name, email: r.email, company: r.company,
        spaceType: r.space_type, timing: r.timing, message: r.message, service: r.service,
        priority: r.priority, tags: r.tags, nextStep: r.next_step,
        followUp: { subject: r.follow_up_subject, body: r.follow_up_body }, status: r.status,
      }));
    },

    /** Move a lead to another stage. Returns { id, status }, or null when no lead has that id. */
    async updateStage(publicId, status) {
      const rows = await sql`
        UPDATE leads SET status = ${status}
        WHERE public_id = ${publicId}
        RETURNING public_id, status`;
      return rows.length ? { id: rows[0].public_id, status: rows[0].status } : null;
    },

    /** Delete leads older than the retention window. Returns how many were removed. */
    async deleteExpiredLeads(retentionDays) {
      const rows = await sql`
        WITH removed AS (
          DELETE FROM leads
          WHERE created_at < now() - make_interval(days => ${retentionDays})
          RETURNING 1
        )
        SELECT count(*)::int AS count FROM removed`;
      return rows[0].count;
    },

    /** Delete rate-limit windows that ended long ago. Returns how many were removed. */
    async pruneRateLimits(olderThanHours) {
      const rows = await sql`
        WITH removed AS (
          DELETE FROM rate_limits
          WHERE window_start < now() - make_interval(hours => ${olderThanHours})
          RETURNING 1
        )
        SELECT count(*)::int AS count FROM removed`;
      return rows[0].count;
    },
  };
}
