const cssFiles = Array.from(new Bun.Glob("assets/*.css").scanSync({ cwd: "dist", absolute: true }));

if (cssFiles.length === 0) {
  throw new Error("CSS build artifact was not generated.");
}

const cssArtifacts = await Promise.all(
  cssFiles.map(async (file) => ({ file, css: await Bun.file(file).text() })),
);

for (const { file, css } of cssArtifacts) {
  if (/@layer\b/.test(css)) {
    throw new Error(`LIFF-incompatible Cascade Layers remain in ${file}.`);
  }
}

const combinedCss = cssArtifacts.map(({ css }) => css).join("\n");

if (!combinedCss.includes("--color-slate-900:#") || !combinedCss.includes(".flex{display:flex}")) {
  throw new Error("LIFF-compatible color fallbacks or core utilities are missing from CSS.");
}
