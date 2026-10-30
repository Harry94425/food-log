import type { SQLiteDatabase } from 'expo-sqlite';
import type { LabelRecognition } from './recognizer/types';

/** 商品資料從哪來：自己掃標示記下的，或 Open Food Facts */
export type ProductSource = 'label' | 'openfoodfacts';

export type Product = LabelRecognition & { barcode: string; source: ProductSource };

const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';
const OFF_FIELDS =
  'product_name,product_name_zh,product_name_zh-TW,brands,serving_size,serving_quantity,product_quantity,nutriments';
// Open Food Facts 要求帶自訂 User-Agent
const USER_AGENT = 'FoodLog/1.0 (personal app)';

type ProductRow = {
  barcode: string;
  name: string;
  serving_size: string;
  serving_grams: number | null;
  servings_per_package: number | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  source: ProductSource;
};

export async function getSavedProduct(db: SQLiteDatabase, barcode: string): Promise<Product | null> {
  const r = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE barcode = ?', barcode);
  if (!r) return null;
  return {
    barcode: r.barcode,
    source: r.source,
    name: r.name,
    servingSize: r.serving_size,
    servingGrams: r.serving_grams,
    servingsPerPackage: r.servings_per_package,
    perServing: { kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs },
    note: '用上次記下的資料',
  };
}

export async function saveProduct(db: SQLiteDatabase, p: Product) {
  await db.runAsync(
    `INSERT OR REPLACE INTO products
       (barcode, name, serving_size, serving_grams, servings_per_package, kcal, protein, fat, carbs, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.barcode,
    p.name,
    p.servingSize,
    p.servingGrams,
    p.servingsPerPackage,
    p.perServing.kcal,
    p.perServing.protein,
    p.perServing.fat,
    p.perServing.carbs,
    p.source,
    Date.now(),
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pos = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);

/** 查 Open Food Facts；查不到或沒有營養資料回傳 null（台灣商品常常沒有） */
export async function lookupOpenFoodFacts(barcode: string): Promise<Product | null> {
  let body: any;
  try {
    const res = await fetch(`${OFF_URL}/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  const p = body?.product;
  if (body?.status !== 1 || !p?.nutriments) return null;
  const n = p.nutriments;

  const kcal100 = n['energy-kcal_100g'] ?? (n['energy-kj_100g'] ? n['energy-kj_100g'] / 4.184 : undefined);
  const kcalServing = n['energy-kcal_serving'] ?? (n['energy-kj_serving'] ? n['energy-kj_serving'] / 4.184 : undefined);
  const servingGrams = pos(p.serving_quantity);
  // 有每份數字就用每份，否則把 100g 當一份
  const useServing = servingGrams != null && kcalServing != null;
  const pick = (key: string) => (useServing ? n[`${key}_serving`] : n[`${key}_100g`]) ?? 0;
  const kcal = useServing ? kcalServing : kcal100;
  if (kcal == null) return null;

  const packageGrams = pos(p.product_quantity);
  const grams = useServing ? servingGrams : 100;
  return {
    barcode,
    source: 'openfoodfacts',
    name: p['product_name_zh-TW'] || p.product_name_zh || p.product_name || p.brands || '包裝食品',
    servingSize: useServing ? String(p.serving_size || `${servingGrams} 公克`) : '100 公克',
    servingGrams: grams,
    servingsPerPackage: packageGrams ? round1(packageGrams / grams) : null,
    perServing: {
      kcal: Math.round(kcal),
      protein: round1(pick('proteins')),
      fat: round1(pick('fat')),
      carbs: round1(pick('carbohydrates')),
    },
    note: useServing ? '資料來自 Open Food Facts' : '資料來自 Open Food Facts（以 100 公克為一份）',
  };
}
