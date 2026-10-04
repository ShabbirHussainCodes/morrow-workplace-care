// Create the value for the ADMIN_PASSWORD_HASH environment variable.
//
//   npm run hash-password
//
// Type the password when asked. It is not shown and it is never stored. Do not pass it as an
// argument: arguments end up in shell history and in the process list. A password manager can
// pipe it in instead:   some-password-tool | npm run hash-password
//
// The hash goes to stdout and every message goes to stderr, so the output is safe to capture.
import { hashPassword, MIN_PASSWORD_LENGTH } from "../lib/password.js";

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(prompt);
    let value = "";

    const finish = (error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\x04") return finish();      // Enter or Ctrl-D
        if (ch === "\x03") return finish(new Error("Cancelled."));             // Ctrl-C
        if (ch === "\x7f" || ch === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (ch >= " ") value += ch;                                       // skip other control keys
      }
    };

    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readAllStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text.replace(/\r?\n$/, "");
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error("Do not pass the password as an argument. Run the command with no arguments and type it when asked.");
  }

  let password;
  if (process.stdin.isTTY) {
    password = await readHidden(`Admin password (at least ${MIN_PASSWORD_LENGTH} characters): `);
    const again = await readHidden("Repeat the password: ");
    if (password !== again) throw new Error("The two passwords do not match.");
  } else {
    password = await readAllStdin();
  }

  const hash = await hashPassword(password);
  process.stdout.write(`${hash}\n`);
  process.stderr.write(
    "\nCopy the line above into the ADMIN_PASSWORD_HASH variable in Vercel and in your local .env.\n" +
    "Do not paste it into chat or commit it.\n",
  );
}

main().catch((err) => {
  console.error(`Could not create the hash: ${err.message}`);
  process.exitCode = 1;
});
