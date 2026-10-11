import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, x TEXT)');
db.prepare('INSERT INTO t(x) VALUES (?)').run('ok');
const row = db.prepare('SELECT x FROM t LIMIT 1').get();
db.close();
console.log('better-sqlite3 OK:', row);
