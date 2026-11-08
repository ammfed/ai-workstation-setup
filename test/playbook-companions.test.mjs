import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playbook = path.join(repoRoot, 'templates', 'skills', 'workflow-playbook');

test('the installer copies each playbook companion file, and the playbook points to it', () => {
  const module = fs.readFileSync(path.join(repoRoot, 'modules', 'skills', 'module.mjs'), 'utf8');
  const skill = fs.readFileSync(path.join(playbook, 'SKILL.md'), 'utf8');
  for (const file of ['checkpoints.md', 'video.md', 'slides.md', 'building.md']) {
    assert.ok(fs.existsSync(path.join(playbook, file)), `${file} is in the template`);
    assert.ok(module.includes(`['skills/workflow-playbook/${file}', '${file}']`), `the installer copies ${file}`);
    assert.ok(skill.includes(`\`${file}\``), `the playbook points to ${file}`);
  }
});

test('the playbook keeps plans free of timing apart from the journey showcase record', () => {
  const skill = fs.readFileSync(path.join(playbook, 'SKILL.md'), 'utf8');
  assert.match(skill, /Plans show the order of the work, never days, hours or estimates\./);
  assert.match(skill, /journey showcase: the hours spent/);
});

test('the opt-in government build style ships with the playbook, loads only on an explicit ask and says how it grows', () => {
  const module = fs.readFileSync(path.join(repoRoot, 'modules', 'skills', 'module.mjs'), 'utf8');
  const skill = fs.readFileSync(path.join(playbook, 'SKILL.md'), 'utf8');
  const style = fs.readFileSync(path.join(repoRoot, 'templates', 'skills', 'government-build-style', 'SKILL.md'), 'utf8');
  assert.ok(module.includes("writeBundledSkill(ctx, 'government-build-style')"), 'the playbook choice installs the style');
  const description = style.match(/^---\nname: government-build-style\ndescription: (.*)\n---\n/)?.[1];
  assert.ok(description, 'the style has name and description frontmatter');
  assert.match(description, /ONLY when the person explicitly asks/);
  assert.match(description, /Never load it by default/);
  assert.match(description, /current project only/);
  assert.match(skill, /use the government build style/);
  assert.match(skill, /Never load a sector style without that ask/);
  for (const text of [style, fs.readFileSync(path.join(playbook, 'building.md'), 'utf8')]) {
    assert.match(text, /## Growing this/);
    assert.match(text, /The newest dated rule wins\./);
    assert.match(text, /strike the old text through with `~~` and keep it/);
  }
});
