// Prints the approval issue for a poster: line 1 = title, rest = markdown body.
//   node tools/issue.js <id> <repo> <commit-sha>
const fs = require('fs');
const path = require('path');
const [id, repo, sha] = process.argv.slice(2);
const root = path.join(__dirname, '..');
let folder = null;
for (const stage of ['outbox', 'approved', 'posted']) {
  const hit = fs.readdirSync(path.join(root, stage)).find(f => f.endsWith('_' + id));
  if (hit) { folder = `${stage}/${hit}`; break; }
}
if (!folder) { console.error('not found: ' + id); process.exit(1); }
const o = JSON.parse(fs.readFileSync(path.join(root, folder, 'occasion.json'), 'utf8'));
const review = fs.readFileSync(path.join(root, folder, 'review.txt'), 'utf8');
const caption = fs.readFileSync(path.join(root, folder, 'caption.txt'), 'utf8');
const time = (review.match(/Posts at : (\S+)/) || [])[1] || '';
const img = `https://github.com/${repo}/blob/${sha}/${folder}/poster.png?raw=true`;

console.log(`Approve: ${o.name} — ${o.date} ${time} [${o.id}]`);
console.log(`![poster](${img})

**Posts on ${o.date} at ${time} IST** to Facebook + Instagram${o.verify ? '\n\n> ⚠️ Lunar date — please confirm it on a panchang before approving.' : ''}

**To approve:** add the label \`approved\` to this issue.
**Different background:** comment \`/new-bg\`.
**Skip it:** just close this issue.

<details><summary>Caption</summary>

\`\`\`
${caption}
\`\`\`
</details>

🎵 Suggested song (add in the Instagram app if you want it): ${(review.match(/Song\s+: (.*)/) || [])[1] || '-'}`);
