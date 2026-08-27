import db from "../config/db.js";

export async function findAllPackages({
  activeOnly = true,
  packageType = null,
} = {}) {
  const values = [];
  const conditions = [];

  if (activeOnly) {
    conditions.push("is_active = true");
  }

  if (packageType) {
    values.push(packageType);
    conditions.push(`package_type = $${values.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query(
    `
      SELECT
        id,
        slug,
        category,
        name,
        description,
        full_description,
        media_type,
        media_src,
        thumbnail,
        features,
        extra_features,
        duration,
        delivery,
        price,
        popular,
        package_type,
        is_hourly,
        booking_config,
        is_active,
        duration_minutes,
        hourly_rate,
        created_at,
        updated_at
      FROM packages
      ${whereClause}
      ORDER BY id ASC
    `,
    values,
  );

  return result.rows;
}

export async function findPackageById(id) {
  const result = await db.query(
    `
      SELECT *
      FROM packages
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
}

export async function findPackageBySlug(slug) {
  const result = await db.query(
    `
      SELECT *
      FROM packages
      WHERE slug = $1
      LIMIT 1
    `,
    [slug],
  );

  return result.rows[0] || null;
}

export async function createPackage(data) {
  const result = await db.query(
    `
      INSERT INTO packages (
        slug,
        category,
        name,
        description,
        full_description,
        media_type,
        media_src,
        thumbnail,
        features,
        extra_features,
        duration,
        delivery,
        price,
        popular,
        package_type,
        is_hourly,
        booking_config,
        is_active,
        duration_minutes,
        hourly_rate
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb,
        $10::jsonb,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17::jsonb,
        $18,
        $19,
        $20
      )
      RETURNING *
    `,
    [
      data.slug,
      data.category,
      data.name,
      data.description,
      data.fullDescription || null,
      data.mediaType || null,
      data.mediaSrc || null,
      data.thumbnail || null,
      JSON.stringify(data.features || []),
      JSON.stringify(data.extraFeatures || []),
      data.duration || null,
      data.delivery || null,
      data.price ?? null,
      data.popular ?? false,
      data.packageType || "standard",
      data.isHourly ?? data.packageType === "hourly",
      JSON.stringify(data.bookingConfig || {}),
      data.isActive ?? true,
      data.durationMinutes ?? null,
      data.hourlyRate ?? null,
    ],
  );

  return result.rows[0];
}

export async function updatePackage(id, data) {
  const result = await db.query(
    `
      UPDATE packages
      SET
        slug = COALESCE($1, slug),
        category = COALESCE($2, category),
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        full_description = COALESCE($5, full_description),
        media_type = COALESCE($6, media_type),
        media_src = COALESCE($7, media_src),
        thumbnail = COALESCE($8, thumbnail),
        features = COALESCE($9::jsonb, features),
        extra_features = COALESCE($10::jsonb, extra_features),
        duration = COALESCE($11, duration),
        delivery = COALESCE($12, delivery),
        price = COALESCE($13, price),
        popular = COALESCE($14, popular),
        package_type = COALESCE($15, package_type),
        booking_config = COALESCE($16::jsonb, booking_config),
        is_active = COALESCE($17, is_active),
        is_hourly = COALESCE($18, is_hourly),
        duration_minutes = COALESCE($19, duration_minutes),
        hourly_rate = COALESCE($20, hourly_rate),
        updated_at = now()
      WHERE id = $21
      RETURNING *
    `,
    [
      data.slug ?? null,
      data.category ?? null,
      data.name ?? null,
      data.description ?? null,
      data.fullDescription ?? null,
      data.mediaType ?? null,
      data.mediaSrc ?? null,
      data.thumbnail ?? null,
      data.features !== undefined ? JSON.stringify(data.features) : null,
      data.extraFeatures !== undefined
        ? JSON.stringify(data.extraFeatures)
        : null,
      data.duration ?? null,
      data.delivery ?? null,
      data.price ?? null,
      data.popular ?? null,
      data.packageType ?? null,
      data.bookingConfig !== undefined
        ? JSON.stringify(data.bookingConfig)
        : null,
      data.isActive ?? null,
      data.isHourly ?? null,
      data.durationMinutes ?? null,
      data.hourlyRate ?? null,
      id,
    ],
  );

  return result.rows[0] || null;
}

export async function deletePackage(id) {
  const result = await db.query(
    `
      DELETE FROM packages
      WHERE id = $1
      RETURNING *
    `,
    [id],
  );

  return result.rows[0] || null;
}
