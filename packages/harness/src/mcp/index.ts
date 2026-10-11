/**
 * MCP module barrel.
 *
 * The transport is an implementation detail of the client; only the client and
 * its adapters are part of the package's public surface. Tests import from here
 * so a refactor of the transport layer does not ripple into every call site.
 * @module
 */

export * from './transport.js';
export * from './McpClient.js';