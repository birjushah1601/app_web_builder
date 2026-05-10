"use server";

import { redirect } from "next/navigation";
import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";

export async function createProject(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const name = String(formData.get("name") ?? "untitled").trim() || "untitled";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const projectsRepo = new ProjectsRepo(pool);
  const project = await projectsRepo.create({ userId, name });

  redirect(`/projects/${project.projectId}/canvas?bootstrap=1&name=${encodeURIComponent(project.name)}`);
}
