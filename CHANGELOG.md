# Change Log

## v2.0.0

- [#11](https://github.com/codenothing/level-two/pull/11) Upgrading all dependencies
- [#10](https://github.com/codenothing/level-two/pull/10) skipRemoteCache: Configure workers to skip remote-cache binding
- [#9](https://github.com/codenothing/level-two/pull/9) getEntry & getEntryMulti: Fetching meta information along with a cached values
- [#8](https://github.com/codenothing/level-two/pull/8) SingleKeyWorker: Cache worker for a single key entry

### Breaking Changes

Starting with version `2.0.0`: Iterable, `peek`, `peekMulti`, `values`, `entries`, `forEach` all return `CachedEntry` wrapped result values instead of the `ResultValue` directly.

Switching to a wrapped `CachedEntry` will allow for current and future expansion on utilities for metric tracking of entries.

## v1.2.0

- [#6](https://github.com/codenothing/level-two/pull/6) getUnsafeMulti: Getting results only, throwing any errors

## v1.1.0

- [#1](https://github.com/codenothing/level-two/pull/1) ttlLocal: ttl for local cache entries, independent from remote ttl
- [#3](https://github.com/codenothing/level-two/pull/3) Move memcached and rabbitmq types into prod dependencies
- [#4](https://github.com/codenothing/level-two/pull/4) broadcast: Sending action signals to workers on different systems

## v1.0.0

- Initial implementation
