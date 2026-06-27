import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '../../src/services/db/database';

describe('Testes do Banco de Dados - Fila Virtual e Configurações', () => {
  let db: any;

  beforeAll(async () => {
    db = await getDb();
    
    // Garante que as tabelas necessárias estejam criadas no banco de testes
    await db.exec(`
      CREATE TABLE IF NOT EXISTS virtual_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_phone TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        arrival_time TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  });

  it('Deve gerenciar a fila virtual corretamente (Inserção, Atualização de Status, Deleção)', async () => {
    const phone = '5548999991234';
    const name = 'Maria das Dores';
    const time = new Date().toISOString();

    // 1. Inserir na fila
    const resInsert = await db.run(
      "INSERT INTO virtual_queue (patient_phone, patient_name, status, arrival_time) VALUES (?, ?, 'waiting', ?)",
      [phone, name, time]
    );
    expect(resInsert.lastID).toBeDefined();
    const queueId = resInsert.lastID;

    // 2. Buscar da fila e verificar dados
    const row = await db.get("SELECT * FROM virtual_queue WHERE id = ?", [queueId]);
    expect(row).toBeDefined();
    expect(row.patient_name).toBe(name);
    expect(row.status).toBe('waiting');

    // 3. Atualizar status para 'in_consultation'
    await db.run("UPDATE virtual_queue SET status = 'in_consultation' WHERE id = ?", [queueId]);
    const rowUpdated = await db.get("SELECT * FROM virtual_queue WHERE id = ?", [queueId]);
    expect(rowUpdated.status).toBe('in_consultation');

    // 4. Remover da fila
    await db.run("DELETE FROM virtual_queue WHERE id = ?", [queueId]);
    const rowDeleted = await db.get("SELECT * FROM virtual_queue WHERE id = ?", [queueId]);
    expect(rowDeleted).toBeUndefined();
  });

  it('Deve salvar e atualizar as configurações da clínica na tabela settings', async () => {
    const key = 'appointment_interval';
    const initialValue = '15';
    const newValue = '30';

    // 1. Inserir ou ignorar valor padrão
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, initialValue]);
    let setting = await db.get("SELECT * FROM settings WHERE key = ?", [key]);
    expect(setting).toBeDefined();
    expect(setting.value).toBe(initialValue);

    // 2. Atualizar valor
    await db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, newValue]
    );
    setting = await db.get("SELECT * FROM settings WHERE key = ?", [key]);
    expect(setting.value).toBe(newValue);
  });
});
