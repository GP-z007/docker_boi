'use strict';

/**
 * Isolate unit/integration suites from destructive Docker/redis sidecars spawned from `container-manager`.
 */

process.env.DASDOCKER_RESOURCE_ENFORCER = '0';
process.env.DASDOCKER_KEYSPACE_EXPIRY = '0';
