#!/usr/bin/env node
/**
 * CT disk prune checklist helper (prints commands; does not SSH by default).
 *
 *   node scripts/ct-disk-prune-checklist.mjs
 *
 * If GS_CT_SSH is set (e.g. gs-admin@100.x.x.x), optionally run with --execute
 * to print a remote one-liner you can review — never force-destructive without confirm.
 */
const releases = '/opt/galactic-sovereign/releases';
const backups = '/var/lib/galactic-sovereign/backups';
const accountsDb = '/var/lib/galactic-sovereign/accounts/accounts.sqlite';

console.log(`# Galactic Sovereign CT disk prune checklist
#
# 1) Keep current + one prior release under ${releases}
#    ls -lt ${releases}
#    # after confirming current symlink target:
#    # rm -rf ${releases}/<old-release-id>
#
# 2) Cap local backups (restic/R2 is offsite source of truth)
#    ls -lt ${backups} | head
#    # delete aged tarballs once retention policy is clear
#
# 3) After Supabase save bridge is live, wipe local envelopes:
#    GS_DATA_DIR=/var/lib/galactic-sovereign/accounts \\
#      node /opt/galactic-sovereign/current/scripts/wipe-ct-solo-saves.mjs --yes
#    # or SQL:
#    # sqlite3 ${accountsDb} 'DELETE FROM save_slots; VACUUM;'
#
# 4) Confirm sizes
#    du -sh /opt/galactic-sovereign /var/lib/galactic-sovereign
#    sudo gsctl status
`);

if (process.argv.includes('--execute')) {
  console.error('--execute is not automated: run the printed commands on the CT after review.');
  process.exit(1);
}
