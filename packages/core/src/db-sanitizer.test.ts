import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSqlQuery,
  sanitizeMongoFilter,
  sanitizeRedisCommand
} from './db-sanitizer.js';

describe('Database & Cache Sanitization Engine', () => {
  describe('SQL Sanitization', () => {
    it('should strip comments and parameterize string literals and numbers', () => {
      const rawSql = `
        -- Fetch user by credentials
        SELECT id, name, email FROM users
        /* multi-line comment */
        WHERE email = 'alice@example.com' AND age > 25 AND active = 1;
      `;
      const result = sanitizeSqlQuery(rawSql);
      assert.equal(result.operation, 'SELECT');
      assert.equal(result.table, 'users');
      assert.ok(!result.statement.includes('alice@example.com'));
      assert.ok(!result.statement.includes('25'));
      assert.ok(result.statement.includes('email = ?'));
      assert.ok(result.statement.includes('age > ?'));
    });

    it('should parameterize UUIDs and hex constants', () => {
      const rawSql = "SELECT * FROM orders WHERE order_id = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a' AND flag = 0x1f;";
      const result = sanitizeSqlQuery(rawSql);
      assert.equal(result.operation, 'SELECT');
      assert.equal(result.table, 'orders');
      assert.ok(!result.statement.includes('c9bf9e57-1685-4c89-bafb-ff5af830be8a'));
      assert.ok(result.statement.includes('order_id = ?'));
      assert.ok(result.statement.includes('flag = ?'));
    });

    it('should extract table names correctly for INSERT, UPDATE, DELETE', () => {
      const insert = sanitizeSqlQuery("INSERT INTO `customers` (name, age) VALUES ('Bob', 30);");
      assert.equal(insert.operation, 'INSERT');
      assert.equal(insert.table, 'customers');
      assert.ok(insert.statement.includes('VALUES (?, ?);') || insert.statement.includes('VALUES (?, ?)'));

      const update = sanitizeSqlQuery("UPDATE accounts SET balance = 500 WHERE id = 12;");
      assert.equal(update.operation, 'UPDATE');
      assert.equal(update.table, 'accounts');

      const del = sanitizeSqlQuery("DELETE FROM audit_logs WHERE timestamp < 16000000;");
      assert.equal(del.operation, 'DELETE');
      assert.equal(del.table, 'audit_logs');
    });

    it('should truncate excessively long queries', () => {
      const longSql = "SELECT * FROM items WHERE name = '" + "x".repeat(3000) + "'";
      const result = sanitizeSqlQuery(longSql, 50);
      assert.ok(result.statement.includes('[TRUNCATED]'));
      assert.ok(result.statement.length < 100);
    });
  });

  describe('MongoDB Filter Sanitization', () => {
    it('should recursively mask sensitive leaf values while preserving query operators', () => {
      const filter = {
        account_id: 'acc-9921',
        status: 'active',
        balance: { $gt: 500 },
        tags: { $in: ['admin', 'super'] },
        $or: [{ role: 'manager' }, { level: { $gte: 3 } }]
      };
      const sanitized = JSON.parse(sanitizeMongoFilter(filter));
      assert.deepEqual(sanitized, {
        account_id: '?',
        status: '?',
        balance: { $gt: '?' },
        tags: { $in: ['?', '?'] },
        $or: [{ role: '?' }, { level: { $gte: '?' } }]
      });
    });

    it('should handle nested documents and arrays', () => {
      const doc = {
        user: { profile: { email: 'test@example.com' } },
        scores: [10, 20]
      };
      const sanitized = JSON.parse(sanitizeMongoFilter(doc));
      assert.deepEqual(sanitized, {
        user: { profile: { email: '?' } },
        scores: ['?', '?']
      });
    });
  });

  describe('Redis Command Sanitization', () => {
    it('should redact sensitive command arguments like SET and HSET', () => {
      const setCmd = sanitizeRedisCommand('SET', ['session:token_123', 'super-secret-token', 'EX', '3600']);
      assert.equal(setCmd.operation, 'SET');
      assert.equal(setCmd.key, 'session:token_123');
      assert.ok(!setCmd.statement.includes('super-secret-token'));
      assert.ok(setCmd.statement.includes('[REDACTED]'));
      assert.ok(setCmd.statement.includes('EX 3600'));

      const hsetCmd = sanitizeRedisCommand('HSET', ['user:100', 'password', 'pass123', 'email', 'user@test.com']);
      assert.equal(hsetCmd.operation, 'HSET');
      assert.ok(!hsetCmd.statement.includes('pass123'));
      assert.ok(!hsetCmd.statement.includes('user@test.com'));
      assert.ok(hsetCmd.statement.includes('password [REDACTED] email [REDACTED]'));
    });

    it('should preserve safe command arguments like GET and DEL', () => {
      const getCmd = sanitizeRedisCommand('GET', ['cache:order:456']);
      assert.equal(getCmd.operation, 'GET');
      assert.equal(getCmd.statement, 'GET cache:order:456');

      const delCmd = sanitizeRedisCommand('DEL', ['cache:key1', 'cache:key2']);
      assert.equal(delCmd.operation, 'DEL');
      assert.equal(delCmd.statement, 'DEL cache:key1 cache:key2');
    });

    it('should redact AUTH passwords completely', () => {
      const authCmd = sanitizeRedisCommand('AUTH', ['my_secret_password']);
      assert.equal(authCmd.statement, 'AUTH [REDACTED]');
    });
  });
});
