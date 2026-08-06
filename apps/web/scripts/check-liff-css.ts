const cssFiles = Array.from(new Bun.Glob("assets/*.css").scanSync({ cwd: "dist", absolute: true }));

if (cssFiles.length !== 1) {
  throw new Error(`CSS build artifact must be exactly one file, received ${cssFiles.length}.`);
}

const css = await Bun.file(cssFiles[0]).text();

if (/@layer\s+(?:theme|base|components|utilities)\b/.test(css)) {
  throw new Error("LIFF-incompatible Cascade Layers remain in the CSS build artifact.");
}

if (!css.includes("--color-slate-900:#") || !css.includes(".flex{display:flex}")) {
  throw new Error("LIFF-compatible color fallbacks or core utilities are missing from CSS.");
}
