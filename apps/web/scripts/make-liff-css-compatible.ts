import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import postcss from "postcss";

const distDirectory = "dist";
const cssFiles = Array.from(
  new Bun.Glob("assets/*.css").scanSync({ cwd: distDirectory, absolute: true }),
);

if (cssFiles.length === 0) {
  throw new Error("CSS build artifact was not generated.");
}

const replacements = new Map<string, string>();

for (const file of cssFiles) {
  const root = postcss.parse(await Bun.file(file).text());

  root.walkAtRules("layer", (rule) => {
    if (rule.nodes) {
      rule.replaceWith(...rule.nodes);
    } else {
      rule.remove();
    }
  });

  const css = root.toString();
  const hash = new Bun.CryptoHasher("sha256").update(css).digest("hex").slice(0, 8);
  const compatibleFile = file.replace(/\.css$/, `-${hash}.css`);

  await Bun.write(compatibleFile, css);
  await unlink(file);
  replacements.set(basename(file), basename(compatibleFile));
}

const referenceFiles = new Set<string>();
for (const pattern of ["**/*.html", "**/*.js", "**/*.json", "**/*.webmanifest"]) {
  for (const file of new Bun.Glob(pattern).scanSync({ cwd: distDirectory, absolute: true })) {
    referenceFiles.add(file);
  }
}

for (const file of referenceFiles) {
  const original = await Bun.file(file).text();
  let updated = original;

  for (const [from, to] of replacements) {
    updated = updated.split(from).join(to);
  }

  if (updated !== original) await Bun.write(file, updated);
}
