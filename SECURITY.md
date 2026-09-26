# Security

Report vulnerabilities privately through GitHub's security advisory reporting for this repository. Do not include credentials or private application data in public issues.

Version 1.x is the current supported release line. Keys must separate tenants and authorization contexts. The package does not validate caller access or provide a distributed lock. Cancellation depends on the worker honoring its signal; admission limits do not stop physical work that ignores cancellation.
