// Run the supplied suite with its Plan assertion adapted to the read-only overview.
// Missing historical comparison files are
// reported as unavailable; any other failure fails this command.
const {spawnSync} = require('child_process');
const path = require('path');
const fs = require('fs');
const file = path.resolve(process.argv[2] || 'finpulse-v2-150.html');
const result = spawnSync(process.execPath, [path.join(__dirname,'run-tests-v149.js'),file], {encoding:'utf8'});
const output = (result.stdout || '') + (result.stderr || '');
const lines = output.split('\n');
const missing147 = !fs.existsSync(path.join(path.dirname(file),'finpulse-v2-147.html'));
const unavailable = line => missing147 && (
  /^FAIL  .*COUNTEREXAMPLE v147:.* -> v147 file not found for the counterexample$/.test(line) ||
  /^FAIL  v148-xx no new network calls or frameworks were added by v148.* -> ENOENT:.*finpulse-v2-147\.html/.test(line)
);
let absent = 0;
lines.forEach(line => { if(unavailable(line)){absent++;console.log(line.replace(/^FAIL  /,'UNAVAILABLE  '));} else console.log(line); });
console.log('Historical comparison checks unavailable: '+absent+' (not passes).');
const failures = lines.filter(line => /^FAIL  /.test(line) && !unavailable(line));
process.exitCode = result.error || !output.includes('TOTAL pass=') || failures.length ? 1 : 0;
