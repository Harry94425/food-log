# 飲食紀錄（food-log）

個人用的 AI 飲食紀錄 App（Android，Expo）。拍照後用 Gemini 辨識食物、估算熱量與營養素，資料只存在手機裡。

## 開發

```bash
npm install
npx expo start
```

手機安裝 Expo Go，掃終端機上的 QR code。第一次打開到「設定」貼上 Gemini API 金鑰（https://aistudio.google.com）。

## 打包 APK

```bash
npx eas-cli@latest build -p android --profile preview
```

需要免費的 Expo 帳號。完成後下載 APK 裝到手機。

## 結構

- `src/app/` — 畫面（Expo Router）：今天、歷史、設定、新增餐點、單日紀錄
- `src/lib/db.ts` — SQLite 資料表與查詢
- `src/lib/recognizer/` — AI 辨識。要換供應商就新增一個實作 `FoodRecognizer` 的類別，在 `src/lib/settings.ts` 的 `getRecognizer` 切換
- `src/lib/settings.ts` — 每日目標（預設增肌 2350 kcal / 蛋白質 90g）、API 金鑰
