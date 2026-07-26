import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const DB_NAMES = {
  preview: "me-builder-db-preview",
  production: "me-builder-db-production",
};

const WRANGLER_FILES = [
  "packages/lib/wrangler.toml",
  "apps/worker/wrangler.toml",
  "apps/api/wrangler.toml",
  "apps/mcp/wrangler.toml",
];

async function getOrCreateDatabaseId(dbName: string): Promise<string> {
  console.log(`Checking DB: ${dbName}...`);
  try {
    // 既存のデータベースの情報を取得してみる
    const { stdout: infoOut } = await execAsync(`bunx wrangler d1 info ${dbName}`);
    const regex = new RegExp(`\\b${dbName}\\b\\s*│\\s*([a-f0-9-]+)`, "i");
    const match = infoOut.match(regex);
    if (match?.[1]) {
      console.log(`✅ Found existing database ${dbName} (ID: ${match[1]})`);
      return match[1];
    }
  } catch (error) {
    // エラーになる場合はまだ存在しない
  }

  console.log(`Creating new database ${dbName}...`);
  try {
    const { stdout: createOut } = await execAsync(`bunx wrangler d1 create ${dbName}`);
    const match = createOut.match(/database_id\s*=\s*"([a-f0-9-]+)"/i);
    if (match?.[1]) {
      console.log(`✅ Successfully created database ${dbName} (ID: ${match[1]})`);
      return match[1];
    }
    throw new Error(`Failed to parse UUID from create output: ${createOut}`);
  } catch (error) {
    console.error(`❌ Failed to create database ${dbName}:`, error);
    process.exit(1);
  }
}

async function main() {
  const previewId = await getOrCreateDatabaseId(DB_NAMES.preview);
  const productionId = await getOrCreateDatabaseId(DB_NAMES.production);

  console.log("\nUpdating wrangler.toml files...");

  const rootDir = path.resolve(__dirname, "..");

  for (const file of WRANGLER_FILES) {
    const filePath = path.join(rootDir, file);
    try {
      let content = await fs.readFile(filePath, "utf-8");
      let updated = false;

      // preview用のDBブロックを置換
      const previewRegex =
        /(database_name\s*=\s*"me-builder-db-preview"\s*\n\s*database_id\s*=\s*)"[^"]+"/g;
      if (previewRegex.test(content)) {
        content = content.replace(previewRegex, `$1"${previewId}"`);
        updated = true;
      }

      // production用のDBブロックを置換
      const prodRegex =
        /(database_name\s*=\s*"me-builder-db-production"\s*\n\s*database_id\s*=\s*)"[^"]+"/g;
      if (prodRegex.test(content)) {
        content = content.replace(prodRegex, `$1"${productionId}"`);
        updated = true;
      }

      if (updated) {
        await fs.writeFile(filePath, content, "utf-8");
        console.log(`✅ Updated ${file}`);
      } else {
        console.log(`- Skipped ${file} (no matching blocks or already up-to-date)`);
      }
    } catch (err) {
      console.log(`⚠️  Could not read ${file}, skipping.`);
    }
  }

  console.log("\n🎉 Setup complete! You can now run `task db:migrate:preview`.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
