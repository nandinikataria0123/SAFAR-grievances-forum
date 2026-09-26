// Pulls every grievance out of Supabase and writes a timestamped
// .xlsx, ready to hand-copy into IPGRS or share with the review team.
//
// Usage: npm install && npm run export
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env (copy
// .env.example to .env first and fill in both).
//
// Optional flag: --status=open (default) filters to one review
// status. Pass --status=all to export every row regardless of status.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import xlsx from "xlsx";
import { writeFileSync } from "node:fs";

// Keep these in sync with supabase/functions/whatsapp-webhook/lib/copy.ts.
// The bot stores ids (e.g. "payment_not_received"); this maps them
// back to the label a human should see in the sheet.
const REASON_LABELS = {
  payment_not_received: "Payment not received",
  account_blocked: "Sudden account block",
  unsafe_conditions: "Unsafe working conditions",
  harassment: "Harassment or discrimination",
  other_reason: "Other",
};

const PLATFORM_LABELS = {
  swiggy: "Swiggy",
  zomato: "Zomato",
  rapido: "Rapido",
  uber: "Uber",
  ola: "Ola",
  other_platform: "Other",
};

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

async function signPaths(supabase, paths) {
  const urls = [];
  for (const path of paths) {
    if (!path) continue;
    const { data, error } = await supabase.storage
      .from("evidence")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) {
      console.warn(`Could not sign ${path}:`, error.message);
      continue;
    }
    urls.push(data.signedUrl);
  }
  return urls;
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const statusArg = process.argv.find((a) => a.startsWith("--status="));
  const status = statusArg ? statusArg.split("=")[1] : "open";

  let query = supabase
    .from("grievances")
    .select("*")
    .eq("stage", "completed") // only fully answered conversations
    .order("created_at", { ascending: true });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("Could not fetch grievances:", error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log(`No grievances found (status: ${status}). Nothing to export.`);
    return;
  }

  console.log(`Signing evidence links for ${rows.length} grievances...`);

  const sheetRows = [];
  for (const g of rows) {
    const evidenceUrls = await signPaths(supabase, g.evidence_urls ?? []);
    const [audioUrl] = g.audio_url ? await signPaths(supabase, [g.audio_url]) : [];

    sheetRows.push({
      "Reference": g.reference_code,
      "Submitted": new Date(g.created_at).toLocaleString("en-IN"),
      "Status": g.status,
      "Reason": REASON_LABELS[g.reason] ?? g.reason ?? "",
      "Platform": PLATFORM_LABELS[g.platform] ?? g.platform ?? "",
      "Description (English)": g.description_translated ?? "",
      "Description (original)": g.description_original ?? "",
      "Original language": g.description_language ?? "",
      "Evidence links": evidenceUrls.join("\n"),
      "Voice note link": audioUrl ?? "",
      "Worker phone": g.wa_phone_number,
      "Worker WhatsApp name": g.wa_profile_name ?? "",
    });
  }

  const sheet = xlsx.utils.json_to_sheet(sheetRows);
  sheet["!cols"] = [
    { wch: 12 }, // Reference
    { wch: 18 }, // Submitted
    { wch: 10 }, // Status
    { wch: 22 }, // Reason
    { wch: 12 }, // Platform
    { wch: 50 }, // Description (English)
    { wch: 50 }, // Description (original)
    { wch: 14 }, // Original language
    { wch: 40 }, // Evidence links
    { wch: 40 }, // Voice note link
    { wch: 16 }, // Worker phone
    { wch: 20 }, // Worker WhatsApp name
  ];

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, "Grievances");

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `safar-grievances-${stamp}.xlsx`;
  xlsx.writeFile(workbook, filename);

  console.log(`Wrote ${sheetRows.length} rows to ${filename}`);
  console.log("Evidence and voice note links expire in 7 days. Re-run the export if they lapse.");
}

main();
