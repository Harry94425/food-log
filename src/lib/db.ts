import type { SQLiteDatabase } from 'expo-sqlite';
import type { FoodItem } from './recognizer/types';

export const DB_NAME = 'foodlog.db';
const DATABASE_VERSION = 6;

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'late_night' | 'snack' | 'drink' | 'ride_fuel';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  late_night: '宵夜',
  snack: '點心',
  drink: '飲料',
  // 騎車時吃的能量膠、運動飲料等，分開記才看得出補給吃多少
  ride_fuel: '補給',
};

export type Meal = {
  id: number;
  date: string;
  meal_type: MealType;
  title: string;
  store: string;
  price: number | null;
  photo_uri: string | null;
  note: string;
  created_at: number;
  items: (FoodItem & { id: number })[];
};

export type MealInput = {
  date: string;
  meal_type: MealType;
  title: string;
  store: string;
  price: number | null;
  photo_uri: string | null;
  note: string;
  items: FoodItem[];
};

export type Exercise = { id: number; date: string; name: string; kcal: number; strava_id: number | null };

export type Totals = { kcal: number; protein: number; fat: number; carbs: number };

export type DaySummary = Totals & {
  date: string;
  exercise_kcal: number;
  weight: number | null;
  spent: number;
  meal_count: number;
  /** SQLite 的布林是 0/1 */
  has_lunch: number;
  has_dinner: number;
};

/** 沒有任何紀錄的日子，用來補滿歷史列表 */
export function emptyDay(date: string): DaySummary {
  return {
    date,
    kcal: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    exercise_kcal: 0,
    weight: null,
    spent: 0,
    meal_count: 0,
    has_lunch: 0,
    has_dinner: 0,
  };
}

/** 沒有名稱的舊紀錄，用品項名稱代替 */
export function mealTitle(meal: Pick<Meal, 'title' | 'items'>) {
  return meal.title || meal.items.map((i) => i.name).join('、') || '未命名';
}

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
  if (current < 2) {
    // 餐點名稱（例如：豬排咖哩飯）與價錢（元，可不填）
    await db.execAsync(`
      ALTER TABLE meals ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE meals ADD COLUMN price REAL;
    `);
  }
  if (current < 3) {
    await db.execAsync(`ALTER TABLE meals ADD COLUMN store TEXT NOT NULL DEFAULT '';`);
  }
  if (current < 4) {
    // Strava 匯入：strava_id 防止重複匯入
    await db.execAsync(`
      ALTER TABLE exercises ADD COLUMN strava_id INTEGER;
      ALTER TABLE exercises ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX exercises_strava ON exercises(strava_id);
    `);
  }
  if (current < 5) {
    // Strava 活動改成以 Strava 為準、不能在 App 刪除：之前隱藏的都放回來，hidden 欄位不再使用
    await db.execAsync(`UPDATE exercises SET hidden = 0;`);
  }
  if (current < 6) {
    // 掃過的條碼商品（每份營養），下次掃同一個條碼直接帶入
    await db.execAsync(`
      CREATE TABLE products (
        barcode TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        serving_size TEXT NOT NULL DEFAULT '',
        serving_grams REAL,
        servings_per_package REAL,
        kcal REAL NOT NULL,
        protein REAL NOT NULL,
        fat REAL NOT NULL,
        carbs REAL NOT NULL,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL
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

/** YYYY-MM-DD 轉回本地時間午夜的 Date */
export function fromDateKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 例如「週四」 */
export function weekdayLabel(key: string) {
  return `週${WEEKDAYS[fromDateKey(key).getDay()]}`;
}

async function insertItems(db: SQLiteDatabase, mealId: number, items: FoodItem[]) {
  for (const i of items) {
    await db.runAsync(
      'INSERT INTO food_items (meal_id, name, portion, kcal, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?, ?)',
      mealId,
      i.name,
      i.portion,
      i.kcal,
      i.protein,
      i.fat,
      i.carbs,
    );
  }
}

export async function insertMeal(db: SQLiteDatabase, meal: MealInput) {
  await db.withTransactionAsync(async () => {
    const { lastInsertRowId } = await db.runAsync(
      `INSERT INTO meals (date, meal_type, title, store, price, photo_uri, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      meal.date,
      meal.meal_type,
      meal.title,
      meal.store,
      meal.price,
      meal.photo_uri,
      meal.note,
      Date.now(),
    );
    await insertItems(db, lastInsertRowId, meal.items);
  });
}

