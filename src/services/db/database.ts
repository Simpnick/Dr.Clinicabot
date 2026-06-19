import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    const dbPath = path.join(process.cwd(), 'database.sqlite');
    dbInstance = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    // Ativa suporte a chaves estrangeiras (Foreign Keys)
    await dbInstance.run('PRAGMA foreign_keys = ON;');
    
    // Cria tabela de mensagens se não existir e seu índice
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_phone TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_patient_phone ON chat_messages(patient_phone);
    `);
  }
  return dbInstance;
}
