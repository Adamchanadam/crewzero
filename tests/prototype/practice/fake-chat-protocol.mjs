import fs from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2), protocol = args[0];
const log = value => fs.appendFileSync('fake-chat.log', JSON.stringify(value) + '\n');
const reply = '明白，我考慮一下。\n#旁白\n{"mood":"審慎","goal":0}';
if (protocol === 'per-turn') {
  const outfile = args[args.indexOf('-o') + 1];
  process.stdin.setEncoding('utf8');
  let prompt = ''; for await (const chunk of process.stdin) prompt += chunk;
  if (process.env.CODEX_HOME) { const config = new URL('file:///' + process.env.CODEX_HOME.replace(/\\/g, '/') + '/config.toml'); log({ configPresent: fs.existsSync(config) }); fs.writeFileSync(config, `[projects.'d:/test']\ntrust_level = \"trusted\"\n`); }
  log({ args, prompt }); fs.writeFileSync(outfile, reply);
} else {
  log({ args, system: protocol === 'claude-stream' ? fs.readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8') : '' });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const msg = JSON.parse(line); log({ msg });
    console.log(JSON.stringify(protocol === 'agy-stream' ? { event: 'result', response: reply } : { type: 'result', result: reply }));
  }
}
