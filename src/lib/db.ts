import type { SQLiteDatabase } from 'expo-sqlite';
import type { FoodItem } from './recognizer/types';

export const DB_NAME = 'foodlog.db';
const DATABASE_VERSION = 1;

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '點心',
};

export type Meal = {
  id: number;
  date: string;
  meal_type: MealType;
  photo_uri: string | null;
  note: string;
  created_at: number;
  items: (FoodItem & { id: number })[];
};

export type Exercise = { id: number; date: string; name: string; kcal: number };

export type Totals = { kcal: number; protein: number; fat: number; carbs: number };

export type DaySummary = Totals & { date: string; exercise_kcal: number; weight: number | null };

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= DATABASE_VERSION) return;

  if (current === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      PRAGMA foreign_keys = ON;
      CREATE TABLE meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        meal_type TEXT NOT NULL,
        photo_uri TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX meals_date ON meals(date);
      CREATE TABLE food_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        portion TEXT NOT NULL DEFAULT '',
        kcal REAL NOT NULL DEFAULT 0,
        protein REAL NOT NULL DEFAULT 0,
        fat REAL NOT NULL DEFAULT 0,
        carbs REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX food_items_meal ON food_items(meal_id);
      CREATE TABLE exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        kcal REAL NOT NULL
      );
      CREATE TABLE weights (
        date TEXT PRIMARY KEY,
        kg REAL NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

/** 本地時間的 YYYY-MM-DD */
export function toDateKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function insertMeal(
  db: SQLiteDatabase,
  meal: { date: string; meal_type: MealType; photo_uri: string | null; note: string; items: FoodItem[] },
) {
  await db.withTransactionAsync(async () => {
    const { lastInsertRowId } = await db.runAsync(
      'INSERT INTO meals (date, meal_type, photo_uri, note, created_at) VALUES (?, ?, ?, ?, ?)',
      meal.date,
      meal.meal_type,
      meal.photo_uri,
      meal.note,
      Date.now(),
    );
    for (const i of meal.items) {
      await db.runAsync(
        'INSERT INTO food_items (meal_id, name, portion, kcal, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?, ?)',
        lastInsertRowId,
        i.name,
        i.portion,
        i.kcal,
        i.protein,
        i.fat,
        i.carbs,
      );
    }
  });
}

export async function deleteMeal(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM food_items WHERE meal_id = ?', id);
  await db.runAsync('DELETE FROM meals WHERE id = ?', id);
}

export async function getMeals(db: SQLiteDatabase, date: string): Promise<Meal[]> {
  const meals = await db.getAllAsync<Omit<Meal, 'items'>>(
    'SELECT * FROM meals WHERE date = ? ORDER BY created_at',
    date,
  );
  const items = await db.getAllAsync<FoodItem & { id: number; meal_id: number }>(
    'SELECT f.* FROM food_items f JOIN meals m ON m.id = f.meal_id WHERE m.date = ? ORDER BY f.id',
    date,
  );
  return meals.map((m) => ({ ...m, items: items.filter((i) => i.meal_id === m.id) }));
}

export function sumItems(items: FoodItem[]): Totals {
  return items.reduce(
    (t, i) => ({
      kcal: t.kcal + i.kcal,
      protein: t.protein + i.protein,
      fat: t.fat + i.fat,
      carbs: t.carbs + i.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

export async function getExercises(db: SQLiteDatabase, date: string) {
  return db.getAllAsync<Exercise>('SELECT * FROM exercises WHERE date = ? ORDER BY id', date);
}

export async function addExercise(db: SQLiteDatabase, date: string, name: string, kcal: number) {
  await db.runAsync('INSERT INTO exercises (date, name, kcal) VALUES (?, ?, ?)', date, name, kcal);
}

export async function deleteExercise(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM exercises WHERE id = ?', id);
}

export async function getWeight(db: SQLiteDatabase, date: string) {
  const row = await db.getFirstAsync<{ kg: number }>('SELECT kg FROM weights WHERE date = ?', date);
  return row?.kg ?? null;
}

export async function setWeight(db: SQLiteDatabase, date: string, kg: number) {
  await db.runAsync('INSERT OR REPLACE INTO weights (date, kg) VALUES (?, ?)', date, kg);
}

export async function getWeights(db: SQLiteDatabase, sinceDate: string) {
  return db.getAllAsync<{ date: string; kg: number }>(
    'SELECT date, kg FROM weights WHERE date >= ? ORDER BY date',
    sinceDate,
  );
}

/** 有任何紀錄（餐點、運動或體重）的日子，新的在前 */
export async function getDaySummaries(db: SQLiteDatabase, limit = 60): Promise<DaySummary[]> {
  return db.getAllAsync<DaySummary>(
    `WITH days AS (
       SELECT date FROM meals UNION SELECT date FROM exercises UNION SELECT date FROM weights
     )
     SELECT d.date,
       COALESCE((SELECT SUM(f.kcal) FROM food_items f JOIN meals m ON m.id = f.meal_id WHERE m.date = d.date), 0) AS kcal,
       COALESCE((SELECT SUM(f.protein) FROM food_items f JOIN meals m ON m.id = f.meal_id WHERE m.date = d.date), 0) AS protein,
       COALESCE((SELECT SUM(f.fat) FROM food_items f JOIN meals m ON m.id = f.meal_id WHERE m.date = d.date), 0) AS fat,
       COALESCE((SELECT SUM(f.carbs) FROM food_items f JOIN meals m ON m.id = f.meal_id WHERE m.date = d.date), 0) AS carbs,
       COALESCE((SELECT SUM(kcal) FROM exercises e WHERE e.date = d.date), 0) AS exercise_kcal,
       (SELECT kg FROM weights w WHERE w.date = d.date) AS weight
     FROM days d ORDER BY d.date DESC LIMIT ?`,
    limit,
  );
}

export async function exportCsv(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{
    date: string;
    meal_type: MealType;
    name: string;
    portion: string;
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
  }>(
    `SELECT m.date, m.meal_type, f.name, f.portion, f.kcal, f.protein, f.fat, f.carbs
     FROM food_items f JOIN meals m ON m.id = f.meal_id ORDER BY m.date, m.created_at, f.id`,
  );
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['日期', '餐別', '食物', '份量', '熱量', '蛋白質', '脂肪', '碳水'].join(','),
    ...rows.map((r) =>
      [r.date, MEAL_LABELS[r.meal_type], r.name, r.portion, r.kcal, r.protein, r.fat, r.carbs].map(esc).join(','),
    ),
  ];
  // 加 BOM 讓 Excel 正確顯示中文
  return '﻿' + lines.join('\n');
}
