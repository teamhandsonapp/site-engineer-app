// Prisma CLI config (db pull / migrate / studio). Not bundled into the Expo app.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // CLI commands must use the session pooler (5432), not the transaction pooler (6543).
  datasource: { url: env("DIRECT_URL") },
});
