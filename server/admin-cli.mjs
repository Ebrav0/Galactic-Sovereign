#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { AuthStore } from './auth-store.mjs';

const dataDir = path.resolve(process.env.GS_DATA_DIR || path.join(process.cwd(), 'server', 'data'));
const [command, usernameArg, displayNameArg] = process.argv.slice(2);

async function readPassword() {
  if (process.argv.includes('--password-stdin')) return fs.readFileSync(0, 'utf8').replace(/[\r\n]+$/, '');
  if (!stdin.isTTY) throw new Error('Use --password-stdin when standard input is not a terminal');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const password = await rl.question('Password (input is visible in this terminal): ');
  rl.close();
  return password;
}

const store = new AuthStore({ dataDir });
try {
  if (command !== 'create-owner') {
    throw new Error('Usage: node server/admin-cli.mjs create-owner <username> [display-name] [--password-stdin]');
  }
  if (store.listUsers().some((user) => user.role === 'owner')) throw new Error('Owner account already exists');
  const password = await readPassword();
  const user = await store.createUser({
    username: usernameArg,
    displayName: displayNameArg || usernameArg,
    password,
    role: 'owner',
    mustChangePassword: true,
  });
  stdout.write(`Created owner ${user.username} (${user.id})\n`);
} finally {
  store.close();
}
