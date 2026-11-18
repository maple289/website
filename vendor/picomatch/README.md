# Local picomatch security patch

This is a private, vendored copy of **picomatch 4.0.7** (MIT), from the npm
distribution at https://registry.npmjs.org/picomatch/-/picomatch-4.0.7.tgz.
Original project: https://github.com/micromatch/picomatch.
The upstream copyright and license are retained in LICENSE.

## Reason and change

As checked on November 18, 2026, there is no published fixed version for
[CVE-2026-112366 / GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
The upstream repeated-extglob analyzer skips single-branch bodies such as `*a`.
Repeating their generated wildcard regex can cause exponential backtracking.

Only `lib/parse.js` differs from the upstream executable code. Its existing
repeated-extglob safety analysis now also rejects unbounded wildcards or nested
repetitions in a single branch. It ignores escaped/quoted literals and character
classes and retains upstream's safe character-sequence folding. Rejected patterns
use upstream's existing literal fallback. Normal globs and finite alternatives
retain their behavior. As upstream documents, deliberately setting
`maxExtglobRecursion: false` disables its safety analysis; consumers here use the
default protection.

This is not an upstream release or a claim that upstream 4.0.7 is fixed. The
private fork is named `@myhostage/picomatch`, version 4.0.7, and is installed under
the picomatch dependency name so dependent peer ranges work. `private: true`
prevents accidental publication. The root package explicitly
overrides every picomatch dependency with this local copy. There is no advisory
allowlist or audit suppression. npm audits registry dependencies, while
`tests/picomatch-security.mjs` checks this local patch, the installed consumer
resolution, attack timeouts, and normal glob behavior. Docker copies vendor before
`npm ci` so its build uses the same code.

Replace this directory and override with a verified upstream fixed release when
one is published; keep the regression test.
