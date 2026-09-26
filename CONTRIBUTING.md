# Contributing

Use Node.js 20 or later. Run `npm ci`, then `npm run check`. Tests use Node's built-in test runner; the library has no runtime dependencies.

For a bug, provide a minimal reproduction, Node/browser version, expected behavior and actual behavior. For cancellation bugs, include the order of calls and aborts. Add a regression test with your fix. Use deferred promises instead of timing guesses wherever possible.

Discuss significant API changes in an issue first. Keep the core focused on pending-work sharing, cancellation and admission limits. Caching, distributed locking and framework integrations should stay outside the core.

Releases are published by the maintainer after CI passes and the packed artifact is checked. Never commit npm credentials.