/** 更新整筆餐點；品項全部換成新的 */
export async function updateMeal(db: SQLiteDatabase, id: number, meal: MealInput) {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE meals SET date = ?, meal_type = ?, title = ?, store = ?, price = ?, photo_uri = ?, note = ? WHERE id = ?',
      meal.date,
      meal.meal_type,
      meal.title,
      meal.store,
      meal.price,
      meal.photo_uri,
      meal.note,
      id,
    );
    await db.runAsync('DELETE FROM food_items WHERE meal_id = ?', id);
    await insertItems(db, id, meal.items);
  });
}

export type PastMeal = {
  /** 這個組合最近一次的紀錄 id，帶入時用它的品項 */
  id: number;
  store: string;
  title: string;
  price: number | null;
  kcal: number;
  times: number;
};

/**
 * 吃過的餐點（同店家＋同名稱算一種），常吃、最近吃的排前面。
 * query 會比對店家和餐名；空字串就列出最常吃的。
 */
export async function searchPastMeals(db: SQLiteDatabase, query: string, limit = 8): Promise<PastMeal[]> {
  const like = `%${query.trim()}%`;
  return db.getAllAsync<PastMeal>(
    `WITH g AS (
       SELECT MAX(id) AS id, COUNT(*) AS times
       FROM meals
       WHERE title != '' AND (store LIKE ? OR title LIKE ?)
       GROUP BY store, title
     )
     SELECT m.id, m.store, m.title, m.price, g.times,
       COALESCE((SELECT SUM(kcal) FROM food_items f WHERE f.meal_id = m.id), 0) AS kcal
     FROM g JOIN meals m ON m.id = g.id
     ORDER BY g.times DESC, m.created_at DESC
     LIMIT ?`,
    like,
    like,
    limit,
  );
}

/**
 * 吃過的品項（同名稱取最近一次），手動輸入時用來提示和自動帶入。
 * query 為空字串時不查。
 */
export async function searchPastItems(db: SQLiteDatabase, query: string, limit = 5): Promise<FoodItem[]> {
  const q = query.trim();
  if (!q) return [];
  return db.getAllAsync<FoodItem>(
    `SELECT f.name, f.portion, f.kcal, f.protein, f.fat, f.carbs
     FROM food_items f
     JOIN (SELECT name, MAX(id) AS id, COUNT(*) AS times FROM food_items WHERE name LIKE ? GROUP BY name) g ON g.id = f.id
     ORDER BY (f.name = ?) DESC, g.times DESC, f.id DESC
     LIMIT ?`,
    `%${q}%`,
    q,
    limit,
  );
}

export async function getMeal(db: SQLiteDatabase, id: number): Promise<Meal | null> {
  const meal = await db.getFirstAsync<Omit<Meal, 'items'>>('SELECT * FROM meals WHERE id = ?', id);
  if (!meal) return null;
  const items = await db.getAllAsync<FoodItem & { id: number }>(
    'SELECT * FROM food_items WHERE meal_id = ? ORDER BY id',
    id,
  );
  return { ...meal, items };
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

/** 只能刪以前手動新增的；Strava 匯入的以 Strava 為準 */
export async function deleteExercise(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM exercises WHERE id = ? AND strava_id IS NULL', id);
}

/** 已匯入過的 Strava 活動 id */
export async function getStravaIds(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ strava_id: number }>(
    'SELECT strava_id FROM exercises WHERE strava_id IS NOT NULL',
  );
  return new Set(rows.map((r) => r.strava_id));
}

