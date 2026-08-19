import { writeFile } from 'node:fs/promises'
const sha = process.argv[2] || '9c9f36ccd3995266cd675468af71639c8dde1ec5'
const url = 'https://api.github.com/repos/mattpocock/skills/git/trees/' + sha + '?recursive=1'
const response = await fetch(url, { headers: { 'User-Agent': 'dsh-matt-skills-audit' } })
if (!response.ok) throw new Error('GitHub tree fetch failed: ' + response.status)
const tree = await response.json()
if (tree.truncated) throw new Error('GitHub tree response is truncated')
const implemented = new Set(['code-review','codebase-design','diagnosing-bugs','domain-modeling','grill-with-docs','improve-codebase-architecture','prototype','research','resolving-merge-conflicts','tdd','to-spec','to-tickets','triage','wayfinder','grilling','wait-what','writing-for-agents'])
const partial = new Set(['ask-matt','implement','setup-matt-pocock-skills','wizard'])
const skillName = path => path.match(/^skills\/[^/]+\/([^/]+)\/SKILL\.md$/)?.[1]
const entries = tree.tree.map(item => { const skill = skillName(item.path); let status = 'supporting-upstream-file'; let reason = 'Tracked for change detection; no one-to-one local semantic claim.'; if (skill && implemented.has(skill)) { status = 'planning-adapter'; reason = 'Engineering intent represented by a DSH plan tool; execution parity is not claimed.' } else if (skill && partial.has(skill)) { status = 'partial'; reason = 'Only part of the workflow or a host-safe boundary is represented.' } else if (skill) { status = 'not-implemented'; reason = 'No DSH semantic implementation is currently claimed.' } return { path: item.path, type: item.type, sha: item.sha, size: item.size ?? null, skill: skill ?? null, status, reason } })
const result = { schemaVersion: 1, repository: 'https://github.com/mattpocock/skills', pinnedTreeSha: tree.sha, requestedRef: sha, sourceUrl: url, truncated: tree.truncated, entryCount: entries.length, skillCount: entries.filter(x => x.skill).length, generatedAt: new Date().toISOString(), entries }
await writeFile(new URL('../UPSTREAM-MATRIX.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ pinnedTreeSha: result.pinnedTreeSha, entryCount: result.entryCount, skillCount: result.skillCount, output: 'UPSTREAM-MATRIX.json' }))
