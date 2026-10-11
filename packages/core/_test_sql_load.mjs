import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec('CREATE TABLE t(x TEXT)');
db.prepare('INSERT INTO t(x) VALUES (?)').run('hello-from-22');
const row = db.prepare('SELECT x FROM t LIMIT 1').get();
db.close();
console.log('OK:', row);
