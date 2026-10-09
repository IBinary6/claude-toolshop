'use strict';

const path = require('path');
const { ensureUserTemplate } = require('./lib/config');

// Absolute path of the plugin's factory default template (hooks/js -> plugin root -> templates/)
const PLUGIN_DEFAULT_TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'cpp-style-template.default.json');

try {
  ensureUserTemplate(PLUGIN_DEFAULT_TEMPLATE);
} catch (_) {
  // Copy failed (permissions, etc.): swallow it; callers fall back to the hard-coded defaults without a global template.
}

// No user task has arrived yet, so opening a C++ repository must not write project files.
// The project config is created on demand by the Stop / SubagentStop closing step after real edits.
