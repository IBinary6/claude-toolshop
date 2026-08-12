'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..', '..', '..');
const manual = fs.readFileSync(path.join(pluginRoot, 'docs', 'MANUAL_INSTALL.md'), 'utf8');
const readme = fs.readFileSync(path.join(pluginRoot, 'README.md'), 'utf8');

for (const requiredFile of [
  'session_start.js',
  'subagent_start.js',
  'subagent_stop.js',
  'agent_nudge/agent_nudge.js',
  'lib/guidance.js',
  'lib/marker.js',
]) {
  assert.ok(manual.includes(requiredFile), `manual install must deploy ${requiredFile}`);
}

assert.ok(manual.includes('"SessionStart"'), 'manual install must register SessionStart');
assert.ok(manual.includes('"SubagentStart"'), 'manual install must register SubagentStart');
assert.ok(manual.includes('"SubagentStop"'), 'manual install must register SubagentStop');
assert.ok(manual.includes('"matcher": "Agent"'), 'manual install must register the Agent nudge hook');
assert.ok(manual.includes('agents/*.md'), 'manual install must deploy native agents');
assert.ok(
  readme.includes('/plugin install agent-dispatch@claude-toolshop'),
  'README must use the marketplace install syntax'
);

console.log('✓ manual_install.test.js — all assertions passed');
