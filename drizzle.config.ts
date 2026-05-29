import { defineConfig } from 'drizzle-kit'
import { app } from 'electron'
import { join } from 'path'

// During drizzle-kit CLI usage (generate/migrate), use a local path.
// At runtime the app uses app.getPath('userData') + '/crm.sqlite'.
const dbPath =
  process.env.DRIZZLE_DB_PATH ?? join(process.cwd(), 'dev-crm.sqlite')

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath
  }
})
