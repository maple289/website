import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    // Verify caller is authenticated
    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify caller is admin
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerData.user.id)
      .single();
    if (profileErr || !profile || profile.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const url = new URL(req.url);
    const method = req.method;

    // POST: create a new user
    if (method === "POST" && url.pathname.endsWith("/admin-users")) {
      const body = await req.json();
      const { email, password, role } = body;

      if (!email || !password) {
        return json({ error: "Email and password are required" }, 400);
      }
      if (password.length < 6) {
        return json({ error: "Password must be at least 6 characters" }, 400);
      }
      const assignedRole = role === "admin" ? "admin" : "user";

      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) {
        return json({ error: createErr.message }, 400);
      }

      // Upsert profile with the correct role
      await adminClient.from("profiles").upsert({
        id: newUser.user.id,
        email,
        role: assignedRole,
      });

      return json({ id: newUser.user.id, email, role: assignedRole });
    }

    // DELETE: remove a user
    if (method === "DELETE") {
      const userId = url.searchParams.get("id");
      if (!userId) {
        return json({ error: "User id is required" }, 400);
      }

      // Prevent self-deletion
      if (userId === callerData.user.id) {
        return json({ error: "You cannot delete your own account" }, 400);
      }

      const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
      if (delErr) {
        return json({ error: delErr.message }, 400);
      }

      // Profile row is removed by ON DELETE CASCADE
      return json({ success: true });
    }

    // PUT: edit a user's email and/or password
    if (method === "PUT" && url.pathname.endsWith("/admin-users")) {
      const body = await req.json();
      const { id, email, password } = body;

      if (!id) {
        return json({ error: "User id is required" }, 400);
      }

      const updateAttrs: Record<string, string> = {};
      if (email) updateAttrs.email = email;
      if (password) {
        if (password.length < 6) {
          return json({ error: "Password must be at least 6 characters" }, 400);
        }
        updateAttrs.password = password;
      }

      if (Object.keys(updateAttrs).length === 0) {
        return json({ error: "Nothing to update" }, 400);
      }

      const { data: updated, error: updateErr } = await adminClient.auth.admin.updateUserById(id, updateAttrs);
      if (updateErr) {
        return json({ error: updateErr.message }, 400);
      }

      // Sync email on the profile row if it changed
      if (email) {
        await adminClient.from("profiles").update({ email }).eq("id", id);
      }

      return json({ id: updated.user.id, email: updated.user.email });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
