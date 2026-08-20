"use server";

import { hashPassword } from "@/lib/auth";

export async function generarHash(_prevState: { hash?: string } | undefined, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!password) return { hash: "" };

  const hash = await hashPassword(password);
  return { hash };
}
