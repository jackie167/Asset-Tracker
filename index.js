const { spawn } = require("node:child_process");

const child = spawn("pnpm", ["-C", "api-server", "start"], { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
