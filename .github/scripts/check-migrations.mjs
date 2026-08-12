#!/usr/bin/env node
// check-migrations.mjs
//
// VastWorld M0 迁移文件基线检查。
// 运行：node .github/scripts/check-migrations.mjs
//
// 校验规则（RELEASE.md §4 "migration/RLS checks"）：
//   1. 文件名必须匹配 ^\d{14}_[a-z0-9_]+\.sql$ （14 位时间戳 + 下划线 + 小写描述）。
//   2. 时间戳必须严格递增（不允许重复或乱序）。
//   3. 文件必须非空（size > 0）。
//   4. 00xxxx_ 之前的序号不能缺失（宽松：仅检查连续性由时间戳保证）。
//   5. supabase/seed.sql 应存在（允许缺失，仅警告）。
//
// 退出码：0 通过；1 失败（并打印每条违规）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedPath = path.join(repoRoot, "supabase", "seed.sql");

const NAME_RE = /^\d{14}_[a-z0-9_]+\.sql$/;
const errors = [];
const warnings = [];
let sqlFiles = [];

if (!fs.existsSync(migrationsDir)) {
  errors.push(`migrations 目录不存在: ${path.relative(repoRoot, migrationsDir)}`);
} else {
  const entries = fs.readdirSync(migrationsDir).sort();
  sqlFiles = entries.filter((f) => f.endsWith(".sql"));

  if (sqlFiles.length === 0) {
    errors.push(`migrations 目录为空: ${path.relative(repoRoot, migrationsDir)}`);
  }

  let prevTs = "";
  for (const file of sqlFiles) {
    // 规则 1：命名格式
    if (!NAME_RE.test(file)) {
      errors.push(
        `非法文件名 "${file}" — 必须符合 NNYYYYMMDDHHMMSS_description.sql（14 位时间戳 + 小写描述）`,
      );
      continue;
    }

    // 规则 3：非空
    const full = path.join(migrationsDir, file);
    const stat = fs.statSync(full);
    if (stat.size === 0) {
      errors.push(`空迁移文件: ${file}`);
    }

    // 规则 2：时间戳严格递增
    const ts = file.slice(0, 14);
    if (prevTs && ts <= prevTs) {
      errors.push(
        `迁移时间戳未严格递增: "${file}" (${ts}) <= 前序 "${prevTs}"`,
      );
    }
    prevTs = ts;
  }
}

// 规则 5：seed.sql 检查（仅警告）
if (!fs.existsSync(seedPath)) {
  warnings.push(`未找到 ${path.relative(repoRoot, seedPath)}（将在本地/CI 种子阶段缺失）`);
}

const rel = (p) => path.relative(repoRoot, p);
console.log(`检查迁移目录: ${rel(migrationsDir)}`);

if (warnings.length) {
  for (const w of warnings) {
    console.warn(`[warn] ${w}`);
  }
}

if (errors.length) {
  console.error(`\n✗ 迁移检查失败，共 ${errors.length} 处违规：`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`✓ 迁移检查通过（共 ${sqlFiles.length} 个迁移文件，未发现违规）`);
process.exit(0);
