/**
 * Threads Routes
 *
 * Connect/manage Threads accounts
 */

import express, { Response, Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { ThreadsClient, encryptCredential } from "@threadsponder/shared";

const router: Router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

const connectSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  username: z.string().optional(),
  expiresAt: z.string().optional(),
});

/**
 * GET /api/threads/accounts
 * List connected Threads accounts
 */
router.get("/accounts", async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data, error } = await getSupabase()
      .from("threads_accounts")
      .select(
        "id, threads_user_id, threads_username, is_active, token_expires_at, created_at",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ accounts: data || [] });
  } catch (error) {
    console.error("[Threads] Failed to list accounts:", error);
    res.status(500).json({ error: "Failed to list accounts" });
  }
});

/**
 * POST /api/threads/connect
 * Connect a Threads account (manual token paste)
 */
router.post("/connect", async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const parsed = connectSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const { accessToken, userId, username, expiresAt } = parsed.data;

    // Encrypt the token using shared AES-256-GCM
    const encryptedToken = encryptCredential(accessToken);
    if (!encryptedToken) {
      console.error(
        "[Threads] Failed to encrypt token - check CREDENTIAL_ENCRYPTION_KEY",
      );
      return res.status(500).json({ error: "Encryption configuration error" });
    }

    // Upsert the Threads account
    const { data, error } = await getSupabase()
      .from("threads_accounts")
      .upsert(
        {
          account_id: accountId,
          threads_user_id: userId,
          threads_username: username || null,
          access_token_encrypted: encryptedToken,
          token_expires_at: expiresAt || null,
          is_active: true,
        },
        {
          onConflict: "account_id,threads_user_id",
        },
      )
      .select("id, threads_user_id, threads_username, is_active")
      .single();

    if (error) throw error;

    res.json({ success: true, account: data });
  } catch (error) {
    console.error("[Threads] Failed to connect account:", error);
    res.status(500).json({ error: "Failed to connect account" });
  }
});

/**
 * DELETE /api/threads/accounts/:id
 * Disconnect a Threads account
 */
router.delete("/accounts/:id", async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    const { error } = await getSupabase()
      .from("threads_accounts")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("[Threads] Failed to disconnect account:", error);
    res.status(500).json({ error: "Failed to disconnect account" });
  }
});

/**
 * PATCH /api/threads/accounts/:id/toggle
 * Toggle account active status
 */
router.patch("/accounts/:id/toggle", async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    // Get current status
    const { data: current } = await getSupabase()
      .from("threads_accounts")
      .select("is_active")
      .eq("id", id)
      .eq("account_id", accountId)
      .single();

    if (!current) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Toggle it
    const { data, error } = await getSupabase()
      .from("threads_accounts")
      .update({ is_active: !current.is_active })
      .eq("id", id)
      .eq("account_id", accountId)
      .select("id, is_active")
      .single();

    if (error) throw error;

    res.json({ success: true, account: data });
  } catch (error) {
    console.error("[Threads] Failed to toggle account:", error);
    res.status(500).json({ error: "Failed to toggle account" });
  }
});

export default router;