/** 最後一筆已匯入的 Strava 活動日期，沒有就是 null */
export async function latestStravaDate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ date: string | null }>(
    'SELECT MAX(date) AS date FROM exercises WHERE strava_id IS NOT NULL',
  );
  return row?.date ?? null;
}

/** 活動在 Strava 改了名稱或日期，跟著改 */
export async function updateStravaExercise(db: SQLiteDatabase, stravaId: number, date: string, name: string) {
  await db.runAsync('UPDATE exercises SET date = ?, name = ? WHERE strava_id = ?', date, name, stravaId);
}

/** 刪掉 afterDate 之後、但已經不在 Strava 上的活動 */
export async function removeStravaExercisesNotIn(db: SQLiteDatabase, afterDate: string, keepIds: number[]) {
  const placeholders = keepIds.map(() => '?').join(',') || 'NULL';
  await db.runAsync(
    `DELETE FROM exercises WHERE strava_id IS NOT NULL AND date > ? AND strava_id NOT IN (${placeholders})`,
    afterDate,
    ...keepIds,
  );
}

export async function importStravaExercise(
  db: SQLiteDatabase,
  a: { stravaId: number; date: string; name: string; kcal: number },
) {
  await db.runAsync(
    'INSERT OR IGNORE INTO exercises (date, name, kcal, strava_id) VALUES (?, ?, ?, ?)',
    a.date,
    a.name,
    a.kcal,
    a.stravaId,
  );
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
       (SELECT kg FROM weights w WHERE w.date = d.date) AS weight,
       COALESCE((SELECT SUM(price) FROM meals m WHERE m.date = d.date), 0) AS spent,
       (SELECT COUNT(*) FROM meals m WHERE m.date = d.date) AS meal_count,
       EXISTS (SELECT 1 FROM meals m WHERE m.date = d.date AND m.meal_type = 'lunch') AS has_lunch,
       EXISTS (SELECT 1 FROM meals m WHERE m.date = d.date AND m.meal_type = 'dinner') AS has_dinner
     FROM days d ORDER BY d.date DESC LIMIT ?`,
    limit,
  );
}

/** 某個月（YYYY-MM）的餐費合計與有紀錄的天數 */
export async function getMonthSpending(db: SQLiteDatabase, month: string) {
  const row = await db.getFirstAsync<{ total: number; days: number; meals: number }>(
    `SELECT COALESCE(SUM(price), 0) AS total, COUNT(DISTINCT date) AS days, COUNT(price) AS meals
     FROM meals WHERE date LIKE ? AND price IS NOT NULL`,
    `${month}-%`,
  );
  return row ?? { total: 0, days: 0, meals: 0 };
}

export async function exportCsv(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{
    meal_id: number;
    date: string;
    meal_type: MealType;
    title: string;
    store: string;
    price: number | null;
    name: string;
    portion: string;
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
  }>(
    `SELECT f.meal_id, m.date, m.meal_type, m.title, m.store, m.price,
       f.name, f.portion, f.kcal, f.protein, f.fat, f.carbs
     FROM food_items f JOIN meals m ON m.id = f.meal_id ORDER BY m.date, m.created_at, f.id`,
  );
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  // 價錢是整餐的，只寫在該餐第一列，加總時才不會重複
  const seen = new Set<number>();
  const lines = [
    ['日期', '餐別', '店家', '餐點', '價錢', '食物', '份量', '熱量', '蛋白質', '脂肪', '碳水'].join(','),
    ...rows.map((r) => {
      const first = !seen.has(r.meal_id);
      seen.add(r.meal_id);
      const price = first && r.price != null ? r.price : '';
      return [
        r.date,
        MEAL_LABELS[r.meal_type],
        r.store,
        r.title,
        price,
        r.name,
        r.portion,
        r.kcal,
        r.protein,
        r.fat,
        r.carbs,
      ]
        .map(esc)
        .join(',');
    }),
  ];
  // 加 BOM 讓 Excel 正確顯示中文
  return '﻿' + lines.join('\n');
}
